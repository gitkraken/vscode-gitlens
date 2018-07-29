'use strict';
const webpack = require('webpack');
const glob = require('glob');
const path = require('path');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const HtmlWebpackInlineSourcePlugin = require('html-webpack-inline-source-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = function(env, argv) {
    env = env || {};
    const production = !!env.production;
    const optimizeImages = production || !!env.optimizeImages;

    const clean = ['out/ui'];
    if (optimizeImages) {
        console.log('Optimizing images (src/ui/images/settings/*.png)...');
        clean.push('images/settings');
    }

    const plugins = [
        new CleanWebpackPlugin(clean),
        new webpack.optimize.ModuleConcatenationPlugin(),
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
        new HtmlWebpackPlugin({
            excludeAssets: [/.*\.main\.js/],
            excludeChunks: ['welcome'],
            template: 'settings/index.html',
            filename: path.resolve(__dirname, 'settings.html'),
            inject: true,
            inlineSource: production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: production
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
            filename: path.resolve(__dirname, 'welcome.html'),
            inject: true,
            inlineSource: production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: production
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
        new ImageminPlugin({
            disable: !optimizeImages,
            externalImages: {
                context: path.resolve(__dirname, 'src/ui/images'),
                sources: glob.sync('src/ui/images/settings/*.png'),
                destination: path.resolve(__dirname, 'images')
            },
            gifsicle: null,
            jpegtran: null,
            optipng: null,
            pngquant: {
                quality: '85-100',
                speed: production ? 1 : 10
            },
            svgo: null
        })
    ];

    return {
        context: path.resolve(__dirname, 'src/ui'),
        // This is ugly having main.scss on both bundles, but if it is added separately it will generate a js bundle :(
        entry: {
            settings: ['./settings/index.ts', './scss/main.scss'],
            welcome: ['./welcome/index.ts', './scss/main.scss']
            // main: ['./scss/main.scss']
        },
        mode: production ? 'production' : 'development',
        devtool: !production ? 'eval-source-map' : undefined,
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'out/ui'),
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
            extensions: ['.tsx', '.ts', '.js'],
            modules: [path.resolve(__dirname, 'src/ui'), 'node_modules']
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'ui.tsconfig.json'
                        }
                    },
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
                                minimize: production,
                                sourceMap: !production,
                                url: false
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                sourceMap: !production
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
