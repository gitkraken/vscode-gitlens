'use strict';
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const webpack = require('webpack');
const CleanPlugin = require('clean-webpack-plugin');
const FileManagerPlugin = require('filemanager-webpack-plugin');
const HtmlInlineSourcePlugin = require('html-webpack-inline-source-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
// const SizePlugin = require('size-plugin');
// const WebpackDeepScopeAnalysisPlugin = require('webpack-deep-scope-plugin').default;

module.exports = function(env, argv) {
    env = env || {};
    env.production = Boolean(env.production);
    env.optimizeImages = env.production || Boolean(env.optimizeImages);
    env.copyClipboardyFallbacks = env.production || Boolean(env.copyClipboardyFallbacks);

    if (!env.optimizeImages && !fs.existsSync(path.resolve(__dirname, 'images/settings'))) {
        env.optimizeImages = true;
    }

    if (!env.copyClipboardyFallbacks && !fs.existsSync(path.resolve(__dirname, 'fallbacks'))) {
        env.copyClipboardyFallbacks = true;
    }

    return [getExtensionConfig(env), getUIConfig(env)];
};

function getExtensionConfig(env) {
    const clean = ['dist'];
    if (env.copyClipboardyFallbacks) {
        clean.push('fallbacks');
    }

    const plugins = [
        // https://github.com/GoogleChromeLabs/size-plugin/issues/12
        // new SizePlugin(),
        new CleanPlugin(clean, { verbose: false }),
        new webpack.IgnorePlugin(/^spawn-sync$/)
    ];

    if (env.copyClipboardyFallbacks) {
        plugins.push(
            // @ts-ignore
            new FileManagerPlugin({
                onEnd: [
                    {
                        copy: [
                            {
                                source: path.resolve(__dirname, 'node_modules/clipboardy/fallbacks'),
                                destination: 'fallbacks/'
                            }
                        ]
                    }
                ]
            })
        );
    }

    // if (env.production) {
    // plugins.push(new WebpackDeepScopeAnalysisPlugin());
    // }

    return {
        name: 'extension',
        entry: './src/extension.ts',
        mode: env.production ? 'production' : 'development',
        target: 'node',
        node: {
            __dirname: false
        },
        devtool: !env.production ? 'eval-source-map' : undefined,
        output: {
            libraryTarget: 'commonjs2',
            filename: 'extension.js',
            path: path.resolve(__dirname, 'dist'),
            devtoolModuleFilenameTemplate: 'file:///[absolute-resource-path]'
        },
        externals: {
            vscode: 'commonjs vscode'
        },
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
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx']
        },
        plugins: plugins,
        stats: {
            all: false,
            assets: true,
            builtAt: true,
            env: true,
            errors: true,
            timings: true,
            warnings: true
        }
    };
}

function getUIConfig(env) {
    const clean = ['settings.html', 'welcome.html'];
    if (env.optimizeImages) {
        console.log('Optimizing images (src/ui/images/settings/*.png)...');
        clean.push('images/settings');
    }

    const plugins = [
        // https://github.com/GoogleChromeLabs/size-plugin/issues/12
        // new SizePlugin(),
        new CleanPlugin(clean, { verbose: false }),
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
            cacheFolder: path.resolve(__dirname, '.cache-images'),
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

    // if (env.production) {
    // plugins.push(new WebpackDeepScopeAnalysisPlugin());
    // }

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
            path: path.resolve(__dirname, 'dist/ui'),
            publicPath: '{{root}}/dist/ui/'
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
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx'],
            modules: [path.resolve(__dirname, 'src/ui'), 'node_modules']
        },
        plugins: plugins,
        stats: {
            all: false,
            assets: true,
            builtAt: true,
            env: true,
            errors: true,
            timings: true,
            warnings: true
        }
    };
}
