import axios from 'axios';
import cloneDeep from 'clone-deep';
import deepmerge from 'deepmerge';
import express from 'express';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { isbot } from 'isbot';
import mime from 'mime-types';
import { scheduleJob } from 'node-schedule';
import os from 'os';
import path from 'path';
import { Stream } from 'stream';
import { Logger } from './logger';
import { ProxyCache } from './proxy-cache';
import { SsrRender } from './ssr-render';
import { CacheItem, LogLevel, HttpHeaders, ProxyParams, ProxyResult, ProxyType, ProxyTypeParams, SsrProxyConfig } from './types';
import { getOrCall, promiseParallel, promiseRetry, streamToString } from './utils';

export class SsrProxy extends SsrRender {
    private config: SsrProxyConfig;
    private proxyCache?: ProxyCache; // In-memory cache of rendered pages

    constructor(customConfig: SsrProxyConfig) {
        const defaultConfig: SsrProxyConfig = {
            // TODO: AllowRedirect: boolean, return without redirecting
            httpPort: 8080,
            httpsPort: 8443,
            httpsKey: undefined,
            httpsCert: undefined,
            hostname: '0.0.0.0',
            targetRoute: 'http://localhost:80',
            proxyOrder: [ProxyType.SsrProxy, ProxyType.HttpProxy, ProxyType.StaticProxy],
            isBot: (method, url, headers) => headers?.['user-agent'] ? isbot(headers['user-agent']) : false,
            failStatus: 404,
            customError: undefined,
            skipOnError: true,
            forceExit: true,
            reqMiddleware: undefined,
            resMiddleware: undefined,
            ssr: {
                shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname)),
                browserConfig: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 },
                sharedBrowser: true,
                queryParams: [{ key: 'headless', value: 'true' }],
                allowedResources: ['document', 'script', 'xhr', 'fetch'],
                waitUntil: 'networkidle0',
                timeout: 60000,
                sleep: undefined,
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
                dirPath: 'public',
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

        let config: SsrProxyConfig;

        if (customConfig) {
            config = deepmerge<SsrProxyConfig>(defaultConfig, customConfig, {
                arrayMerge: (destArray, srcArray, opts) => srcArray,
            });
        } else {
            console.warn('No configuration found for ssr-proxy-js, using default config!');
            config = defaultConfig;
        }

        if (config.static) config.static.dirPath = path.isAbsolute(config.static.dirPath!) ? config.static.dirPath! : path.join(process.cwd(), config.static.dirPath!);
        if (config.cache!.autoRefresh!.parallelism! < 1) throw new Error(`Parallelism should be greater than 0 (${config.cache!.autoRefresh!.parallelism})`);

        super(config.ssr!);
        this.config = config;

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

        const { server } = this.listen();
        
        const shutDown = async () => {
            Logger.info('Shutting down...');

            await this.browserShutDown();

            Logger.info('Closing the server...');
            server.close(() => {
                Logger.info('Shut down completed!');
                if (this.config.forceExit) process.exit(0);
            });

            if (this.config.forceExit) {
                setTimeout(() => {
                    Logger.error(`Shutdown`, 'Could not shut down in time, forcefully shutting down!');
                    process.exit(1);
                }, 10000);
            }
        };
        process.on('SIGTERM', shutDown);
        process.on('SIGINT', shutDown);
    }

    private async startCleanUpJob() {
        const cleanUpCron = this.config.ssr!.cleanUpCron;
        const cleanUpTz = this.config.ssr!.cleanUpTz;
        if (!cleanUpCron) return;
        scheduleJob({ rule: cleanUpCron, tz: cleanUpTz }, async () => {
            this.sharedBrowser?.close();
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
                        await promiseRetry(runProxy, cAutoCache.retries!, e => logger.warn('CacheRefresh Retry', e));
                        res('ok');
                    } catch (err) {
                        logger.error('CacheRefresh', err);
                        rej(err);
                    }

                    async function runProxy() {
                        const targetUrl = new URL(route.url, $this.config.targetRoute!);
                        const params: ProxyParams = { isBot: cAutoCache.isBot!, cacheBypass: true, sourceUrl: route.url, targetUrl, method: route.method, headers: route.headers || {} };
                        const { proxyType, result } = await $this.runProxy(params, cAutoCache.proxyOrder!, logger);
                    }
                })), cAutoCache.parallelism!, true);

                logger.info(`Cache Refreshed!`);
            } catch (err) {
                logger.error('CacheRefresh', err);
            } finally {
                if (cAutoCache.closeBrowser) $this.sharedBrowser?.close();
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

                logger.info(`[${method}] ${sourceUrl} | IsBot: ${isBot} | User Agent: ${headers['user-agent']}`);

                const params: ProxyParams = { isBot, cacheBypass: false, method, sourceUrl, headers, targetUrl };

                const { proxyType, result } = await this.runProxy(params, this.config.proxyOrder!, logger);

                const proxyTypeParams: ProxyTypeParams = { ...params, proxyType };

                // if (proxyType === ProxyType.Redirect) return sendRedirect(result, proxyTypeParams);
                if (result?.error != null) return sendFail(result, proxyTypeParams);
                else if (result?.text != null) return sendText(result, proxyTypeParams);
                else if (result?.stream != null) return sendStream(result, proxyTypeParams);
                else return sendFail({ ...result, error: 'No Proxy Result' }, proxyTypeParams);
            } catch (err) {
                return next(err);
            }

            async function sendText(result: ProxyResult, params: ProxyTypeParams) {
                res.status(result.status || 200);
                res.contentType(result.contentType!);
                setHeaders(result.headers!)
                return res.send(result.text!);
            }

            async function sendStream(result: ProxyResult, params: ProxyTypeParams) {
                res.status(result.status || 200);
                res.contentType(result.contentType!);
                setHeaders(result.headers!)
                return result.stream!.on('error', err => {
                    res.status(getOrCall($this.config.failStatus, params)!);
                    // res.contentType('text/plain');
                    // const error = Logger.errorStr(result.error!);
                    return res.send();
                }).pipe(res);
            }

            // async function sendRedirect(result: ProxyResult, params: ProxyTypeParams) {
            //     res.status(result.status || 302);
            //     setHeaders(result.headers!)
            //     return res.redirect(result.text!);
            // }

            async function sendFail(result: ProxyResult, params: ProxyTypeParams) {
                res.status(getOrCall($this.config.failStatus, params)!);
                res.contentType('text/plain');
                setHeaders(result.headers!)
                const errMsg = getOrCall($this.config.customError, result.error!) ?? Logger.errorStr(result.error!);
                return res.send(errMsg);
            }

            function setHeaders(headers: HttpHeaders) {
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

        let server: http.Server;

        if (this.config.httpPort) {
            // HTTP Listen
            server = app.listen(this.config.httpPort, this.config.hostname!, () => {
                Logger.info('----- Starting HTTP SSR Proxy -----');
                Logger.info(`Listening on http://${this.config.hostname!}:${this.config.httpPort!}`);
                Logger.info(`Proxy: ${this.config.targetRoute!}`);
                Logger.info(`DirPath: ${this.config.static!.dirPath!}`);
                Logger.info(`ProxyOrder: ${this.config.proxyOrder!}\n`);
            });
        } else if (this.config.httpsPort && this.config.httpsKey && this.config.httpsCert) {
            // HTTPS Listen
            server = https.createServer({
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
        } else {
            throw new Error('Invalid Ports or Certificates');
        }

        return { app, server };
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
                // const redirect = await this.checkForRedirect(proxyParams, logger);
                // if (redirect.status) return { result: redirect, proxyType: ProxyType.Redirect };

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

        return { proxyType, result };
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
            logger.info(`Using SsrProxy: ${params.targetUrl}`);

            // Try use Cache

            const cache = !params.cacheBypass && this.tryGetCache(cacheKey, typeParams, logger);
            if (cache) {
                logger.info(`SSR Cache Hit`);
                return { text: cache.text, contentType: cache.contentType };
            }

            // Try use SsrProxy

            let { status, text, error, headers: ssrHeaders, ttRenderMs } = await this.tryRender(params.targetUrl.toString(), params.headers, logger, params.method);

            status ||= 200;
            const isSuccess = error == null;

            logger.info(`SSR Result | Render Time: ${ttRenderMs}ms | Success: ${isSuccess}${isSuccess ? '' : ` | Message: ${error}`}`);

            if (!isSuccess) return { error };
            if (text == null) text = '';

            const resHeaders = {
                ...(ssrHeaders || {}),
                'Server-Timing': `Prerender;dur=${ttRenderMs};desc="Headless render time (ms)"`,
            };
            
            const contentType = this.getContentType(params.targetUrl.pathname);

            this.trySaveCache(text, status, contentType, cacheKey, typeParams, logger);

            return { text, status, contentType, headers: resHeaders };
        } catch (err: any) {
            logger.error('SsrError', err);
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

            const status = response.status;

            const resHeaders = this.fixResHeaders(response.headers);

            logger.debug(`HttpProxy: Connected - ${JSON.stringify(resHeaders)}`);

            const contentType = this.getContentType(params.targetUrl.pathname);

            this.trySaveCacheStream(response.data, status, contentType, cacheKey, typeParams, logger);

            return { status: response.status, stream: response.data, headers: resHeaders, contentType };
        } catch (err: any) {
            const error = err?.response?.data ? await streamToString(err.response.data).catch(err => err) : err;
            logger.error('HttpProxyError', error);
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

            this.trySaveCacheStream(fileStream, 200, contentType, cacheKey, typeParams, logger);

            return { stream: fileStream, status: 200, contentType };
        } catch (err: any) {
            logger.error('StaticError', err);
            return { error: err };
        }
    }

    // private async checkForRedirect(proxyParams: ProxyParams, logger: Logger): Promise<ProxyResult> {
    //     // TODO:
    //     // cache the redirect
    //     // fix targetUrl: Target (http://web-server:8080/)

    //     try {
    //         const targetUrl = proxyParams.targetUrl.toString();

    //         logger.debug(`Redirect: Checking (${targetUrl})`);

    //         // Use axios with a short timeout and redirect: false
    //         const response = await axios.request({
    //             url: targetUrl,
    //             method: 'HEAD', // HEAD request is faster than GET
    //             headers: this.fixReqHeaders(proxyParams.headers),
    //             maxRedirects: 0, // Don't follow redirects
    //             validateStatus: (status) => status < 400 || status === 404, // Accept any status that isn't an error
    //             timeout: 5000 // 5 second timeout
    //         });
    
    //         // Check if this is a redirect status
    //         if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
    //             logger.info(`Redirect: Detected (${targetUrl} - ${response.status})`);
    //             const location = response.headers['location'];

    //             if (location) {
    //                 const redirectUrl = new URL(location, targetUrl).toString();
    //                 logger.info(`Redirect: Target (${redirectUrl})`);

    //                 return {
    //                     text: redirectUrl,
    //                     status: response.status,
    //                     headers: this.fixResHeaders(response.headers),
    //                 };
    //             }
    //         }
            
    //         return {};
    //     } catch (err: any) {
    //         return { error: err };
    //     }
    // }

    private getContentType(path: string) {
        const isHtml = () => /\.html$/.test(path) || !/\./.test(path)
        const type = mime.lookup(path) || (isHtml() ? 'text/html' : 'text/plain');
        return type;
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

    private trySaveCache(text: string, status: number, contentType: string, cacheKey: string, params: ProxyTypeParams, logger: Logger) {
        const cCache = this.config.cache!;

        const shouldUse = getOrCall(cCache.shouldUse, params)! && this.proxyCache!;
        if (shouldUse) {
            logger.debug(`Caching: ${cacheKey}`);
            this.proxyCache!.set(cacheKey, text, status, contentType);
            this.tryClearCache(logger);
        }
    }

    private trySaveCacheStream(stream: Stream, status: number, contentType: string, cacheKey: string, params: ProxyTypeParams, logger: Logger) {
        const cCache = this.config.cache!;

        const shouldUse = getOrCall(cCache.shouldUse, params)! && this.proxyCache!;
        if (shouldUse) {
            logger.debug(`Caching: ${cacheKey}`);
            this.proxyCache!.pipe(cacheKey, stream, status, contentType)
                .then(() => this.tryClearCache(logger))
                .catch(err => logger.error('SaveCacheStream', err));
        }
    }

    private tryClearCache(logger: Logger) {
        if (this.proxyCache!) {
            const deleted = this.proxyCache.tryClear();
            if (deleted.length) logger.debug(`Cache Cleared: ${JSON.stringify(deleted)}`);
        }
    }
}
