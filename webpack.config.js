'use strict';
const fs = require('fs');
const glob = require('glob');
const path = require('path');
const webpack = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const CleanPlugin = require('clean-webpack-plugin');
const CircularDependencyPlugin = require('circular-dependency-plugin');
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
    env.optimizeImages = env.production || Boolean(env.optimizeImages);

    if (!env.optimizeImages && !fs.existsSync(path.resolve(__dirname, 'images/settings'))) {
        env.optimizeImages = true;
    }

    // TODO: Total and complete HACK until the following vsls issues are resolved
    // https://github.com/MicrosoftDocs/live-share/issues/1334 & https://github.com/MicrosoftDocs/live-share/issues/1335

    const vslsPatchRegex = /const liveShareApiVersion = require\(path\.join\(__dirname, 'package\.json'\)\)\.version;/;

    let vslsPath = path.resolve(__dirname, 'node_modules/vsls/package.json');
    if (fs.existsSync(vslsPath)) {
        const vsls = require(vslsPath);
        if (vsls.main === undefined) {
            console.log('Fixing vsls package; Adding missing main to package.json...');

            vsls.main = 'vscode.js';
            fs.writeFileSync(vslsPath, `${JSON.stringify(vsls, undefined, 4)}\n`, 'utf8');
        }

        vslsPath = path.resolve(__dirname, 'node_modules/vsls/vscode.js');
        if (fs.existsSync(vslsPath)) {
            let code = fs.readFileSync(vslsPath, 'utf8');
            if (vslsPatchRegex.test(code)) {
                console.log('Fixing vsls package; Removing version lookup...');

                code = code.replace(
                    vslsPatchRegex,
                    `const liveShareApiVersion = '${
                        vsls.version
                    }'; // require(path.join(__dirname, 'package.json')).version;`
                );
                fs.writeFileSync(vslsPath, code, 'utf8');
            }
        }
    }

    return [getExtensionConfig(env), getUIConfig(env)];
};

function getExtensionConfig(env) {
    const plugins = [new CleanPlugin(['dist'], { verbose: false }), new webpack.IgnorePlugin(/^spawn-sync$/)];

    if (env.analyzeDeps) {
        plugins.push(
            new CircularDependencyPlugin({
                cwd: __dirname,
                exclude: /node_modules/,
                failOnError: false,
                onDetected({ module: webpackModuleRecord, paths, compilation }) {
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
                    test: /\.ts$/,
                    enforce: 'pre',
                    use: 'tslint-loader',
                    exclude: /node_modules/
                },
                {
                    test: /\.tsx?$/,
                    use: 'ts-loader',
                    exclude: /node_modules|\.d\.ts$/
                }
            ],
            // Removes `Critical dependency: the request of a dependency is an expression` from `./node_modules/vsls/vscode.js`
            exprContextRegExp: /^$/,
            exprContextCritical: false
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

function getUIConfig(env) {
    const clean = ['settings.html', 'welcome.html'];
    if (env.optimizeImages) {
        console.log('Optimizing images (src/ui/images/settings/*.png)...');
        clean.push('images/settings');
    }

    const plugins = [
        new CleanPlugin(clean, { verbose: false }),
        new MiniCssExtractPlugin({
            filename: '[name].css'
        }),
        new HtmlPlugin({
            excludeChunks: ['welcome'],
            template: 'settings/index.html',
            filename: path.resolve(__dirname, 'settings.html'),
            inject: true,
            inlineSource: env.production ? '.(js|css)$' : undefined,
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
            excludeChunks: ['settings'],
            template: 'welcome/index.html',
            filename: path.resolve(__dirname, 'welcome.html'),
            inject: true,
            inlineSource: env.production ? '.(js|css)$' : undefined,
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
        devtool: env.production ? undefined : 'eval-source-map',
        output: {
            filename: '[name].js',
            path: path.resolve(__dirname, 'dist/ui'),
            publicPath: '{{root}}/dist/ui/'
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
                    ],
                    exclude: /node_modules/
                },
                {
                    test: /\.tsx?$/,
                    use: {
                        loader: 'ts-loader',
                        options: {
                            configFile: 'ui.tsconfig.json'
                        }
                    },
                    exclude: /node_modules|\.d\.ts$/
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
