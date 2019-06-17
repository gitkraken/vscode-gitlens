'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlExcludeAssetsPlugin = require('html-webpack-exclude-assets-plugin');
const HtmlInlineSourcePlugin = require('html-webpack-inline-source-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = function(env, argv) {
    env = env || {};
    env.analyzeBundle = Boolean(env.analyzeBundle);
    env.analyzeDeps = Boolean(env.analyzeDeps);
    env.production = env.analyzeBundle || Boolean(env.production);
    env.optimizeImages = Boolean(env.optimizeImages) || (env.production && !env.analyzeBundle);

    if (!env.optimizeImages && !fs.existsSync(path.resolve(__dirname, 'images/settings'))) {
        env.optimizeImages = true;
    }

    return [getExtensionConfig(env), getWebviewsConfig(env)];
};

function getExtensionConfig(env) {
    /**
     * @type any[]
     */
    const plugins = [
        new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['**/*', '!**/webviews/**'] }),
        new ForkTsCheckerPlugin({
            async: false,
            useTypescriptIncrementalApi: true
        })
    ];

    if (env.analyzeDeps) {
        plugins.push(
            new CircularDependencyPlugin({
                cwd: __dirname,
                exclude: /node_modules/,
                failOnError: false,
                onDetected: function({ module: webpackModuleRecord, paths, compilation }) {
                    if (paths.some(p => /container\.ts/.test(p))) return;

                    compilation.warnings.push(new Error(paths.join(' -> ')));
                }
            })
        );
    }

    if (env.analyzeBundle) {
        plugins.push(new BundleAnalyzerPlugin());
    }

    return {
        name: 'extension',
        entry: './src/extension.ts',
        mode: env.production ? 'production' : 'development',
        target: 'node',
        node: {
            __dirname: false
        },
        devtool: 'source-map',
        output: {
            libraryTarget: 'commonjs2',
            filename: 'extension.js'
        },
        optimization: {
            minimizer: [
                new TerserPlugin({
                    cache: true,
                    parallel: true,
                    sourceMap: true,
                    terserOptions: {
                        ecma: 8,
                        // Keep the class names otherwise @log won't provide a useful name
                        // eslint-disable-next-line @typescript-eslint/camelcase
                        keep_classnames: true,
                        module: true
                    }
                })
            ]
        },
        externals: {
            vscode: 'commonjs vscode'
        },
        module: {
            rules: [
                {
                    enforce: 'pre',
                    exclude: /node_modules|\.d\.ts$/,
                    test: /\.tsx?$/,
                    use: {
                        loader: 'eslint-loader',
                        options: {
                            cache: true,
                            failOnError: true
                        }
                    }
                },
                {
                    exclude: /node_modules|\.d\.ts$/,
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            transpileOnly: true,
                            experimentalWatchApi: true
                        }
                    }
                }
            ]
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
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

function getWebviewsConfig(env) {
    const clean = ['**/*'];
    if (env.optimizeImages) {
        console.log('Optimizing images (src/webviews/apps/images/settings/*.png)...');
        clean.push(path.resolve(__dirname, 'images/settings/*'));
    }

    /**
     * @type any[]
     */
    const plugins = [
        new CleanPlugin({ cleanOnceBeforeBuildPatterns: clean }),
        new ForkTsCheckerPlugin({
            tsconfig: path.resolve(__dirname, 'webviews.tsconfig.json'),
            async: false,
            useTypescriptIncrementalApi: true
        }),
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
        new HtmlPlugin({
            excludeAssets: [/.+-styles\.js/],
            excludeChunks: ['welcome'],
            template: 'settings/index.html',
            filename: path.resolve(__dirname, 'dist/webviews/settings.html'),
            inject: true,
            // inlineSource: env.production ? '.(js|css)$' : undefined,
            minify: env.production
                ? {
                      removeComments: true,
                      collapseWhitespace: true,
                      removeRedundantAttributes: true,
                      useShortDoctype: true,
                      removeEmptyAttributes: true,
                      removeStyleLinkTypeAttributes: true,
                      keepClosingSlash: true,
                      minifyCSS: true
                  }
                : false
        }),
        new HtmlPlugin({
            excludeAssets: [/.+-styles\.js/],
            excludeChunks: ['settings'],
            template: 'welcome/index.html',
            filename: path.resolve(__dirname, 'dist/webviews/welcome.html'),
            inject: true,
            // inlineSource: env.production ? '.(js|css)$' : undefined,
            minify: env.production
                ? {
                      removeComments: true,
                      collapseWhitespace: true,
                      removeRedundantAttributes: true,
                      useShortDoctype: true,
                      removeEmptyAttributes: true,
                      removeStyleLinkTypeAttributes: true,
                      keepClosingSlash: true,
                      minifyCSS: true
                  }
                : false
        }),
        new HtmlExcludeAssetsPlugin(),
        new HtmlInlineSourcePlugin(),
        new ImageminPlugin({
            disable: !env.optimizeImages,
            externalImages: {
                context: path.resolve(__dirname, 'src/webviews/apps/images'),
                sources: glob.sync('src/webviews/apps/images/settings/*.png'),
                destination: path.resolve(__dirname, 'images')
            },
            cacheFolder: path.resolve(__dirname, 'node_modules', '.cache', 'imagemin-webpack-plugin'),
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
        name: 'webviews',
        context: path.resolve(__dirname, 'src/webviews/apps'),
        entry: {
            'main-styles': ['./scss/main.scss'],
            settings: ['./settings/index.ts'],
            welcome: ['./welcome/index.ts']
        },
        mode: env.production ? 'production' : 'development',
        devtool: env.production ? undefined : 'eval-source-map',
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'dist/webviews'),
            publicPath: '{{root}}/dist/webviews/'
        },
        module: {
            rules: [
                {
                    enforce: 'pre',
                    exclude: /node_modules|\.d\.ts$/,
                    test: /\.tsx?$/,
                    use: {
                        loader: 'eslint-loader',
                        options: {
                            cache: true,
                            failOnError: true
                        }
                    }
                },
                {
                    exclude: /node_modules|\.d\.ts$/,
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'webviews.tsconfig.json',
                            transpileOnly: true,
                            experimentalWatchApi: true
                        }
                    }
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
                                sourceMap: true,
                                url: false
                            }
                        },
                        {
                            loader: 'sass-loader',
                            options: {
                                sourceMap: true
                            }
                        }
                    ],
                    exclude: /node_modules/
                }
            ]
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
            modules: [path.resolve(__dirname, 'src/webviews/apps'), 'node_modules']
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
