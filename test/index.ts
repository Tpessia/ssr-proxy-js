// Run "npm run serve" in parallel

import { LogLevel, SsrProxy, SsrProxyConfig } from 'ssr-proxy-js-local'; // ssr-proxy-js or ssr-proxy-js-local

const config: SsrProxyConfig = {
    httpPort: 8081,
    hostname: '0.0.0.0',
    targetRoute: 'http://localhost:8080',
    isBot: true,
    reqMiddleware: async (params) => {
        params.targetUrl.search = '';
        return params;
    },
    resMiddleware: async (params, result) => {
        if (result.text == null) return result;
        result.text = result.text.replace('</html>', '<div>MIDDLEWARE</div></html>');
        result.text = result.text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        return result;
    },
    log: { level: LogLevel.Info },
};

const ssrProxy = new SsrProxy(config);

ssrProxy.start();