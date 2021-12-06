[![NuGet Status](https://img.shields.io/npm/v/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)
[![NuGet Status](https://img.shields.io/npm/dm/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)

# SSRProxy.js

A Server-Side Rendering Proxy focused on customization and flexibility!

Server-Side Rendering, or SSR for short, is a technique used to serve Single-Page Applications (SPAs, e.g. React.js, Vue.js and Angular based websites) with Web Crawlers in mind, such as Googlebot. Crawlers are used everywhere in the internet to a variety of objectives, with the most known being for indexing the web for search engines, which is done by companies such as Google (Googlebot), Bing (Msnbot) and DuckDuckGo (DuckDuckBot).

The main problem of serving SPAs "normally" (i.e. Client-Side Rendering) is that when your website is accessed by a Web Crawler, it's usually only able to read the source HTML code, which most probably does not represent your actual website. In case of a React App, for example, a Crawler might be only able to interpret your website like so:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/app.js"></script>
  </body>
</html>
```

For the contents of a SPA to be correct, the JavaScript files should be loaded and executed by the browser, and that's where Server-Side Rendering plays a big role. SSR will receive the HTTP request from the client, create a browser instance, load the page just like we do while surfing the web, and just then return the actual rendered HTML to the request, after the SPA is fully loaded.

The implemantation of this package is hugelly inspired by a article from Google, using Pupperteer as it's engine:
https://developers.google.com/web/tools/puppeteer/articles/ssr

The main problem regarding the workflow described above is that the process of rendering the web page through a browser takes some time, so if done incorrectly, it might have a big impact on the users experience. That's why this package also comes with two essencial feature: **Caching** and **Fallbacks**.

### Caching

Caching allows us to increase the performance of the web serving by preventing excessive new renders for web pages that have been accessed recently. Caching is highly configurable to allow total control of the workflow, for example, it's possible to decide if cache should or shouldn't be used each time the website is accessed, with the "shouldUse" option. Also, it's possible to configure a automatic cache refresh, using the "cache.autoRefresh" configuration.

### Fallbacks

In case of a human user access, we can serve the web site the "normal" way, without asking the SSR to pre-render the page. For that it's possible to use 3 types of proxies: SSR Proxy, HTTP Proxy or Static File Serving, in any order that you see fit. Firstly, the order of priority should be configured with the "proxyOrder" option, so for example, if configured as ['SsrProxy', 'HttpProxy', 'StaticProxy'], "ssr.shouldUse" will ask if SSR should be used, if it returns false, then "httpProxy.shouldUse" will ask if HTTP Proxy should be used, and finally, "static.shouldUse" will ask if Static File Serving should be used. If the return of all proxy options is false, or if one of then returns a exception (e.g. page not found), the web server will return a empty HTTP response with status equals to the return of the "failStatus" callback.

> Note: to ensure the best security and performance, it's adivisable to use this proxy behind a reverse proxy, such as [Nginx](https://www.nginx.com/).

## Simple Example

```javascript
const { SsrProxy } = require('ssr-proxy-js');

const ssrProxy = new SsrProxy({
    port: 8080,
    targetRoute: 'localhost:3000'
});

ssrProxy.start();
```

## npx Example

**Commands**
```bash
npx ssr-proxy-js
npx ssr-proxy-js -c ./ssr-proxy-js.config.json
npx ssr-proxy-js --port=8080 --targetRoute=localhost:3000
```

**Config**
```javascript
// ./ssr-proxy-js.config.json

{
    "port": 8080,
    "targetRoute": "localhost:3000"
}
```

## Full Example

```javascript
const os = require('os');
const path = require('path');
const { SsrProxy } = require('ssr-proxy-js');

const BASE_PROXY_ROUTE = 'localhost:3000';
const STATIC_FILES_PATH = path.join(process.cwd(), 'public');
const LOGGING_PATH = path.join(os.tmpdir(), 'ssr-proxy/logs');

console.log(`\nLogging at: ${LOGGING_PATH}`);

const ssrProxy = new SsrProxy({
    port: 8080,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    proxyOrder: ['SsrProxy', 'StaticProxy', 'HttpProxy'],
    failStatus: params => 404,
    // isBot: (method, url, headers) => true,
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
        dirPath: STATIC_FILES_PATH,
        useIndexFile: path => path.endsWith('/'),
        indexFile: 'index.html',
    },
    log: {
        level: 3,
        console: {
            enabled: true,
        },
        file: {
            enabled: true,
            dirPath: LOGGING_PATH,
        },
    },
    cache: {
        enabled: true,
        shouldUse: params => params.proxyType === 'SsrProxy',
        maxEntries: 50,
        maxByteSize: 50 * 1024 * 1024, // 50MB
        expirationMs: 10 * 60 * 1000, // 10 minutes
        autoRefresh: {
            enabled: true,
            shouldUse: () => true,
            proxyOrder: ['SsrProxy'],
            initTimeoutMs: 5 * 1000, // 5 seconds
            intervalMs: 5 * 60 * 1000, // 5 minutes
            parallelism: 5,
            isBot: true,
            routes: [
                { method: 'GET', url: `http://${BASE_PROXY_ROUTE}/` },
                { method: 'GET', url: `http://${BASE_PROXY_ROUTE}/login` },
            ],
        },
    },
});

ssrProxy.start();
```

## Config

```typescript
interface SsrProxyConfig {
    /**
     * Proxy server port
     * @default 8080
     */
    port?: number;
    /**
     * Proxy server hostname
     * @default '0.0.0.0'
     */
    hostname?: string;
    /**
     * Target route for SSR and HTTP proxy
     * 
     * With the default configuration, http://0.0.0.0:8080 will proxy to http://localhost:80
     * @default 'localhost:80'
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
    failStatus?: (params: ProxyTypeParams) => number;
    /**
     * Custom implementation to define whether the client is a bot (e.g. Googlebot)
     * 
     * Defaults to https://www.npmjs.com/package/isbot
     */
    isBot?: (method: string, url: string, headers: any) => boolean;
    /**
     * Server-Side Rendering configuration
     */
    ssr?: {
        /**
         * Indicates if the SSR Proxy should be used
         * @default params => params.isBot && (/\.html$/.test(params.targetUrl) || !/\./.test(params.targetUrl))
         */
        shouldUse?: (params: ProxyParams) => boolean;
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
    };
    /**
     * HTTP Proxy configuration
     */
    httpProxy?: {
        /**
         * Indicates if the HTTP Proxy should be used
         * @default params => true
         */
        shouldUse?: (params: ProxyParams) => boolean;
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
    };
    /**
     * Static File Serving configuration
     */
    static?: {
        /**
         * Indicates if the Static File Serving should be used
         * @default params => true
         */
        shouldUse?: (params: ProxyParams) => boolean;
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
        shouldUse?: (params: ProxyTypeParams) => boolean;
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
            shouldUse?: () => boolean;
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
```
