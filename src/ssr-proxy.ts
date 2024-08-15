import axios from 'axios';
import cloneDeep from 'clone-deep';
import deepmerge from 'deepmerge';
import express from 'express';
import fs from 'fs';
import https from 'https';
import { isbot } from 'isbot';
import mime from 'mime-types';
import { scheduleJob } from 'node-schedule';
import os from 'os';
import path from 'path';
import puppeteer, { Browser } from 'puppeteer';
import { Stream } from 'stream';
import { Logger } from './logger';
import { ProxyCache } from './proxy-cache';
import { CacheItem, LogLevel, ProxyHeaders, ProxyParams, ProxyResult, ProxyType, ProxyTypeParams, SsrProxyConfig, SsrRenderResult } from './types';
import { getOrCall, promiseParallel, promiseRetry, streamToString } from './utils';

export class SsrProxy {
    private config: SsrProxyConfig;
    private proxyCache?: ProxyCache; // In-memory cache of rendered pages
    private browser?: { // Reusable browser connection
        browser: Promise<Browser>;
        wsEndpoint: Promise<string>;
        close: () => Promise<void>;
    };

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
            reqMiddleware: undefined,
            resMiddleware: undefined,
            failStatus: 404,
            customError: undefined,
            skipOnError: true,
            isBot: (method, url, headers) => headers?.['user-agent'] ? isbot(headers['user-agent']) : false,
            ssr: {
                shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname)),
                browserConfig: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 },
                queryParams: [{ key: 'headless', value: 'true' }],
                allowedResources: ['document', 'script', 'xhr', 'fetch'],
                waitUntil: 'networkidle0',
                timeout: 60000,
                cleanUpCron: undefined,
                cleanUpTz: 'Etc/UTC',
            },
            httpProxy: {
                shouldUse: true,
                queryParams: [],
                unsafeHttps: false,
                timeout: 60000,
            },
            static: {
                shouldUse: false,
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
                expirationMs: 25 * 60 * 60 * 1000, // 25h
                autoRefresh: {
                    enabled: false,
                    shouldUse: true,
                    proxyOrder: [ProxyType.SsrProxy],
                    initTimeoutMs: 5 * 1000, // 5s
                    intervalCron: '0 0 3 * * *', // every day at 3am
                    intervalTz: 'Etc/UTC',
                    retries: 3,
                    parallelism: 5,
                    closeBrowser: true,
                    isBot: true,
                    routes: [{ method: 'GET', url: '/' }],
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
        this.startCleanUpJob();
        this.startCacheJob();
        const app = this.listen();
    }

    private async startCleanUpJob() {
        const cleanUpCron = this.config.ssr!.cleanUpCron;
        const cleanUpTz = this.config.ssr!.cleanUpTz;
        if (!cleanUpCron) return;
        scheduleJob({ rule: cleanUpCron, tz: cleanUpTz }, async () => {
            this.browser?.close();
        });
    }

    private startCacheJob() {
        const $this = this;
        const cCache = this.config.cache!;
        const cAutoCache = cCache.autoRefresh!;

        const enabled = cAutoCache.enabled! && cAutoCache.routes! && cAutoCache.routes!.length!;
        if (!enabled) return;

        if (cAutoCache.initTimeoutMs)
            setTimeout(runRefresh, cAutoCache.initTimeoutMs);

        if (cAutoCache.intervalCron)
            scheduleJob({ rule: cAutoCache.intervalCron, tz: cAutoCache.intervalTz }, runRefresh);

        async function runRefresh() {
            const logger = new Logger(true);

            try {
                if (!cAutoCache.shouldUse || !getOrCall(cAutoCache.shouldUse) || !cAutoCache.routes?.length) return;

                const routesStr = '> ' + cAutoCache.routes!.map(e => e.url).join('\n> ');
                logger.info(`Refreshing Cache:\n${routesStr}`);

                await promiseParallel(cAutoCache.routes!.map((route) => () => new Promise(async (res, rej) => {
                    try {
                        await promiseRetry(runProxy, cAutoCache.retries!, e => logger.warn('CacheRefresh Retry', e, false));
                        res('ok');
                    } catch (err) {
                        logger.error('CacheRefresh', err, false);
                        rej(err);
                    }

                    async function runProxy() {
                        const targetUrl = new URL(route.url, $this.config.targetRoute!);
                        const params: ProxyParams = { isBot: cAutoCache.isBot!, cacheBypass: true, sourceUrl: route.url, targetUrl, method: route.method, headers: route.headers || {} };
                        const { result, proxyType } = await $this.runProxy(params, cAutoCache.proxyOrder!, logger);
                    }
                })), cAutoCache.parallelism!, true);
            } catch (err) {
                logger.error('CacheRefresh', err, false);
            } finally {
                if (cAutoCache.closeBrowser) $this.browser?.close();
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
                const method = req.method;
                const headers = this.fixHeaders(req.headers);

                const isBot = getOrCall(this.config.isBot, method, sourceUrl, headers)!;

                const params: ProxyParams = { isBot, cacheBypass: false, method, sourceUrl, headers, targetUrl };

                const { result, proxyType } = await this.runProxy(params, this.config.proxyOrder!, logger);

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

            function setHeaders(headers: ProxyHeaders) {
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

    private async runProxy(params: ProxyParams, proxyOrder: ProxyType[], logger: Logger) {
        if (!proxyOrder.length) throw new Error('Invalid Proxy Order');

        params.headers ||= {};
        params.method ||= 'GET';

        let result: ProxyResult = {};
        let proxyType: ProxyType = proxyOrder[0];

        for (let i in proxyOrder) {
            proxyType = proxyOrder[i];

            const proxyParams = cloneDeep(this.config.reqMiddleware != null ? await this.config.reqMiddleware(params) : params);

            try {
                if (proxyType === ProxyType.SsrProxy) {
                    result = await this.runSsrProxy(proxyParams, logger);
                } else if (proxyType === ProxyType.HttpProxy) {
                    result = await this.runHttpProxy(proxyParams, logger);
                } else if (proxyType === ProxyType.StaticProxy) {
                    result = await this.runStaticProxy(proxyParams, logger);
                } else {
                    throw new Error('Invalid Proxy Type');
                }
            } catch (err) {
                result = { error: err };
                params.lastError = err;
            }

            // Success
            if (!result.skipped && result.error == null) break;

            // Bubble up errors
            if (!this.config.skipOnError && result.error != null)
                throw (typeof result.error === 'string' ? new Error(result.error) : result.error);
        }

        if (this.config.resMiddleware != null) result = await this.config.resMiddleware(params, result);

        return { result, proxyType };
    }

    private async runSsrProxy(params: ProxyParams, logger: Logger): Promise<ProxyResult> {
        const cSsr = this.config.ssr!;
        const cacheKey = `${ProxyType.SsrProxy}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.SsrProxy };

        const shouldUse = getOrCall(cSsr.shouldUse, params)!;
        if (!shouldUse) {
            logger.debug(`Skipped SsrProxy: ${params.targetUrl}`);
            return { skipped: true };
        }

        try {
            logger.debug(`Using SsrProxy: ${params.targetUrl}`);

            logger.info(`Bot Access | URL: ${params.sourceUrl} | User Agent: ${params.headers['user-agent']}`);

            // Try use Cache

            const cache = !params.cacheBypass && this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`SSR Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use SsrProxy

            let { text, error, headers: ssrHeaders, ttRenderMs } = await this.tryRender(params.targetUrl.toString(), logger, params.headers);

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

    private async runHttpProxy(params: ProxyParams, logger: Logger): Promise<ProxyResult> {
        const cHttpProxy = this.config.httpProxy!;
        const cacheKey = `${ProxyType.HttpProxy}:${params.method}:${params.targetUrl}`;
        const typeParams = { ...params, proxyType: ProxyType.HttpProxy };

        const shouldUse = getOrCall(cHttpProxy.shouldUse, params)!;
        if (!shouldUse) {
            logger.debug(`Skipped HttpProxy: ${params.targetUrl}`);
            return { skipped: true };
        }

        try {
            logger.debug(`Using HttpProxy: ${params.targetUrl}`);

            // Try use Cache

            const cache = !params.cacheBypass && this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`HTTP Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use HttpProxy

            // Indicate http proxy to client
            for (let param of cHttpProxy.queryParams!)
                params.targetUrl.searchParams.set(param.key, param.value);

            const reqHeaders = this.fixReqHeaders(params.headers);

            logger.debug(`HttpProxy: Connecting - ${JSON.stringify(reqHeaders)}`);

            const response = await axios.request({
                url: params.targetUrl.toString(),
                method: params.method as any,
                responseType: 'stream',
                headers: reqHeaders,
                httpsAgent: new https.Agent({ rejectUnauthorized: getOrCall(cHttpProxy.unsafeHttps, params) }),
                timeout: cHttpProxy.timeout,
            });

            const resHeaders = this.fixResHeaders(response.headers);

            logger.debug(`HttpProxy: Connected - ${JSON.stringify(resHeaders)}`);

            const contentType = this.getContentType(params.targetUrl.pathname);

            this.trySaveCacheStream(response.data, contentType, cacheKey, typeParams, logger);

            return { stream: response.data, headers: resHeaders, contentType };
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
            logger.debug(`Skipped StaticProxy: ${params.targetUrl}`);
            return { skipped: true };
        }

        try {
            logger.debug(`Using StaticProxy: ${params.targetUrl}`);

            // Try use Cache

            const cache = !params.cacheBypass && this.tryGetCache(cacheKey, typeParams, logger);
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

    private async tryRender(urlStr: string, logger: Logger, headers: ProxyHeaders): Promise<SsrRenderResult> {
        const cSsr = this.config.ssr!;
        const start = Date.now();

        try {
            if (!this.browser) {
                logger.debug('SSR: Creating browser instance');
                const browser = puppeteer.launch(cSsr.browserConfig!);
                const wsEndpoint = browser.then(e => e.wsEndpoint());
                this.browser = {
                    browser,
                    wsEndpoint,
                    close: async () => {
                        try {
                            logger.debug('SSR: Closing browser instance');
                            this.browser = undefined;
                            (await browser).close();
                        } catch (err) {
                            logger.error('BrowserCloseError', err, false);
                        }
                    },
                };
            }

            const url = new URL(urlStr);

            // Indicate headless render to client
            // e.g. use to disable some features if ssr
            for (let param of cSsr.queryParams!)
                url.searchParams.set(param.key, param.value);

            logger.debug('SSR: Connecting');
            const browser = await puppeteer.connect({ browserWSEndpoint: await this.browser.wsEndpoint });

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
                    origHeaders = this.fixReqHeaders({ ...(headers || {}), ...(origHeaders || {}) });
                    logger.debug(`SSR: Intercepted - ${JSON.stringify(origHeaders)}`);
                }

                // Pass through all other requests
                req.continue({ headers: origHeaders });
            });

            logger.debug('SSR: Accessing');
            const response = await page.goto(url.toString(), { waitUntil: cSsr.waitUntil, timeout: cSsr.timeout });
            // await page.waitForNetworkIdle({ idleTime: 1000, timeout: cSsr.timeout });

            const ssrHeaders = response?.headers();
            const resHeaders = this.fixResHeaders(ssrHeaders);

            logger.debug(`SSR: Connected - ${JSON.stringify(resHeaders)}`);

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
        const proxyHeaders = this.fixHeaders(headers);
        delete proxyHeaders['host'];
        delete proxyHeaders['referer'];
        delete proxyHeaders['user-agent'];
        return proxyHeaders;
    }

    private fixResHeaders(headers: any) {
        const proxyHeaders = this.fixHeaders({});
        // TODO: fix response headers
        // delete proxyHeaders['content-encoding'];
        // delete proxyHeaders['transfer-encoding'];
        return proxyHeaders;
    }

    private fixHeaders(headers: object) {
        return Object.entries(headers).reduce((acc, [key, value]) => (value != null ? { ...acc, [key.toLowerCase()]: value?.toString() } : acc), {} as ProxyHeaders);
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
