import deepmerge from 'deepmerge';
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Logger } from './logger';
import { SsrRender } from './ssr-render';
import { BuildParams, BuildResult, LogLevel, SsrBuildConfig } from './types';
import { promiseParallel, promiseRetry } from './utils';

export class SsrBuild extends SsrRender {
    private config: SsrBuildConfig;

    constructor(customConfig: SsrBuildConfig) {
        const defaultConfig: SsrBuildConfig = {
            httpPort: 8080,
            hostname: 'localhost',
            src: 'src',
            dist: 'dist',
            stopOnError: false,
            forceExit: false,
            serverMiddleware: undefined,
            reqMiddleware: undefined,
            resMiddleware: undefined,
            ssr: {
                browserConfig: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 },
                sharedBrowser: true,
                queryParams: [{ key: 'headless', value: 'true' }],
                allowedResources: ['document', 'script', 'xhr', 'fetch'],
                waitUntil: 'networkidle0',
                timeout: 60000,
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
            job: {
                retries: 3,
                parallelism: 5,
                routes: [{ method: 'GET', url: '/' }],
            },
        };

        let config: SsrBuildConfig;

        if (customConfig) {
            config = deepmerge<SsrBuildConfig>(defaultConfig, customConfig, {
                arrayMerge: (destArray, srcArray, opts) => srcArray,
            });
        } else {
            console.warn('No configuration found for ssr-proxy-js, using default config!');
            config = defaultConfig;
        }

        config.src = path.isAbsolute(config.src!) ? config.src! : path.join(process.cwd(), config.src!);
        config.dist = path.isAbsolute(config.dist!) ? config.dist! : path.join(process.cwd(), config.dist!);

        super(config.ssr!);
        this.config = config;

        const cLog = this.config.log;
        Logger.setLevel(cLog!.level!);
        Logger.configConsole(cLog!.console!.enabled!);
        Logger.configFile(cLog!.file!.enabled!, cLog!.file!.dirPath!);
    }

    async start() {
        Logger.info(`SrcPath: ${this.config.src!}`);
        Logger.info(`DistPath: ${this.config.dist!}`);

        const { server } = await this.serve();

        const shutDown = async () => {
            Logger.debug('Shutting down...');

            await this.browserShutDown();

            Logger.debug('Closing the server...');
            server.close(() => {
                Logger.debug('Shut down completed!');
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

        try {
            await this.render();
        } catch (err) {
            throw err;
        } finally {
            await shutDown();
        }
    }

    async serve() {
        const cfg = this.config;

        const app = express();

        // Serve Static Files
        app.use(express.static(cfg.src!));

        // Catch-all: Serve index.html for any non-file request
        app.use((req, res, next) => {
            if (cfg.serverMiddleware) cfg.serverMiddleware(req, res, next);
            else res.sendFile(path.join(cfg.src!, 'index.html'));
        });

        // Error Handler
        app.use((err: any, req: any, res: any, next: any) => {
            Logger.error('Error', err, true);
            res.contentType('text/plain');
            res.status(err.status || 500);
            res.send(Logger.errorStr(err));
            next();
        });

        // HTTP Listen
        const server = app.listen(this.config.httpPort!, this.config.hostname!, () => {
            Logger.debug('----- Starting HTTP Server -----');
            Logger.debug(`Listening on http://${this.config.hostname!}:${this.config.httpPort!}`);
        });

        return { app, server };
    }        

    async render() {
        const $this = this;
        const cJob = this.config.job!;

        const routesStr = '> ' + cJob.routes!.map(e => `[${e.method ?? 'GET'}] ${e.url}`).join('\n> ');
        Logger.info(`SSR Building (p:${cJob.parallelism},r:${cJob.retries}):\n${routesStr}`);

        await promiseParallel(cJob.routes!.map((route) => () => new Promise(async (res, rej) => {
            const logger = new Logger(true);

            try {
                await promiseRetry(runRender, cJob.retries!, e => logger.warn('SSR Build Retry', e, false));
                res('ok');
            } catch (err) {
                logger.error('SSR Build', err);
                rej(err);
            }

            async function runRender() {
                const targetUrl = new URL(route.url, `http://${$this.config.hostname!}:${$this.config.httpPort!}`);

                const params: BuildParams = { method: route.method, targetUrl, headers: route.headers || {} };
                if ($this.config.reqMiddleware) await $this.config.reqMiddleware(params);

                const { text, status, headers, ttRenderMs } = await $this.tryRender(params.targetUrl.toString(), params.headers || {}, logger, params.method);

                const filePath = path.join($this.config.dist!, params.targetUrl.pathname, params.targetUrl.pathname.endsWith('.html') ? '' : 'index.html');
                const result: BuildResult = { text, status, headers, filePath, encoding: 'utf-8' };
                if ($this.config.resMiddleware) await $this.config.resMiddleware(params, result);

                if (status !== 200) {
                    const msg = `Render failed: ${params.targetUrl} - Status ${status} - ${ttRenderMs}ms\n${text}`;
                    if ($this.config.stopOnError) throw new Error(msg);
                    logger.warn('SSR Build', msg);
                    return;
                }

                if (result.text == null) {
                    logger.warn('SSR Build', `Empty content: ${params.targetUrl} - ${ttRenderMs}ms`);
                    return;
                }

                logger.info(`Saving render: ${params.targetUrl} -> ${result.filePath}`);

                const dirPath = path.dirname(result.filePath);
                if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
                fs.writeFileSync(result.filePath, result.text, { encoding: result.encoding });

                logger.debug(`SSR Built: ${params.targetUrl} - ${ttRenderMs}ms`);
            }
        })), cJob.parallelism!, false);

        Logger.info(`SSR build finished!`);
    }
}
