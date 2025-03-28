#!/usr/bin/env node

// cd test && npx ssr-proxy-js-local

// npx ssr-proxy-js
// npx ssr-proxy-js -c ./ssr-proxy-js.config.json
// npx ssr-proxy-js --httpPort=8080 --targetRoute=http://localhost:3000 --static.dirPath=./public --proxyOrder=SsrProxy --proxyOrder=StaticProxy --log.level=3

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');
const deepmerge = require('deepmerge');
const { SsrProxy, SsrBuild } = require('../dist/index');

const argv = minimist(process.argv.slice(2));

const { _: argv_, mode: argv_mode, c: argv_c, config: argv_config, ...argv_rest } = argv;
const explicitConfig = !!(argv_c || argv_config);

if (!!argv_mode && argv_mode !== 'proxy' && argv_mode !== 'build') {
    logWarn('Invalid mode, must be either "proxy" or "build"');
    process.exit(1);
}

const mode = argv_mode || 'proxy';

const options = { };
options.configPath = argv_c || argv_config || (mode === 'proxy' ? './ssr-proxy-js.config.json' : './ssr-build-js.config.json');
options.configPath = path.resolve(process.cwd(), options.configPath);

try {
    if (options.configPath)
        options.configJson = fs.readFileSync(options.configPath, { encoding: 'utf8' });
} catch (err) {
    if (explicitConfig)
        logWarn(`Unable to find the config, looking for: ${options.configPath}`, err);
}

try {
    if (options.configJson) options.config = JSON.parse(options.configJson);
    else options.config = {};
} catch (err) {
    logWarn('Unable to parse the config', err);
}

if (typeof argv_rest?.cache?.autoRefresh?.routes === 'string') argv_rest.cache.autoRefresh.routes = JSON.parse(argv_rest.cache.autoRefresh.routes);
if (typeof argv_rest?.job?.routes === 'string') argv_rest.job.routes = JSON.parse(argv_rest.job.routes);

options.config = deepmerge(options.config, argv_rest, {
    arrayMerge: (destArray, srcArray, opts) => srcArray,
});

if (isEmpty(options.config)) {
    logWarn('No config file or cli arguments found!');
}

if (mode === 'proxy') {
    const ssrProxy = new SsrProxy(options.config);
    ssrProxy.start();
} else if (mode === 'build') {
    const ssrBuild = new SsrBuild(options.config);
    ssrBuild.start();
}

// Utils

function logWarn(...msg) {
    if (!msg || !msg.length) return;
    msg[0] = '\x1b[33m' + msg[0];
    msg[msg.length - 1] += '\x1b[0m';
    console.log(...msg);
}

function isEmpty(obj) {
    return obj && Object.keys(obj).length === 0 && Object.getPrototypeOf(obj) === Object.prototype;
}