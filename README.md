[![NuGet Status](https://img.shields.io/npm/v/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)
[![NuGet Status](https://img.shields.io/npm/dt/ssr-proxy-js)](https://www.npmjs.com/package/ssr-proxy-js)

# SSRProxy.js

A Server-Side Rendering Proxy and Builder focused on customization and flexibility!

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

The main problem regarding the workflow described above is that the process of rendering the web page through a browser takes some time, so if done incorrectly, it might have a big impact on the users experience. That's why this package also comes with two essencial feature: **Caching**, **Fallbacks** and **Pre-Build**.

### Caching

Caching allows us to increase the performance of the web serving by preventing excessive new renders for web pages that have been accessed recently. Caching is highly configurable to allow total control of the workflow, for example, it's possible to decide if cache should or shouldn't be used each time the website is accessed, with the "shouldUse" option. Also, it's possible to configure a automatic cache refresh, using the "cache.autoRefresh" configuration.

### Fallbacks

In case of a human user access, we can serve the web site the "normal" way, without asking the SSR to pre-render the page. For that it's possible to use 3 types of proxies: SSR Proxy, HTTP Proxy or Static File Serving, in any order that you see fit. Firstly, the order of priority should be configured with the "proxyOrder" option, so for example, if configured as ['SsrProxy', 'HttpProxy', 'StaticProxy'], "ssr.shouldUse" will ask if SSR should be used, if it returns false, then "httpProxy.shouldUse" will ask if HTTP Proxy should be used, and finally, "static.shouldUse" will ask if Static File Serving should be used. If the return of all proxy options is false, or if one of then returns a exception (e.g. page not found), the web server will return a empty HTTP response with status equals to the return of the "failStatus" callback.

### Pre-Build

If all your content is static, meaning it won't change dependending on who or how your pages are accessed, you can pre-build all your routes using the `--mode=build` option, which will access all your pre-defined routes in build time, render the HTML, and save the resulting content back to a dist folder. You can then serve your dist folder instead of serving your original non pre-rendered bundle.

## SSR Proxy

Proxy your requests via the SSR server to serve pre-rendered pages to your users.

> Note: to ensure the best security and performance, it's adivisable to use this proxy behind a reverse proxy, such as [Nginx](https://www.nginx.com/).

### npx Example

**Commands**
```bash
# With Args
npx ssr-proxy-js --httpPort=8080 --targetRoute=http://localhost:3000 --static.dirPath=./public --proxyOrder=SsrProxy --proxyOrder=StaticProxy

# With Config File
npx ssr-proxy-js -c ./ssr-proxy-js.config.json
```

**Config File**
```javascript
// ./ssr-proxy-js.config.json
{
    "httpPort": 8080,
    "targetRoute": "http://localhost:3000"
}
```

### Simple Example

```javascript
const { SsrProxy } = require('ssr-proxy-js');

const ssrProxy = new SsrProxy({
    httpPort: 8080,
    targetRoute: 'http://localhost:3000'
});

ssrProxy.start();
```

### Full Example

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

## SSR Build

Build pre-rendered pages to serve to your users, without any added server complexity or extra response delay.

### npx Example

**Commands**
```bash
# With Args
npx ssr-proxy-js --mode=build --src=./public --dist=./dist --job.routes='[{"url":"/"},{"url":"/nested"}]'

# With Config File
npx ssr-proxy-js --mode=build -c ./ssr-build-js.config.json
```

**Config File**
```javascript
// ./ssr-build-js.config.json
{
    "src": "./public",
    "dist": "./src",
    "job": {
        "routes": [
            { "method": "GET", "url": "/" },
            { "method": "GET", "url": "/nested" }
        ]
    }
}
```

### Simple Example

```javascript
const { SsrBuild } = require('ssr-proxy-js');

const ssrBuild = new SsrBuild({
    "src": "./public",
    "dist": "./src",
    "job": {
        "routes": [
            { "method": "GET", "url": "/" },
            { "method": "GET", "url": "/nested" }
        ]
    }
});

ssrBuild.start();
```

### Full Example

```typescript
import * as os from 'os';
import * as path from 'path';
import { LogLevel, SsrBuild, SsrBuildConfig } from 'ssr-proxy-js';

const config: SsrBuildConfig = {
    httpPort: 8080,
    hostname: 'localhost',
    src: 'public',
    dist: 'dist',
    stopOnError: false,
    reqMiddleware: async (params) => {
        params.headers['Referer'] = 'http://google.com';
        return params;
    },
    resMiddleware: async (params, result) => {
        if (result.text == null) return result;
        result.text = result.text.replace('</html>', '\n\t<div>MIDDLEWARE</div>\n</html>');
        result.text = result.text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        return result;
    },
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
        routes: [{ method: 'GET', url: '/' },{ method: 'GET', url: '/nested' },{ method: 'GET', url: '/page.html' },{ method: 'GET', url: '/iframe.html' }],
    },
};

const ssrBuild = new SsrBuild(config);

ssrBuild.start();
```

## More options

For further options, check:

Example: https://github.com/Tpessia/ssr-proxy-js/tree/main/test

Types: https://github.com/Tpessia/ssr-proxy-js/blob/main/src/types.ts

<!-- ## Release

1. Commit new code
2. npm run publish:np -->

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