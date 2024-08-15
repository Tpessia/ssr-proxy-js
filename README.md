[![NuGet Status](https://img.shields.io/npm/v/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)
[![NuGet Status](https://img.shields.io/npm/dt/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)

# SSRProxy.js

A Server-Side Rendering Proxy focused on customization and flexibility!

Server-Side Rendering, or SSR for short, is a technique used to serve Single-Page Applications (SPAs, e.g. React.js, Vue.js and Angular based websites) with Web Crawlers in mind, such as Googlebot. Crawlers are used everywhere in the internet to a variety of objectives, with the most known being for indexing the web for search engines, which is done by companies such as Google (Googlebot), Bing (Bingbot) and DuckDuckGo (DuckDuckBot).

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

The implemantation of this package is hugelly inspired by an article from Google, using Pupperteer as it's engine:
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
    httpPort: 8080,
    targetRoute: 'http://localhost:3000'
});

ssrProxy.start();
```

## npx Example

**Commands**
```bash
npx ssr-proxy-js
npx ssr-proxy-js -c ./ssr-proxy-js.config.json
npx ssr-proxy-js --httpPort=8080 --targetRoute=http://localhost:3000 --static.dirPath=./public --proxyOrder=SsrProxy --proxyOrder=StaticProxy
```

**Config**
```javascript
// ./ssr-proxy-js.config.json

{
    "httpPort": 8080,
    "targetRoute": "http://localhost:3000"
}
```

## Full Example

```javascript
const os = require('os');
const path = require('path');
const { SsrProxy } = require('ssr-proxy-js-local');

const BASE_PROXY_PORT = '8080';
const BASE_PROXY_ROUTE = `http://localhost:${BASE_PROXY_PORT}`;
const STATIC_FILES_PATH = path.join(process.cwd(), 'public');
const LOGGING_PATH = path.join(os.tmpdir(), 'ssr-proxy/logs');

console.log(`\nLogging at: ${LOGGING_PATH}`);

const ssrProxy = new SsrProxy({
    httpPort: 8081,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    proxyOrder: ['SsrProxy', 'HttpProxy', 'StaticProxy'],
    isBot: (method, url, headers) => true,
    failStatus: params => 404,
    customError: err => err.toString(),
    ssr: {
        shouldUse: params => params.isBot && (/\.html$/.test(params.targetUrl.pathname) || !/\./.test(params.targetUrl.pathname)),
        browserConfig: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'], timeout: 60000 },
        queryParams: [{ key: 'headless', value: 'true' }],
        allowedResources: ['document', 'script', 'xhr', 'fetch'],
        waitUntil: 'networkidle0',
        timeout: 60000,
    },
    httpProxy: {
        shouldUse: params => true,
        timeout: 60000,
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
        shouldUse: params => params.proxyType === 'SsrProxy',
        maxEntries: 50,
        maxByteSize: 50 * 1024 * 1024, // 50MB
        expirationMs: 25 * 60 * 60 * 1000, // 25h
        autoRefresh: {
            enabled: true,
            shouldUse: () => true,
            proxyOrder: ['SsrProxy', 'HttpProxy'],
            initTimeoutMs: 5 * 1000, // 5s
            intervalCron: '0 0 3 * * *', // every day at 3am
            intervalTz: 'Etc/UTC',
            retries: 3,
            parallelism: 5,
            closeBrowser: true,
            isBot: true,
            routes: [
                { method: 'GET', url: '/' },
                { method: 'GET', url: '/login' },
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
```

## Release

1. Commit new code
2. npm run publish:np

<!-- Node.js modules
https://zellwk.com/blog/publish-to-npm/
https://www.sensedeep.com/blog/posts/2021/how-to-create-single-source-npm-module.html
https://electerious.medium.com/from-commonjs-to-es-modules-how-to-modernize-your-node-js-app-ad8cdd4fb662

Puppeteer SSR
https://developers.google.com/web/tools/puppeteer/articles/ssr

Bot User Agent
https://www.keycdn.com/blog/web-crawlers
https://github.com/omrilotan/isbot/blob/main/src/list.json
https://github.com/monperrus/crawler-user-agents/blob/master/crawler-user-agents.json

Nginx Redirect by User Agent
https://serverfault.com/questions/775463/nginx-redirect-based-on-user-agent
https://serverfault.com/questions/865055/nginx-redirect-if-user-agent-contains-xyz

Other Proxies
https://github.com/xiamx/ssr-proxy / https://www.npmjs.com/package/ssr-proxy
https://cnpmjs.org/package/spa-ssr-proxy / https://www.npmjs.com/package/spa-ssr-proxy
https://github.com/jamiekyle-eb/ssr-proxy
https://github.com/postor/ssr-proxy-puppeteer / https://www.npmjs.com/package/ssr-proxy-puppeteer -->