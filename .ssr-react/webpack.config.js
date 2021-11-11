const path = require('path');
const nodeExternals = require('webpack-node-externals');
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin');

module.exports = {
    entry: path.resolve(__dirname, 'index.tsx'),
    target: 'node',
    node: {
        __dirname: false, // fix bug where __dirname = '/'
        __filename: false
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'index.js'
    },
    resolve: {
        extensions: ['.ts', '.tsx', '.js'],
        plugins: [new TsconfigPathsPlugin()] // resolve path alias (e.g. @/example)
    },
    externals: [
        nodeExternals() // prevent bundling native Node.js features
    ],
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                loader: 'babel-loader',
                exclude: /(node_modules)/,
                options: {
                    plugins: [
                        ['@babel/plugin-transform-runtime', { 'regenerator': true }], // needed for Babel
                        ['@babel/plugin-proposal-decorators', { 'legacy': true }] // allows using decorators (e.g. @singleton)
                    ],
                    presets: [
                        '@babel/preset-env', // for general features (e.g. test?.prop)
                        '@babel/preset-typescript', // for typescript
                        '@babel/preset-react' // for react (jsx, tsx)
                    ]
                }
            }
        ]
    }
};