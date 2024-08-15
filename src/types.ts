import { BrowserConnectOptions, BrowserLaunchArgumentOptions, LaunchOptions, Product, PuppeteerLifeCycleEvent, ResourceType } from 'puppeteer';
import { Stream } from 'stream';

// SSR Proxy

export enum ProxyType {
    SsrProxy = 'SsrProxy',
    HttpProxy = 'HttpProxy',
    StaticProxy = 'StaticProxy',
}

export interface SsrRenderResult {
    text?: string;
    error?: string;
    headers?: ProxyHeaders;
    ttRenderMs: number;
}

export interface ProxyResult {
    text?: string;
    stream?: Stream;
    contentType?: string;
    skipped?: boolean;
    error?: any;
    headers?: ProxyHeaders;
}

export type ProxyHeaders = Record<string, string>;

export interface ProxyParams {
    sourceUrl: string;
    method: string;
    headers: ProxyHeaders;
    targetUrl: URL;
    isBot: boolean;
    cacheBypass: boolean;
    lastError?: any;
}

export interface ProxyTypeParams extends ProxyParams {
    proxyType: ProxyType;
}

export type SsrBrowerConfig = LaunchOptions & BrowserLaunchArgumentOptions & BrowserConnectOptions & {
    product?: Product;
    extraPrefsFirefox?: Record<string, unknown>;
};

/**
 * Proxy config
 * @public
 */
export interface SsrProxyConfig {
    /**
     * Proxy server http port
     * @default 8080
     */
    httpPort?: number;
    /**
     * Proxy server https port
     * @default 8443
     */
    httpsPort?: number;
    /**
     * Proxy server https key
     * @default undefined
     */
    httpsKey?: string;
    /**
     * Proxy server https cert
     * @default undefined
     */
    httpsCert?: string;
    /**
     * Proxy server hostname
     * @default '0.0.0.0'
     */
    hostname?: string;
    /**
     * Target route for SSR and HTTP proxy
     * 
     * With the default configuration, http://0.0.0.0:8080 will proxy to http://localhost:80
     * @default 'http://localhost:80'
     */
    targetRoute?: string;
    /**
     * Defines the order which the proxy service will follow in case of errors
     * 
     * For example, if defined as [ProxyType.SsrProxy, ProxyType.HttpProxy, ProxyType.StaticProxy],
     * it will try to use Server-Side Rendering first, and in case of an error, will try to use a HTTP Proxy,
     * and if that fails, it will fallback to Static File Serving
     * 
     * Note: "error" in this context can mean an actual exception, or "shouldUse" returning false
     * @default [ProxyType.SsrProxy, ProxyType.HttpProxy, ProxyType.StaticProxy]
     */
    proxyOrder?: ProxyType[];
    /**
     * Custom implementation to define whether the client is a bot (e.g. Googlebot)
     * 
     * @default Defaults to 'https://www.npmjs.com/package/isbot'
     */
    isBot?: boolean | ((method: string, url: string, headers: ProxyHeaders) => boolean);
    /**
     * Which HTTP response status code to return in case of an error
     * @default 404
     */
    failStatus?: number | ((params: ProxyTypeParams) => number);
    /**
     * Custom error message handler
     * @example err => err.toString()
     * @default undefined
     */
    customError?: string | ((err: any) => string);
    /**
     * Skip to next proxy type on error
     * @default true
     */
    skipOnError?: boolean;
    /**
     * Function for processing the original request before proxying
     * @default undefined
     */
    reqMiddleware?: (params: ProxyParams) => Promise<ProxyParams>;
    /**
     * Function for processing the proxy result before serving
     * @default undefined
     */
    resMiddleware?: (params: ProxyParams, result: ProxyResult) => Promise<ProxyResult>;
    /**
     * Server-Side Rendering configuration
     */
    ssr?: {
        /**
         * Indicates if the SSR Proxy should be used
         * @default params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname))
         */
        shouldUse?: boolean | ((params: ProxyParams) => boolean);
        /**
         * Browser configuration used by Puppeteer
         * @default
         * { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 }
         */
        browserConfig?: SsrBrowerConfig;
        /**
         * Which query string params to include in the url before proxying
         * @default
         * [{ key: 'headless', value: 'true' }]
         */
        queryParams?: {
            key: string;
            value: string;
        }[];
        /**
         * Which resource types to load
         * @default
         * ['document', 'script', 'xhr', 'fetch']
         */
        allowedResources?: ResourceType[];
        /**
         * Which events to wait before returning the rendered HTML
         * @default 'networkidle0'
         */
        waitUntil?: PuppeteerLifeCycleEvent | PuppeteerLifeCycleEvent[];
        /**
         * Timeout
         * @default 60000
         */
        timeout?: number;
        /**
         * Cron expression for closing the shared browser instance
         * @default undefined
         */
         cleanUpCron?: string;
         /**
          * Tz for cleanUpCron
          * @default 'Etc/UTC'
          */
         cleanUpTz?: string;
    };
    /**
     * HTTP Proxy configuration
     */
    httpProxy?: {
        /**
         * Indicates if the HTTP Proxy should be used
         * @default true
         */
        shouldUse?: boolean | ((params: ProxyParams) => boolean);
        /**
         * Which query string params to include in the url before proxying
         * @example
         * [{ key: 'headless', value: 'false' }]
         * @default
         * []
         */
        queryParams?: {
            key: string;
            value: string;
        }[];
        /**
         * Ignore https errors via rejectUnauthorized=false
         * @default false
         */
        unsafeHttps?: boolean | ((params: ProxyParams) => boolean);
        /**
         * Timeout
         * @default 60000
         */
        timeout?: number;
    };
    /**
     * Static File Serving configuration
     */
    static?: {
        /**
         * Indicates if the Static File Serving should be used
         * @default false
         */
        shouldUse?: boolean | ((params: ProxyParams) => boolean);
        /**
         * Absolute path of the directory to serve
         * @default path.join(path.dirname(process.argv[1]), 'public')
         */
        dirPath?: string;
        /**
         * Indicates whether to use the default index file
         * @default path => path.endsWith('/')
         */
        useIndexFile?: (path: string) => boolean;
        /**
         * Default index file to use
         * @default 'index.html'
         */
        indexFile?: string;
    };
    /**
     * Logging configuration
     */
    log?: {
        /**
         * Logging level
         * @example
         * ```text
         * None = 0, Error = 1, Info = 2, Debug = 3
         * ```
         * @default 2
         */
        level?: LogLevel;
        /**
         * Console logging configuration
         */
        console?: {
            /**
             * Indicates whether to enable the console logging method
             * @default true
             */
            enabled?: boolean;
        };
        /**
         * File logging configuration
         */
        file?: {
            /**
             * Indicates whether to enable the file logging method
             * @default true
             */
            enabled?: boolean;
            /**
             * Absolute path of the logging directory
             * @default path.join(os.tmpdir(), 'ssr-proxy-js/logs')
             */
            dirPath?: string;
        };
    };
    /**
     * Caching configuration
     */
    cache?: {
        /**
         * Indicates if the caching should be used
         * @default params => params.proxyType === ProxyType.SsrProxy
         */
        shouldUse?: boolean | ((params: ProxyTypeParams) => boolean);
        /**
         * Defines the maximum number of pages to cache
         * @default 50
         */
        maxEntries?: number;
        /**
         * Defines the maximum size of the cache in bytes
         * @default 50 * 1000 * 1000 // 50MB
         */
        maxByteSize?: number;
        /**
         * Defines the expiration time for each cached page
         * @default 25 * 60 * 60 * 1000 // 25h
         */
        expirationMs?: number;
        /**
         * Auto refreshing configuration
         * 
         * Auto refresh will access the configured pages periodically, and cache the result to be used on following access
         */
        autoRefresh?: {
            /**
             * Enable auto refreshing
             * @default false
             */
            enabled?: boolean;
            /**
             * Indicates if the auto refresh should be used
             * @default true
             */
            shouldUse?: boolean | (() => boolean);
            /**
             * Defines the order which the proxy service will follow in case of errors, similar to 'config.proxyOrder'
             * @default [ProxyType.SsrProxy]
             */
            proxyOrder?: ProxyType[];
            /**
             * Delay before first refresh
             * @default 5 * 1000 // 5s
             */
            initTimeoutMs?: number;
            /**
             * Cron expression for interval between refreshes
             * @default '0 0 3 * * *' // every day at 3am
             */
            intervalCron?: string;
            /**
             * Tz for intervalCron
             * @default 'Etc/UTC'
             */
            intervalTz?: string;
            /**
             * Number of retries if fails
             * @default 3
             */
            retries?: number;
            /**
             * Maximum number of parallel refreshes
             * @default 5 * 60 * 1000 // 5 minutes
             */
            parallelism?: number;
            /**
             * Whether to close the shared browser instance after refreshing the cache
             * @default true
             */
            closeBrowser?: boolean;
            /**
             * Whether to access routes as bot while auto refreshing
             * @default true
             */
            isBot?: boolean;
            /**
             * Routes to auto refresh
             * @default
             * [{ method: 'GET', url: '/' }]
             */
            routes?: {
                /**
                 * Route HTTP Method
                 * @example 'GET'
                 */
                method: string;
                /**
                 * Route URL
                 * @example '/example/'
                 */
                url: string;
                /**
                 * Route Headers
                 * @example { 'X-Example': 'Test' }
                 */
                headers?: ProxyHeaders;
            }[];
        };
    };
}

// Proxy Cache

export interface CacheItem {
    text: string;
    contentType: string;
}

export interface CacheDeletion {
    key: string;
    reason: string;
}

export interface InternalCacheItem {
    text: string;
    contentType: string;
    hits: number;
    date: Date;
}

// Logger

export enum LogLevel {
    None = 0,
    Error = 1,
    Info = 2,
    Debug = 3
}