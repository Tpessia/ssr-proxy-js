import puppeteer, { Browser, ContinueRequestOverrides, Page } from 'puppeteer';
import { Logger } from './logger';
import { HttpHeaders, SsrConfig, SsrRenderResult } from './types';
import { createLock } from './utils';

export abstract class SsrRender {
    constructor(protected configSsr: SsrConfig) { }

    // Reusable browser connection
    protected sharedBrowser?: {
        browser: Promise<Browser>;
        wsEndpoint: Promise<string>;
        close: () => Promise<void>;
    };

    protected tempBrowsers: Browser[] = [];

    private lock = createLock();

    protected async getBrowser(logger: Logger): Promise<Browser> {
        const cSsr = this.configSsr!;

        try {
            await this.lock(async () => {
                if (cSsr.sharedBrowser && !this.sharedBrowser) {
                    logger.debug('SSR: Creating browser instance');
                    const browserMain = puppeteer.launch(cSsr.browserConfig!);
                    const wsEndpoint = browserMain.then(e => e.wsEndpoint());
                    this.sharedBrowser = {
                        browser: browserMain,
                        wsEndpoint: wsEndpoint,
                        close: async () => {
                            try {
                                logger.debug('SSR: Closing browser instance');
                                this.sharedBrowser = undefined;
                                await (await browserMain).close();
                            } catch (err) {
                                logger.error('BrowserCloseError', err, false);
                            }
                        },
                    };
                }
            });
        } catch (err: any) {
            logger.error('BrowserError', err, false);
        }

        logger.debug('SSR: Connecting');
        const wsEndpoint = this.sharedBrowser?.wsEndpoint && await this.sharedBrowser.wsEndpoint;

        logger.debug(`SSR: WSEndpoint=${wsEndpoint}`);
        const browser = wsEndpoint ? await puppeteer.connect({ browserWSEndpoint: wsEndpoint }) : await puppeteer.launch(cSsr.browserConfig!);

        return browser;
    }

    protected async tryRender(urlStr: string, headers: HttpHeaders, logger: Logger, method?: string): Promise<SsrRenderResult> {
        const cSsr = this.configSsr!;
        const start = Date.now();

        let browser: Browser | undefined;
        let page: Page | undefined;

        try {
            browser = await this.getBrowser(logger);
            if (!cSsr.sharedBrowser) this.tempBrowsers.push(browser);

            // await sleep(10000); // test sigterm shutdown

            const url = new URL(urlStr);

            // Indicate headless render to client
            // e.g. use to disable some features if ssr
            for (let param of cSsr.queryParams!)
                url.searchParams.set(param.key, param.value);

            logger.debug('SSR: New Page');
            page = await browser.newPage();

            // Intercept network requests
            let interceptCount = 0;
            await page.setRequestInterception(true);
            page.on('request', req => {
                // console.log('Request:', req.url());

                interceptCount++;

                // Ignore requests for resources that don't produce DOM (e.g. images, stylesheets, media)
                const reqType = req.resourceType();
                if (!cSsr.allowedResources!.includes(reqType)) return req.abort();

                // Custom headers and method
                let override: ContinueRequestOverrides = { method: 'GET', headers: req.headers() };
                if (interceptCount === 1) {
                    if (method) override.method = method;
                    override.headers = this.fixReqHeaders({ ...(headers || {}), ...(override.headers || {}) });
                    logger.debug(`SSR: Intercepted - ${JSON.stringify(override.headers)}`);
                }

                // Pass through all other requests
                req.continue(override);
            });

            logger.debug('SSR: Accessing');
            const response = await page.goto(url.toString(), { waitUntil: cSsr.waitUntil, timeout: cSsr.timeout });
            // await page.waitForNetworkIdle({ idleTime: 1000, timeout: cSsr.timeout });

            const ssrHeaders = response?.headers();
            const resHeaders = this.fixResHeaders(ssrHeaders);

            logger.debug(`SSR: Connected - ${JSON.stringify(resHeaders)}`);

            // Serialized text of page DOM
            const text = await page.content();

            const ttRenderMs = Date.now() - start;

            return { text, headers: resHeaders, ttRenderMs };
        } catch (err: any) {
            let error = ((err && (err.message || err.toString())) || 'Proxy Error');
            const ttRenderMs = Date.now() - start;
            return { ttRenderMs, error };
        } finally {
            logger.debug('SSR: Closing');
            if (page && !page.isClosed()) await page.close();
            if (browser) {
                if (cSsr.sharedBrowser) {
                    await browser.disconnect();
                } else {
                    await browser.close();
                    this.tempBrowsers = this.tempBrowsers.filter(e => e !== browser);
                }
            }
            logger.debug('SSR: Closed');
        }
    }

    protected async browserShutDown() {
        if (this.configSsr!.sharedBrowser) {
            Logger.debug('Closing the shared browser...');
            await this.sharedBrowser?.close();
        } else {
            this.tempBrowsers.forEach(async (browser,i,arr) => {
                Logger.debug(`Closing temp browser ${browser?.process()?.pid} (${i+1}/${arr.length})...`);
                if (browser) await browser.close();
            });
        }
    }

    protected fixReqHeaders(headers: any) {
        const proxyHeaders = this.fixHeaders(headers);
        delete proxyHeaders['host'];
        delete proxyHeaders['referer'];
        delete proxyHeaders['user-agent'];
        return proxyHeaders;
    }

    protected fixResHeaders(headers: any) {
        const proxyHeaders = this.fixHeaders({});
        // TODO: fix response headers
        // delete proxyHeaders['content-encoding'];
        // delete proxyHeaders['transfer-encoding'];
        return proxyHeaders;
    }

    protected fixHeaders(headers: object) {
        return Object.entries(headers).reduce((acc, [key, value]) => (value != null ? { ...acc, [key.toLowerCase()]: value?.toString() } : acc), {} as HttpHeaders);
    }
}
