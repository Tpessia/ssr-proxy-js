// https://medium.com/jspoint/a-beginners-guide-to-react-server-side-rendering-ssr-bf3853841d55
// https://developers.google.com/web/tools/puppeteer/articles/ssr
// https://www.digitalocean.com/community/tutorials/react-server-side-rendering

// npm install webpack-cli webpack-node-externals ts-loader@8.2.0 @types/express ignore-loader tsconfig-paths-webpack-plugin  @babel/plugin-proposal-decorators @babel/plugin-transform-runtime --save-dev
// Obs: fixed versions following front's package-lock.json
// Obs: ts-loader@8.2.0 to work with webpack 4

// "build:ssr": "rimraf dist && cross-env NODE_ENV=production webpack --config webpack.config.js --mode=production",
// "start:ssr": "node ./dist/index.js",

import 'reflect-metadata';

import express from 'express';
import * as fs from 'fs';
import * as path from 'path';
import ReactDOMServer from 'react-dom/server';
import App from '../src/App';

const reactPath = '../../front/build';

const app = express();

// serve static assets
app.get(/\.(js|css|map|ico)$/, express.static(path.resolve(__dirname, reactPath)));

// for any other requests, send `index.html` as a response
app.use('*', (req, res) => {
    // read `index.html` file
    let indexHTML = fs.readFileSync(path.resolve(__dirname, reactPath, 'index.html'), {
        encoding: 'utf8',
    });

    // get HTML string from the `App` component
    let appHTML = ReactDOMServer.renderToString(<App />);

    // populate `#app` element with `appHTML`
    indexHTML = indexHTML.replace('<div id="root"></div>', `<div id="root">${appHTML}</div>`);

    // set header and status
    res.contentType('text/html');
    res.status(200);

    return res.send(indexHTML);
});

const port = 8080;
app.listen(port, '0.0.0.0', () => {
    console.log(`SSR listening on port ${port}!`);
});