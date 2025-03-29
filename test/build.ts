import * as os from 'os';
import * as path from 'path';
import { LogLevel, SsrBuild, SsrBuildConfig } from 'ssr-proxy-js-local'; // ssr-proxy-js or ssr-proxy-js-local

const config: SsrBuildConfig = {
    httpPort: 8080,
    hostname: 'localhost',
    src: 'public',
    dist: 'dist',
    // stopOnError: true,
    serverMiddleware: async (req, res, next) => {
        // res.sendFile(path.join(__dirname, 'public/index.html'));
        // res.sendFile(path.join(__dirname, 'public', req.path));
        next();
    },
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
        routes: [
            { method: 'GET', url: '/' },
            { method: 'GET', url: '/nested' },
            { method: 'GET', url: '/page.html' },
            { method: 'GET', url: '/iframe.html' },
            { method: 'GET', url: '/fail' }
        ],
    },
};

const ssrBuild = new SsrBuild(config);

ssrBuild.start();