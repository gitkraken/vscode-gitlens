'use strict';
const webpack = require('webpack');
const path = require('path');
const nodeExternals = require('webpack-node-externals');
const UglifyJsPlugin = require('uglifyjs-webpack-plugin')

module.exports = function(env, argv) {
    if (env === undefined) {
        env = {};
    }

    const production = !!env.production;

    const minify = production;
    const sourceMaps = !production;

    const plugins = [
        new webpack.optimize.ModuleConcatenationPlugin(),
        new UglifyJsPlugin({
            parallel: true,
            sourceMap: sourceMaps,
            uglifyOptions: {
                ecma: 8,
                compress: minify ? {} : false,
                mangle: minify,
                output: {
                    beautify: !minify,
                    comments: false
                }
            }
        })
    ];

    return {
        entry: './src/extension.ts',
        mode: production ? 'production' : 'development',
        target: 'node',
        output: {
            libraryTarget: 'commonjs2',
            filename: 'extension.js',
            path: path.resolve(__dirname, 'out')
        },
        resolve: {
            extensions: ['.ts']
        },
        externals: [
            nodeExternals()
        ],
        devtool: sourceMaps ? 'inline-source-map' : false,
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: [{ loader: 'ts-loader' }],
                    exclude: /node_modules/
                }
            ]
        },
        plugins: plugins
    };
};
