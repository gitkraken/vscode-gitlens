//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/prefer-optional-chain */
'use strict';
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const CspHtmlPlugin = require('csp-html-webpack-plugin');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const HtmlSkipAssetsPlugin = require('html-webpack-skip-assets-plugin').HtmlWebpackSkipAssetsPlugin;
const ImageminPlugin = require('imagemin-webpack-plugin').default;
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');

class InlineChunkHtmlPlugin {
	constructor(htmlPlugin, patterns) {
		this.htmlPlugin = htmlPlugin;
		this.patterns = patterns;
	}

	getInlinedTag(publicPath, assets, tag) {
		if (
			(tag.tagName !== 'script' || !(tag.attributes && tag.attributes.src)) &&
			(tag.tagName !== 'link' || !(tag.attributes && tag.attributes.href))
		) {
			return tag;
		}

		let chunkName = tag.tagName === 'link' ? tag.attributes.href : tag.attributes.src;
		if (publicPath) {
			chunkName = chunkName.replace(publicPath, '');
		}
		if (!this.patterns.some(pattern => chunkName.match(pattern))) {
			return tag;
		}

		const asset = assets[chunkName];
		if (asset == null) {
			return tag;
		}

		return { tagName: tag.tagName === 'link' ? 'style' : tag.tagName, innerHTML: asset.source(), closeTag: true };
	}

	apply(compiler) {
		let publicPath = compiler.options.output.publicPath || '';
		if (publicPath && !publicPath.endsWith('/')) {
			publicPath += '/';
		}

		compiler.hooks.compilation.tap('InlineChunkHtmlPlugin', compilation => {
			const getInlinedTagFn = tag => this.getInlinedTag(publicPath, compilation.assets, tag);

			this.htmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('InlineChunkHtmlPlugin', assets => {
				assets.headTags = assets.headTags.map(getInlinedTagFn);
				assets.bodyTags = assets.bodyTags.map(getInlinedTagFn);
			});
		});
	}
}

module.exports =
	/**
	 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; optimizeImages?: boolean; } | undefined } env
	 * @param {{ mode: 'production' | 'development' | 'none' | undefined; }} argv
	 * @returns { WebpackConfig[] }
	 */
	function (env, argv) {
		const mode = argv.mode || 'none';

		env = {
			analyzeBundle: false,
			analyzeDeps: false,
			optimizeImages: mode === 'production',
			...env,
		};

		if (env.analyzeBundle || env.analyzeDeps) {
			env.optimizeImages = false;
		} else if (!env.optimizeImages && !fs.existsSync(path.resolve(__dirname, 'images/settings'))) {
			env.optimizeImages = true;
		}

		return [getExtensionConfig(mode, env), getWebviewsConfig(mode, env)];
	};

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; optimizeImages?: boolean; }} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(mode, env) {
	/**
	 * @type WebpackConfig['plugins']
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['**/*', '!**/webviews/**'] }),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: { enabled: true, files: 'src/**/*.ts', options: { cache: true } },
			formatter: 'basic',
		}),
	];

	if (env.analyzeDeps) {
		plugins.push(
			new CircularDependencyPlugin({
				cwd: __dirname,
				exclude: /node_modules/,
				failOnError: false,
				onDetected: function ({ module: _webpackModuleRecord, paths, compilation }) {
					if (paths.some(p => p.includes('container.ts'))) return;

					compilation.warnings.push(new Error(paths.join(' -> ')));
				},
			}),
		);
	}

	if (env.analyzeBundle) {
		plugins.push(new BundleAnalyzerPlugin());
	}

	return {
		name: 'extension',
		entry: './src/extension.ts',
		mode: mode,
		target: 'node',
		node: {
			__dirname: false,
		},
		devtool: 'source-map',
		output: {
			libraryTarget: 'commonjs2',
			filename: 'gitlens.js',
			chunkFilename: 'feature-[name].js',
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
						module: true,
					},
				}),
			],
			splitChunks: {
				cacheGroups: {
					vendors: false,
				},
				chunks: 'async',
			},
		},
		externals: {
			vscode: 'commonjs vscode',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.resolve(__dirname, 'src'),
					test: /\.tsx?$/,
					use: {
						loader: 'ts-loader',
						options: {
							experimentalWatchApi: true,
							transpileOnly: true,
						},
					},
				},
			],
		},
		resolve: {
			alias: {
				'universal-user-agent': path.resolve(__dirname, 'node_modules/universal-user-agent/dist-node/index.js'),
			},
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			symlinks: false,
		},
		plugins: plugins,
		stats: {
			all: false,
			assets: true,
			builtAt: true,
			env: true,
			errors: true,
			timings: true,
			warnings: true,
		},
	};
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; optimizeImages?: boolean; }} env
 * @returns { WebpackConfig }
 */
function getWebviewsConfig(mode, env) {
	const clean = ['**/*'];
	if (env.optimizeImages) {
		console.log('Optimizing images (src/webviews/apps/images/settings/*.png)...');
		clean.push(path.resolve(__dirname, 'images/settings/*'));
	}

	const cspPolicy = {
		'default-src': "'none'",
		'img-src': ['#{cspSource}', 'https:', 'data:'],
		'script-src': ['#{cspSource}', "'nonce-Z2l0bGVucy1ib290c3RyYXA='"],
		'style-src': ['#{cspSource}'],
	};

	if (mode !== 'production') {
		cspPolicy['script-src'].push("'unsafe-eval'");
	}

	/**
	 * @type WebpackConfig['plugins']
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: clean, cleanStaleWebpackAssets: false }),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: {
				enabled: true,
				files: path.resolve(__dirname, 'src/webviews/apps/**/*.ts'),
				options: { cache: true },
			},
			formatter: 'basic',
			typescript: {
				configFile: path.resolve(__dirname, 'tsconfig.webviews.json'),
			},
		}),
		new MiniCssExtractPlugin({
			filename: '[name].css',
		}),
		new HtmlPlugin({
			template: 'rebase/rebase.html',
			chunks: ['rebase', 'rebase-styles'],
			excludeAssets: [/.+-styles\.js/],
			filename: path.resolve(__dirname, 'dist/webviews/rebase.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
			cspPlugin: {
				enabled: true,
				policy: cspPolicy,
				nonceEnabled: {
					'script-src': true,
					'style-src': true,
				},
			},
			minify:
				mode === 'production'
					? {
							removeComments: true,
							collapseWhitespace: true,
							removeRedundantAttributes: false,
							useShortDoctype: true,
							removeEmptyAttributes: true,
							removeStyleLinkTypeAttributes: true,
							keepClosingSlash: true,
							minifyCSS: true,
					  }
					: false,
		}),
		new HtmlPlugin({
			template: 'settings/settings.html',
			chunks: ['settings', 'settings-styles'],
			excludeAssets: [/.+-styles\.js/],
			filename: path.resolve(__dirname, 'dist/webviews/settings.html'),
			inject: true,
			cspPlugin: {
				enabled: true,
				policy: cspPolicy,
				nonceEnabled: {
					'script-src': true,
					'style-src': true,
				},
			},
			minify:
				mode === 'production'
					? {
							removeComments: true,
							collapseWhitespace: true,
							removeRedundantAttributes: false,
							useShortDoctype: true,
							removeEmptyAttributes: true,
							removeStyleLinkTypeAttributes: true,
							keepClosingSlash: true,
							minifyCSS: true,
					  }
					: false,
		}),
		new HtmlPlugin({
			template: 'welcome/welcome.html',
			chunks: ['welcome', 'welcome-styles'],
			excludeAssets: [/.+-styles\.js/],
			filename: path.resolve(__dirname, 'dist/webviews/welcome.html'),
			inject: true,
			cspPlugin: {
				enabled: true,
				policy: cspPolicy,
				nonceEnabled: {
					'script-src': true,
					'style-src': true,
				},
			},
			minify:
				mode === 'production'
					? {
							removeComments: true,
							collapseWhitespace: true,
							removeRedundantAttributes: false,
							useShortDoctype: true,
							removeEmptyAttributes: true,
							removeStyleLinkTypeAttributes: true,
							keepClosingSlash: true,
							minifyCSS: true,
					  }
					: false,
		}),
		new HtmlSkipAssetsPlugin({}),
		new CspHtmlPlugin(),
		new ImageminPlugin({
			disable: !env.optimizeImages,
			externalImages: {
				context: path.resolve(__dirname, 'src/webviews/apps/images'),
				sources: glob.sync('src/webviews/apps/images/settings/*.png'),
				destination: path.resolve(__dirname, 'images'),
			},
			cacheFolder: path.resolve(__dirname, 'node_modules', '.cache', 'imagemin-webpack-plugin'),
			gifsicle: null,
			jpegtran: null,
			optipng: null,
			pngquant: {
				quality: '85-100',
				speed: mode === 'production' ? 1 : 10,
			},
			svgo: null,
		}),
		new InlineChunkHtmlPlugin(HtmlPlugin, mode === 'production' ? ['\\.css$'] : []),
	];

	return {
		name: 'webviews',
		context: path.resolve(__dirname, 'src/webviews/apps'),
		entry: {
			rebase: ['./rebase/rebase.ts'],
			'rebase-styles': ['./scss/rebase.scss'],
			settings: ['./settings/settings.ts'],
			'settings-styles': ['./scss/settings.scss'],
			welcome: ['./welcome/welcome.ts'],
			'welcome-styles': ['./scss/welcome.scss'],
		},
		mode: mode,
		target: 'web',
		devtool: mode === 'production' ? undefined : 'eval-source-map',
		output: {
			filename: '[name].js',
			path: path.resolve(__dirname, 'dist/webviews'),
			publicPath: '#{root}/dist/webviews/',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.resolve(__dirname, 'src'),
					test: /\.tsx?$/,
					use: {
						loader: 'ts-loader',
						options: {
							configFile: 'tsconfig.webviews.json',
							experimentalWatchApi: true,
							transpileOnly: true,
						},
					},
				},
				{
					test: /\.scss$/,
					use: [
						{
							loader: MiniCssExtractPlugin.loader,
						},
						{
							loader: 'css-loader',
							options: {
								sourceMap: true,
								url: false,
							},
						},
						{
							loader: 'sass-loader',
							options: {
								sourceMap: true,
							},
						},
					],
					exclude: /node_modules/,
				},
			],
		},
		resolve: {
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			modules: [path.resolve(__dirname, 'src/webviews/apps'), 'node_modules'],
			symlinks: false,
		},
		plugins: plugins,
		stats: {
			all: false,
			assets: true,
			builtAt: true,
			env: true,
			errors: true,
			timings: true,
			warnings: true,
		},
	};
}
