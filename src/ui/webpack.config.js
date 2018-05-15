'use strict';
const webpack = require('webpack');
const glob = require('glob');
const path = require('path');
const HtmlWebpackInlineSourcePlugin = require('html-webpack-inline-source-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

module.exports = function(env, argv) {
    if (env === undefined) {
        env = {};
    }

    const production = !!env.production;

    const quick = !production && !!env.quick;
    const minify = production;
    const sourceMaps = !production;

    const plugins = [
        new webpack.optimize.ModuleConcatenationPlugin(),
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
        new HtmlWebpackPlugin({
            excludeAssets: [/.*\.main\.js/],
            excludeChunks: ['welcome'],
            template: 'settings/index.html',
            filename: path.resolve(__dirname, '../..', 'settings.html'),
            inject: true,
            inlineSource: production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: minify
                ? {
                    removeComments: true,
                    collapseWhitespace: true,
                    removeRedundantAttributes: true,
                    useShortDoctype: true,
                    removeEmptyAttributes: true,
                    removeStyleLinkTypeAttributes: true,
                    keepClosingSlash: true
                }
                : false
        }),
        new HtmlWebpackPlugin({
            excludeAssets: [/.*\.main\.js/],
            excludeChunks: ['settings'],
            template: 'welcome/index.html',
            filename: path.resolve(__dirname, '../..', 'welcome.html'),
            inject: true,
            inlineSource: production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: minify
                ? {
                    removeComments: true,
                    collapseWhitespace: true,
                    removeRedundantAttributes: true,
                    useShortDoctype: true,
                    removeEmptyAttributes: true,
                    removeStyleLinkTypeAttributes: true,
                    keepClosingSlash: true
                }
                : false
        }),
        new HtmlWebpackInlineSourcePlugin(),
        new UglifyJsPlugin({
            parallel: true,
            sourceMap: sourceMaps,
            uglifyOptions: {
                ecma: 5,
                compress: minify,
                mangle: minify,
                output: {
                    beautify: !minify,
                    comments: false,
                    ecma: 5
                }
            }
        })
    ];

    if (!quick) {
        plugins.push(
            new ImageminPlugin({
                disable: false,
                externalImages: {
                    sources: glob.sync(path.resolve(__dirname, 'images/settings/*.png')),
                    destination: path.resolve(__dirname, '../..')
                },
                gifsicle: null,
                jpegtran: null,
                optipng: null,
                pngquant: {
                    quality: '85-100',
                    speed: minify ? 1 : 10
                },
                svgo: null
            })
        );
    }

    return {
        // This is ugly having main.scss on both bundles, but if it is added separately it will generate a js bundle :(
        entry: {
            settings: ['./settings/index.ts', './scss/main.scss'],
            welcome: ['./welcome/index.ts', './scss/main.scss']
            // main: ['./scss/main.scss']
        },
        mode: production ? 'production' : 'development',
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, '../../', 'out/ui'),
            publicPath: '{{root}}/out/ui/'
        },
        optimization: {
            splitChunks: {
              cacheGroups: {
                styles: {
                  name: 'styles',
                  test: /\.css$/,
                  chunks: 'all',
                  enforce: true
                }
              }
            }
        },
        resolve: {
            extensions: ['.ts', '.js'],
            modules: [path.resolve(__dirname), 'node_modules']
        },
        devtool: sourceMaps ? 'eval-source-map' : undefined,
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: [{ loader: 'ts-loader' }],
                    exclude: /node_modules/
                },
                {
                    test: /\.scss$/,
                    use: [
                        {
                            loader: MiniCssExtractPlugin.loader
                        },
                        {
                            loader: 'css-loader',
                            options: {
                                minimize: minify,
                                sourceMap: sourceMaps,
                                url: false
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                sourceMap: sourceMaps
                            }
                        }
                    ],
                    exclude: /node_modules/
                }
            ]
        },
        plugins: plugins
    };
};
