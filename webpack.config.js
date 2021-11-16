const path = require('path');
const pkg = require('./package.json');
const nodeExternals = require('webpack-node-externals');

module.exports = {
    // mode: 'production',
    target: 'node', // in order to ignore built-in modules like path, fs, etc.
    entry: path.resolve(__dirname, 'src/ssr-proxy.ts'),
    module: {
        rules: [{
            test: /\.ts$/,
            include: /src/,
            use: [{
                loader: 'ts-loader' ,
                options: { configFile: 'tsconfig.json' }
            }]
        }],
    },
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        filename: 'ssr-proxy.js',
        path: path.resolve(__dirname, 'dist'),
        libraryTarget: 'umd',
        library: pkg.name
    },
    externals: [
        nodeExternals() // in order to ignore all modules in node_modules folder
    ]
};