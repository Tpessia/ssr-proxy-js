// Run "npm run serve" in parallel

import { LogLevel, SsrProxy, SsrProxyConfig } from 'ssr-proxy-js-local'; // ssr-proxy-js or ssr-proxy-js-local

const BASE_PROXY_PORT = '8080';
const BASE_PROXY_ROUTE = `http://localhost:${BASE_PROXY_PORT}`;

// Proxy

const config: SsrProxyConfig = {
    httpPort: 8081,
    hostname: '0.0.0.0',
    targetRoute: BASE_PROXY_ROUTE,
    isBot: true,
    reqMiddleware: async (params) => {
		params.targetUrl.search = '';
		params.targetUrl.pathname = params.targetUrl.pathname.replace(/\/+$/, '') || '/';
        return params;
    },
    resMiddleware: async (params, result) => {
        if (result.text == null) return result;
        result.text = result.text.replace('</html>', '\n\t<div>MIDDLEWARE</div>\n</html>');
        result.text = result.text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        return result;
    },
    log: { level: LogLevel.Debug },
};

const ssrProxy = new SsrProxy(config);

ssrProxy.start();

// Server

import * as express from 'express';
const app = express();

// Serve Static Files
app.use(express.static('public'));

app.listen(BASE_PROXY_PORT, () => {
    console.log(`Express listening at ${BASE_PROXY_ROUTE}`);
});