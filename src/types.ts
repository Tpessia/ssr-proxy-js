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
    headers?: any;
    ttRenderMs: number;
}

export interface ProxyResult {
    text?: string;
    stream?: Stream;
    contentType?: string;
    error?: any;
    headers?: any;
}

export interface ProxyParams {
    isBot: boolean;
    sourceUrl: string;
    targetUrl: URL;
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
     * Which HTTP response status code to return in case of an error
     * @default params => 404
     */
    failStatus?: number | ((params: ProxyTypeParams) => number);
    /**
     * Custom error message handler
     * @example err => err.toString()
     * @default undefined
     */
    customError?: string | ((err: any) => string);
    /**
     * Custom implementation to define whether the client is a bot (e.g. Googlebot)
     * 
     * Defaults to https://www.npmjs.com/package/isbot
     */
    isBot?: boolean | ((method: string, url: string, headers: any) => boolean);
    /**
     * Server-Side Rendering configuration
     */
    ssr?: {
        /**
         * Indicates if the SSR Proxy should be used
         * @default params => params.isBot && (/\.html$/.test(params.targetUrl) || !/\./.test(params.targetUrl))
         */
        shouldUse?: boolean | ((params: ProxyParams) => boolean);
        /**
         * Browser configuration used by Puppeteer
         * @default
         * 
         * {
         *     headless: true,
         *     args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
         * }
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
    };
    /**
     * HTTP Proxy configuration
     */
    httpProxy?: {
        /**
         * Indicates if the HTTP Proxy should be used
         * @default params => true
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
         * @default params => false
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
         * @default params => true
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
         * @default params => true
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
         * @default 50 * 1000 * 1000 // 50MB
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
             * @default params => true
             */
            shouldUse?: boolean | (() => boolean);
            /**
             * Defines the order which the proxy service will follow in case of errors, similar to 'config.proxyOrder'
             * @default [ProxyType.SsrProxy]
             */
            proxyOrder?: ProxyType[];
            /**
             * Delay before first refresh
             * @default 5 * 1000 // 5 seconds
             */
            initTimeoutMs?: number;
            /**
             * Interval between refreshes
             * @default 5 * 60 * 1000 // 5 minutes
             */
            intervalMs?: number;
            /**
             * Maximum number of parallel refreshes
             * @default 5 * 60 * 1000 // 5 minutes
             */
            parallelism?: number;
            /**
             * Whether to access routes as bot while auto refreshing
             * @default true
             */
            isBot?: boolean;
            /**
             * Routes to auto refresh
             * @default []
             */
            routes?: {
                /**
                 * Route HTTP Method
                 * @example 'GET'
                 */
                method: string;
                /**
                 * Route URL
                 * @example 'http://localhost:80/example/
                 */
                url: string;
                /**
                 * Route Headers
                 * @example { 'X-Example': 'Test' }
                 */
                headers?: any;
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