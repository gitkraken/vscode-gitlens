'use strict';
const path = require('path');
const nodeExternals = require('webpack-node-externals');

module.exports = function(env, argv) {
    if (env === undefined) {
        env = {};
    }

    const production = !!env.production;

    return {
        entry: './src/extension.ts',
        mode: production ? 'production' : 'development',
        target: 'node',
        devtool: !production ? 'eval-source-map' : undefined,
        output: {
            libraryTarget: 'commonjs2',
            filename: 'extension.js',
            path: path.resolve(__dirname, 'out')
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js']
        },
        externals: [nodeExternals()],
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/
                }
            ]
        }
    };
};
