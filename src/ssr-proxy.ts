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
import https from 'https';
import isbot from 'isbot';
import mime from 'mime-types';
import os from 'os';
import path from 'path';
import puppeteer from 'puppeteer';
import { Stream } from 'stream';
import { Logger } from './logger';
import { ProxyCache } from './proxy-cache';
import { CacheItem, LogLevel, ProxyParams, ProxyResult, ProxyType, ProxyTypeParams, SsrProxyConfig, SsrRenderResult } from './types';
import { getOrCall, promiseParallel, streamToString } from './utils';

export class SsrProxy {
    private config: SsrProxyConfig;
    private proxyCache?: ProxyCache; // In-memory cache of rendered pages
    private browserWSEndpoint?: string; // Reusable browser connection

    constructor(config: SsrProxyConfig) {
        this.config = {
            // TODO: AllowRedirect: boolean, return without redirecting
            httpPort: 8080,
            httpsPort: 8443,
            httpsKey: undefined,
            httpsCert: undefined,
            hostname: '0.0.0.0',
            targetRoute: 'http://localhost:80',
            proxyOrder: [ProxyType.SsrProxy, ProxyType.HttpProxy, ProxyType.StaticProxy],
            failStatus: params => 404,
            customError: undefined,
            isBot: (method: string, url: string, headers: any) => headers?.['user-agent'] ? isbot(headers['user-agent']) : false,
            ssr: {
                shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname)),
                browserConfig: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                },
                queryParams: [{
                    key: 'headless',
                    value: 'true',
                }],
                allowedResources: ['document', 'script', 'xhr', 'fetch'],
                waitUntil: 'networkidle0',
                timeout: 60000,
            },
            httpProxy: {
                shouldUse: params => true,
                queryParams: [],
                unsafeHttps: false,
                timeout: 60000,
            },
            static: {
                shouldUse: params => true,
                dirPath: path.join(process.cwd(), 'public'),
                useIndexFile: path => path.endsWith('/'),
                indexFile: 'index.html',
            },
            log: {
                level: LogLevel.Info,
                console: {
                    enabled: true,
                },
                file: {
                    enabled: true,
                    dirPath: path.join(os.tmpdir(), 'ssr-proxy-js/logs'),
                },
            },
            cache: {
                shouldUse: params => params.proxyType === ProxyType.SsrProxy,
                maxEntries: 50,
                maxByteSize: 50 * 1000 * 1000, // 50MB
                expirationMs: 10 * 60 * 1000, // 10 minutes
                autoRefresh: {
                    enabled: false,
                    shouldUse: () => true,
                    proxyOrder: [ProxyType.SsrProxy],
                    initTimeoutMs: 5 * 1000, // 5 seconds
                    intervalMs: 5 * 60 * 1000, // 5 minutes
                    parallelism: 5,
                    isBot: true,
                    routes: [],
                },
            },
        };

        if (config) {
            this.config = deepmerge<SsrProxyConfig>(this.config, config, {
                arrayMerge: (destArray, srcArray, opts) => srcArray,
            });
        } else {
            console.log('No configuration found for ssr-proxy-js!');
        }

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
                if (!cAutoCache.shouldUse || !getOrCall(cAutoCache.shouldUse) || !cAutoCache.routes?.length) return;
    
                const routesStr = '> ' + cAutoCache.routes!.map(e => e.url).join('\n> ');
                logger.info(`Refreshing Cache:\n${routesStr}`);
    
                await promiseParallel(cAutoCache.routes!.map((route) => () => new Promise(async (res, rej) => {
                    try {
                        const params: ProxyParams = { isBot: cAutoCache.isBot!, sourceUrl: route.url, targetUrl: new URL(route.url) };
                        const { result, proxyType } = await $this.runProxy(params, logger, route.method, route.headers);
                        res('ok');
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
                const targetUrl = new URL(req.originalUrl, this.config.targetRoute);

                const isBot = getOrCall(this.config.isBot, req.method, sourceUrl, req.headers)!;

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
                setHeaders(result.headers!)
                return result.stream!.on('error', err => {
                    res.status(getOrCall($this.config.failStatus, params)!);
                    // res.contentType('text/plain');
                    // const error = Logger.errorStr(result.error!);
                    return res.send();
                }).pipe(res);
            }

            async function sendText(result: ProxyResult, params: ProxyTypeParams) {
                res.status(200);
                res.contentType(result.contentType!);
                setHeaders(result.headers!)
                return res.send(result.text!);
            }

            async function sendFail(result: ProxyResult, params: ProxyTypeParams) {
                res.status(getOrCall($this.config.failStatus, params)!);
                res.contentType('text/plain');
                setHeaders(result.headers!)
                const errMsg = getOrCall($this.config.customError, result.error!) ?? Logger.errorStr(result.error!);
                return res.send(errMsg);
            }

            function setHeaders(headers: any) {
                for (let key in headers) {
                    try {
                        res.set(key, headers[key]);
                    } catch (err) {
                        Logger.errorStr(`Invalid headers:\nKey: ${key}\nValue: ${headers[key]})`);
                    }
                }
            }
        });

        // Error Handler
        app.use((err: any, req: any, res: any, next: any) => {
            Logger.error('Error', err, true);
            res.contentType('text/plain');
            res.status(err.status || 500);
            const errMsg = getOrCall(this.config.customError, err) ?? Logger.errorStr(err);
            res.send(errMsg);
            next();
        });

        // HTTP Listen
        if (this.config.httpPort) {
            app.listen(this.config.httpPort, this.config.hostname!, () => {
                Logger.info('\n----- Starting HTTP SSR Proxy -----');
                Logger.info(`Listening on http://${this.config.hostname!}:${this.config.httpPort!}`);
                Logger.info(`Proxy: ${this.config.targetRoute!}`);
                Logger.info(`DirPath: ${this.config.static!.dirPath!}`);
                Logger.info(`ProxyOrder: ${this.config.proxyOrder!}\n`);
            });
        }

        // HTTPS Listen
        if (this.config.httpsPort && this.config.httpsKey && this.config.httpsCert) {
            const server = https.createServer({
                key: fs.readFileSync(this.config.httpsKey),
                cert: fs.readFileSync(this.config.httpsCert),
            }, app);
            server.listen(this.config.httpsPort, this.config.hostname!, () => {
                Logger.info('\n----- Starting HTTPS SSR Proxy -----');
                Logger.info(`Listening on https://${this.config.hostname!}:${this.config.httpsPort!}`);
                Logger.info(`Proxy: ${this.config.targetRoute!}`);
                Logger.info(`DirPath: ${this.config.static!.dirPath!}`);
                Logger.info(`ProxyOrder: ${this.config.proxyOrder!}\n`);
            });
        }

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

        if (this.config.processor != null) result = await this.config.processor(params, result);

        return { result, proxyType };
    }

    private async runSsrProxy(params: ProxyParams, logger: Logger, headers: any): Promise<ProxyResult> {
        const cSsr = this.config.ssr!;
        const cacheKey = `${ProxyType.SsrProxy}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.SsrProxy };

        const shouldUse = getOrCall(cSsr.shouldUse, params)!;
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

            let { text, error, headers: ssrHeaders, ttRenderMs } = await this.tryRender(params.targetUrl.toString(), logger, headers);

            const isSuccess = error == null;

            logger.info(`SSR Result | Render Time: ${ttRenderMs}ms | Success: ${isSuccess}${isSuccess ? '' : ` | Message: ${error}`}`);

            if (!isSuccess) return { error };
            if (text == null) text = '';

            const resHeaders = {
                ...(ssrHeaders || {}),
                'Server-Timing': `Prerender;dur=${ttRenderMs};desc="Headless render time (ms)"`,
            };
            
            const contentType = this.getContentType(params.targetUrl.pathname);

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

        const shouldUse = getOrCall(cHttpProxy.shouldUse, params)!;
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

            // Indicate http proxy to client
            for (let param of cHttpProxy.queryParams!)
                params.targetUrl.searchParams.set(param.key, param.value);

            this.fixReqHeaders(headers);

            const response = await axios.request({
                url: params.targetUrl.toString(),
                method: method as any,
                responseType: 'stream',
                headers: headers as any,
                httpsAgent: new https.Agent({ rejectUnauthorized: getOrCall(cHttpProxy.unsafeHttps, params) }),
                timeout: cHttpProxy.timeout,
            });

            logger.debug(`HttpProxy result: ${response.statusText}`);

            const contentType = this.getContentType(params.targetUrl.pathname);

            this.trySaveCacheStream(response.data, contentType, cacheKey, typeParams, logger);

            this.fixResHeaders(response.headers);

            return { stream: response.data, headers: response.headers, contentType };
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

        const shouldUse = getOrCall(cStatic.shouldUse, params)!;
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

            const filePath = path.join(cStatic.dirPath!, params.sourceUrl);

            logger.debug(`Static Path: ${filePath}`);

            if (!fs.existsSync(filePath))
                throw new Error(`File Not Found: ${filePath}`);

            const fileStream = fs.createReadStream(filePath);
            
            const contentType = this.getContentType(filePath);

            this.trySaveCacheStream(fileStream, contentType, cacheKey, typeParams, logger);

            return { stream: fileStream, contentType };
        } catch (err: any) {
            logger.error('StaticError', err, false);
            return { error: err };
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

            const url = new URL(urlStr);

            // Indicate headless render to client
            // e.g. use to disable some features if ssr
            for (let param of cSsr.queryParams!)
                url.searchParams.set(param.key, param.value);

            logger.debug('SSR: Connecting');
            const browser = await puppeteer.connect({ browserWSEndpoint: this.browserWSEndpoint });

            logger.debug('SSR: New Page');
            const page = await browser.newPage();

            // Intercept network requests
            let interceptCount = 0;
            await page.setRequestInterception(true);
            page.on('request', req => {
                interceptCount++;

                // Ignore requests for resources that don't produce DOM (e.g. images, stylesheets, media)
                const reqType = req.resourceType();
                if (!cSsr.allowedResources!.includes(reqType)) return req.abort();

                // Custom headers
                let origHeaders = req.headers();
                if (interceptCount === 1) {
                    origHeaders = { ...(headers || {}), ...(origHeaders || {}) };
                    this.fixReqHeaders(origHeaders);
                }

                // Pass through all other requests
                req.continue({ headers: origHeaders });
            });

            logger.debug('SSR: Accessing');
            const response = await page.goto(url.toString(), { waitUntil: cSsr.waitUntil, timeout: cSsr.timeout });
            // await page.waitForNetworkIdle({ idleTime: 1000, timeout: cSsr.timeout });

            const resHeaders = response?.headers();
            this.fixResHeaders(resHeaders);

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

    private fixReqHeaders(headers: any) {
        delete headers['host'];
        delete headers['referer'];
        delete headers['user-agent'];
    }

    private fixResHeaders(headers: any) {
        // TODO: fix response headers
        delete headers['content-encoding'];
    }

    // Cache

    private tryGetCache(cacheKey: string, params: ProxyTypeParams, logger: Logger): CacheItem | null {
        const cCache = this.config.cache!;

        const shouldUse = getOrCall(cCache.shouldUse, params)! && this.proxyCache?.has(cacheKey);
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

        const shouldUse = getOrCall(cCache.shouldUse, params)! && this.proxyCache!;
        if (shouldUse) {
            logger.debug(`Caching: ${cacheKey}`);
            this.proxyCache!.set(cacheKey, text, contentType);
            this.tryClearCache(logger);
        }
    }

    private trySaveCacheStream(stream: Stream, contentType: string, cacheKey: string, params: ProxyTypeParams, logger: Logger) {
        const cCache = this.config.cache!;

        const shouldUse = getOrCall(cCache.shouldUse, params)! && this.proxyCache!;
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
}
