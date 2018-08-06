'use strict';
const glob = require('glob');
const nodeExternals = require('webpack-node-externals');
const path = require('path');
const CleanPlugin = require('clean-webpack-plugin');
const HtmlInlineSourcePlugin = require('html-webpack-inline-source-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

module.exports = function(env, argv) {
    env = env || {};
    env.production = !!env.production;
    env.optimizeImages = env.production || !!env.optimizeImages;

    return [getExtensionConfig(env), getUIConfig(env)];
};

function getExtensionConfig(env) {
    const plugins = [new CleanPlugin(['out'])];

    return {
        name: 'extension',
        entry: './src/extension.ts',
        mode: env.production ? 'production' : 'development',
        target: 'node',
        devtool: !env.production ? 'eval-source-map' : undefined,
        output: {
            libraryTarget: 'commonjs2',
            filename: 'extension.js',
            path: path.resolve(__dirname, 'out'),
            devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]'
        },
        resolve: {
            extensions: ['.tsx', '.ts', '.js']
        },
        externals: [nodeExternals()],
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    enforce: 'pre',
                    use: 'tslint-loader'
                },
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules/
                }
            ]
        },
        plugins: plugins,
        stats: { all: false, assets: true, builtAt: true, errors: true, timings: true, warnings: true }
    };
}

function getUIConfig(env) {
    const clean = ['settings.html', 'welcome.html'];
    if (env.optimizeImages) {
        console.log('Optimizing images (src/ui/images/settings/*.png)...');
        clean.push('images/settings');
    }

    const plugins = [
        new CleanPlugin(clean),
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
        new HtmlPlugin({
            excludeAssets: [/.*\.main\.js/],
            excludeChunks: ['welcome'],
            template: 'settings/index.html',
            filename: path.resolve(__dirname, 'settings.html'),
            inject: true,
            inlineSource: env.production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: env.production
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
        new HtmlPlugin({
            excludeAssets: [/.*\.main\.js/],
            excludeChunks: ['settings'],
            template: 'welcome/index.html',
            filename: path.resolve(__dirname, 'welcome.html'),
            inject: true,
            inlineSource: env.production ? '.(js|css)$' : undefined,
            // inlineSource: '.(js|css)$',
            minify: env.production
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
        new HtmlInlineSourcePlugin(),
        new ImageminPlugin({
            disable: !env.optimizeImages,
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
                speed: env.production ? 1 : 10
            },
            svgo: null
        })
    ];

    return {
        name: 'ui',
        context: path.resolve(__dirname, 'src/ui'),
        // This is ugly having main.scss on both bundles, but if it is added separately it will generate a js bundle :(
        entry: {
            settings: ['./settings/index.ts', './scss/main.scss'],
            welcome: ['./welcome/index.ts', './scss/main.scss']
            // main: ['./scss/main.scss']
        },
        mode: env.production ? 'production' : 'development',
        devtool: !env.production ? 'eval-source-map' : undefined,
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
                    test: /\.ts$/,
                    enforce: 'pre',
                    use: [
                        {
                            loader: 'tslint-loader',
                            options: {
                                tsConfigFile: 'ui.tsconfig.json'
                            }
                        }
                    ]
                },
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
                                minimize: env.production,
                                sourceMap: !env.production,
                                url: false
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                sourceMap: !env.production
                            }
                        }
                    ],
                    exclude: /node_modules/
                }
            ]
        },
        plugins: plugins,
        stats: { all: false, assets: true, builtAt: true, errors: true, timings: true, warnings: true }
    };
}
