// Node.js modules
// https://zellwk.com/blog/publish-to-npm/
// https://www.sensedeep.com/blog/posts/2021/how-to-create-single-source-npm-module.html
// https://electerious.medium.com/from-commonjs-to-es-modules-how-to-modernize-your-node-js-app-ad8cdd4fb662

// Puppeteer SSR
// https://developers.google.com/web/tools/puppeteer/articles/ssr

// Bot User Agent
// https://www.keycdn.com/blog/web-crawlers
// https://github.com/omrilotan/isbot/blob/main/src/list.json
// https://github.com/monperrus/crawler-user-agents/blob/master/crawler-user-agents.json

// Nginx Redirect by User Agent
// https://serverfault.com/questions/775463/nginx-redirect-based-on-user-agent
// https://serverfault.com/questions/865055/nginx-redirect-if-user-agent-contains-xyz

// Other Proxies
// https://github.com/xiamx/ssr-proxy // https://www.npmjs.com/package/ssr-proxy
// https://cnpmjs.org/package/spa-ssr-proxy // https://www.npmjs.com/package/spa-ssr-proxy
// https://github.com/jamiekyle-eb/ssr-proxy
// https://github.com/postor/ssr-proxy-puppeteer // https://www.npmjs.com/package/ssr-proxy-puppeteer

import axios from 'axios';
import deepmerge from 'deepmerge';
import express from 'express';
import fs from 'fs';
import isbot from 'isbot';
import mime from 'mime-types';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer';
import { Stream } from 'stream';
import { Logger } from './logger';
import { ProxyCache } from './proxy-cache';
import { CacheItem, ProxyParams, ProxyResult, ProxyType, ProxyTypeParams, SsrProxyConfig, SsrRenderResult } from './types';
import { promiseParallel, streamToString } from './utils';

export class SsrProxy {
    private config: SsrProxyConfig;
    private proxyCache?: ProxyCache; // In-memory cache of rendered pages
    private browserWSEndpoint?: string; // Reusable browser connection

    constructor(config: SsrProxyConfig) {
        this.config = {
            port: 8080,
            hostname: '0.0.0.0',
            targetRoute: 'localhost:80',
            proxyOrder: [ProxyType.SsrProxy, ProxyType.HttpProxy, ProxyType.StaticProxy],
            failStatus: params => 404,
            isBot: (method: string, url: string, headers: any) => headers?.['user-agent'] ? isbot(headers['user-agent']) : false,
            cache: {
                shouldUse: params => params.proxyType === ProxyType.SsrProxy,
                maxEntries: 50,
                maxByteSize: 50 * 1024 * 1024, // 50MB
                expirationMs: 10 * 60 * 1000, // 10 minutes
                autoRefresh: {
                    enabled: false,
                    shouldUse: () => true,
                    proxyOrder: [ProxyType.SsrProxy],
                    initTimeoutMs: 5 * 1000, // 5 seconds
                    intervalMs: 5 * 60 * 1000, // 4 minutes
                    parallelism: 5,
                    routes: [],
                    isBot: true,
                },
            },
            ssr: {
                shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl) || !/\./.test(params.targetUrl)),
                browserConfig: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                },
                queryParams: [{
                    key: 'headless',
                    value: 'true',
                }],
            },
            httpProxy: {
                shouldUse: params => true,
            },
            static: {
                shouldUse: params => true,
                dirPath: './dist',
                useIndexFile: path => path.endsWith('/'),
                indexFile: 'index.html',
            },
            log: {
                level: 2,
                console: {
                    enabled: true,
                },
                file: {
                    enabled: true,
                    dirPath: path.join(os.tmpdir(), 'ssr-proxy-js/logs'),
                },
            },
        };

        this.config = deepmerge<SsrProxyConfig>(this.config, config, {
            arrayMerge: (destArray, srcArray, opts) => srcArray,
        });

        this.config.targetRoute! = `${this.config.targetRoute}/`.replace(/\/\//g, '/');;

        const cLog = this.config.log;
        Logger.setLevel(cLog!.level!);
        Logger.configConsole(cLog!.console!.enabled!);
        Logger.configFile(cLog!.file!.enabled!, cLog!.file!.dirPath!);

        const cCache = this.config.cache;
        this.proxyCache = new ProxyCache(cCache!.maxEntries!, cCache!.maxByteSize!, cCache!.expirationMs!);
    }

    start() {
        this.startCacheJob();
        const app = this.listen();
    }

    private startCacheJob() {
        const $this = this;
        const cCache = this.config.cache!;
        const cAutoCache = cCache.autoRefresh!;

        const enabled = cAutoCache.enabled! && cAutoCache.routes! && cAutoCache.routes!.length!;
        if (!enabled) return;

        setTimeout(() => {
            runRefresh();
            const interval = setInterval(runRefresh, cCache.autoRefresh!.intervalMs!);
        }, cCache.autoRefresh!.initTimeoutMs!);

        async function runRefresh() {
            const logger = new Logger(true);

            try {
                if (!cAutoCache.shouldUse || !cAutoCache.shouldUse!() || !cAutoCache.routes?.length) return;
    
                const routesStr = '> ' + cAutoCache.routes!.map(e => e.url).join('\n> ');
                logger.info(`Refreshing Cache:\n${routesStr}`);
    
                await promiseParallel(cAutoCache.routes!.map((route) => () => new Promise(async (res, rej) => {
                    try {
                        const params: ProxyParams = { isBot: cAutoCache.isBot!, sourceUrl: route.url, targetUrl: route.url };
                        const { result, proxyType } = await $this.runProxy(params, logger, route.method, route.headers);
                    } catch (err) {
                        logger.error('CacheRefresh', err, false);
                        rej(err);
                    }
                })), cAutoCache.parallelism!);
            } catch (err) {
                logger.error('CacheRefresh', err, false);
            }
        }
    }

    private listen() {
        const $this = this;

        const app = express();

        // Proxy requests
        app.use('*', async (req, res, next) => {
            const logger = new Logger();

            try {
                const sourceUrl = req.originalUrl;
                const targetUrl = new URL(req.originalUrl, `${req.protocol}://${this.config.targetRoute}`).toString();

                const isBot = this.config.isBot!(req.method, sourceUrl, req.headers); // tip: Lighthouse is a bot

                const params: ProxyParams = { isBot, sourceUrl, targetUrl };

                const { result, proxyType } = await this.runProxy(params, logger, req.method, req.headers);

                const proxyTypeParams: ProxyTypeParams = { ...params, proxyType };

                if (result?.error != null) return sendFail(result, proxyTypeParams);
                else if (result?.text != null) return sendText(result, proxyTypeParams);
                else if (result?.stream != null) return sendStream(result, proxyTypeParams);
                else return sendFail({ ...result, error: 'No Proxy Result' }, proxyTypeParams);
            } catch (err) {
                return next(err);
            }

            async function sendStream(result: ProxyResult, params: ProxyTypeParams) {
                res.status(200);
                res.contentType(result.contentType!);
                for (let key in result.headers) res.set(key, result.headers[key]);
                return result.stream!.on('error', err => {
                    res.status($this.config.failStatus!(params));
                    // res.contentType('text/plain');
                    // const error = Logger.errorStr(result.error!);
                    return res.send();
                }).pipe(res);
            }

            async function sendText(result: ProxyResult, params: ProxyTypeParams) {
                res.status(200);
                res.contentType(result.contentType!);
                for (let key in result.headers!) res.set(key, result.headers![key]);
                return res.send(result.text!);
            }

            async function sendFail(result: ProxyResult, params: ProxyTypeParams) {
                res.status($this.config.failStatus!(params));
                res.contentType('text/plain');
                for (let key in result.headers!) res.set(key, result.headers![key]);
                const error = Logger.errorStr(result.error!);
                return res.send(error);
            }
        });

        // Error Handler
        app.use((err: any, req: any, res: any, next: any) => {
            Logger.error('Error', err, true);
            res.contentType('text/plain');
            res.status(err.status || 500);
            res.send(Logger.errorStr(err));
            next();
        });

        // Listen
        app.listen(this.config.port!, this.config.hostname!, () => {
            Logger.info(`\nSSRProxy listening on http://${this.config.hostname!}:${this.config.port!}\nProxy to ${this.config.targetRoute!}\n`);
        });

        return app;
    }

    private async runProxy(params: ProxyParams, logger: Logger, method?: string, headers?: any) {
        headers = headers || {};
        method = method || 'GET';

        let result: ProxyResult = {};
        let proxyType: ProxyType = this.config.proxyOrder![0];

        for (let i in this.config.proxyOrder!) {
            proxyType = this.config.proxyOrder![i];

            try {
                if (proxyType === ProxyType.SsrProxy) {
                    result = await this.runSsrProxy(params, logger, headers);
                } else if (proxyType === ProxyType.HttpProxy) {
                    result = await this.runHttpProxy(params, logger, method, headers);
                } else if (proxyType === ProxyType.StaticProxy) {
                    result = await this.runStaticProxy(params, logger);
                } else {
                    throw new Error('Invalid Proxy Type');
                }
            } catch (err) {
                result = { error: err };
                params.lastError = err;
            }

            if (result.error == null) break;
        }

        return { result, proxyType };
    }

    private async runSsrProxy(params: ProxyParams, logger: Logger, headers: any): Promise<ProxyResult> {
        const cSsr = this.config.ssr!;
        const cacheKey = `${ProxyType.SsrProxy}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.SsrProxy };

        const shouldUse = cSsr.shouldUse!(params);
        if (!shouldUse) {
            const msg = 'Skipped SsrProxy';
            logger.debug(`${msg}: ${params.targetUrl}`);
            return { error: msg };
        }

        try {
            logger.debug(`Using SsrProxy: ${params.targetUrl}`);

            logger.info(`Bot Access | URL: ${params.sourceUrl} | User Agent: ${headers['user-agent']}`);

            // Try use Cache

            const cache = this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`SSR Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use SsrProxy

            let { text, error, headers: ssrHeaders, ttRenderMs } = await this.tryRender(params.targetUrl, logger, headers);

            const isSuccess = error == null;

            logger.info(`SSR Result | Render Time: ${ttRenderMs}ms | Success: ${isSuccess}${isSuccess ? '' : ` | Message: ${error}`}`);

            if (!isSuccess) return { error };
            if (text == null) text = '';

            const resHeaders = {
                // ...(ssrHeaders || {}), // TODO: return response headers?
                'Server-Timing': `Prerender;dur=${ttRenderMs};desc="Headless render time (ms)"`,
            };
            
            const contentType = this.getContentType(params.targetUrl);

            this.trySaveCache(text, contentType, cacheKey, typeParams, logger);

            return { text, contentType, headers: resHeaders };
        } catch (err: any) {
            logger.error('SsrError', err, false);
            return { error: err };
        }
    }

    private async runHttpProxy(params: ProxyParams, logger: Logger, method: string, headers: any): Promise<ProxyResult> {
        const cHttpProxy = this.config.httpProxy!;
        const cacheKey = `${ProxyType.HttpProxy}:${method}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.HttpProxy };

        const shouldUse = cHttpProxy.shouldUse!(params);
        if (!shouldUse) {
            const msg = 'Skipped HttpProxy';
            logger.debug(`${msg}: ${params.targetUrl}`);
            return { error: msg };
        }

        try {
            logger.debug(`Using HttpProxy: ${params.targetUrl}`);

            // Try use Cache

            const cache = this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`HTTP Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use HttpProxy

            const request = await axios.request({
                url: params.targetUrl,
                method: method as any,
                responseType: 'stream',
                headers: headers as any,
            });

            const contentType = this.getContentType(params.targetUrl);

            this.trySaveCacheStream(request.data, contentType, cacheKey, typeParams, logger);

            return { stream: request.data, contentType };
            // return { stream: request.data, headers: request.headers }; // TODO: return response headers?
        } catch (err: any) {
            const error = err?.response?.data ? await streamToString(err.response.data).catch(err => err) : err;
            logger.error('HttpProxyError', error, false);
            return { error };
        }
    }

    private async runStaticProxy(params: ProxyParams, logger: Logger): Promise<ProxyResult> {
        const cStatic = this.config.static!;
        const cacheKey = `${ProxyType.StaticProxy}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.StaticProxy };

        const shouldUse = cStatic.shouldUse!(params);
        if (!shouldUse) {
            const msg = 'Skipped StaticProxy';
            logger.debug(`${msg}: ${params.targetUrl}`);
            return { error: msg };
        }

        try {
            logger.debug(`Using StaticProxy: ${params.targetUrl}`);

            // Try use Cache

            const cache = this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`Static Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use StaticProxy

            if (cStatic.useIndexFile!(params.sourceUrl))
                params.sourceUrl = `${params.sourceUrl}/${cStatic.indexFile!}`.replace(/\/\//g, '/');

            const filePath = path.join(path.dirname(process.argv[1]), cStatic.dirPath!, params.sourceUrl);

            logger.debug(`Static Path: ${filePath}`);

            const fileStream = fs.createReadStream(filePath);
            
            const contentType = this.getContentType(filePath);

            this.trySaveCacheStream(fileStream, contentType, cacheKey, typeParams, logger);

            return { stream: fileStream, contentType };
        } catch (err: any) {
            logger.error('StaticError', err, false);
            return { error: err };
        }
    }

    private tryGetCache(cacheKey: string, params: ProxyTypeParams, logger: Logger): CacheItem | null {
        const cCache = this.config.cache!;

        const shouldUse = cCache.shouldUse!(params) && this.proxyCache?.has(cacheKey);

        if (shouldUse) {
            logger.debug(`Cache Hit: ${cacheKey}`);
            const cache = this.proxyCache!.get(cacheKey)!;

            if (!cache) return null;

            return cache;
        }

        return null;
    }

    private trySaveCache(text: string, contentType: string, cacheKey: string, params: ProxyTypeParams, logger: Logger) {
        const cCache = this.config.cache!;

        const shouldUse = cCache.shouldUse!(params) && this.proxyCache!;

        if (shouldUse) {
            logger.debug(`Caching: ${cacheKey}`);
            this.proxyCache!.set(cacheKey, text, contentType);
            this.tryClearCache(logger);
        }
    }

    private trySaveCacheStream(stream: Stream, contentType: string, cacheKey: string, params: ProxyTypeParams, logger: Logger) {
        const cCache = this.config.cache!;

        const shouldUse = cCache.shouldUse!(params) && this.proxyCache!;

        if (shouldUse) {
            logger.debug(`Caching: ${cacheKey}`);
            this.proxyCache!.pipe(cacheKey, stream, contentType)
                .then(() => this.tryClearCache(logger))
                .catch(err => logger.error('SaveCacheStream', err, false));
        }
    }

    private tryClearCache(logger: Logger) {
        if (this.proxyCache!) {
            const deleted = this.proxyCache.tryClear();
            if (deleted.length) logger.debug(`Cache Cleared: ${JSON.stringify(deleted)}`);
        }
    }

    private async tryRender(urlStr: string, logger: Logger, headers: any): Promise<SsrRenderResult> {
        const cSsr = this.config.ssr!;
        const start = Date.now();

        try {
            if (!this.browserWSEndpoint) {
                logger.debug('SSR: Creating browserWSEndpoint');
                const browser = await puppeteer.launch(cSsr.browserConfig!);
                this.browserWSEndpoint = await browser.wsEndpoint();
            }

            // Indicate headless render to client
            // e.g. use to disable some features if ssr
            const url = new URL(urlStr);

            for (let param of cSsr.queryParams!)
                url.searchParams.set(param.key, param.value);

            logger.debug('SSR: Connecting');

            const browser = await puppeteer.connect({ browserWSEndpoint: this.browserWSEndpoint });
            const page = await browser.newPage();

            // Intercept network requests
            let interceptCount = 0;
            await page.setRequestInterception(true);
            page.on('request', req => {
                interceptCount++;

                const reqType = req.resourceType();

                // Ignore requests for resources that don't produce DOM (e.g. images, stylesheets, media)
                const allowlist = ['document', 'script', 'xhr', 'fetch'];
                if (!allowlist.includes(reqType)) return req.abort();

                // Custom headers
                let origHeaders = req.headers();
                if (interceptCount === 1) {
                    origHeaders = { ...(headers || {}), ...(origHeaders || {}) };
                    delete origHeaders['host'];
                }

                // Pass through all other requests
                req.continue({ headers: origHeaders });
            });

            const response = await page.goto(url.toString(), { waitUntil: 'networkidle0' });

            const resHeaders = response.headers();

            logger.debug('SSR: Connected');

            // Serialized text of page DOM
            const text = await page.content();

            await page.close();

            logger.debug('SSR: Closed');

            const ttRenderMs = Date.now() - start;

            return { text, headers: resHeaders, ttRenderMs };
        } catch (err: any) {
            let error = ((err && (err.message || err.toString())) || 'Proxy Error');
            const ttRenderMs = Date.now() - start;
            return { ttRenderMs, error };
        }
    }

    private getContentType(path: string) {
        const isHtml = () => /\.html$/.test(path) || !/\./.test(path)
        const type = mime.lookup(path) || (isHtml() ? 'text/html' : 'text/plain');
        return type;
    }
}
