//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/prefer-optional-chain */
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const CircularDependencyPlugin = require('circular-dependency-plugin');
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const CspHtmlPlugin = require('csp-html-webpack-plugin');
const esbuild = require('esbuild');
const { ESBuildMinifyPlugin } = require('esbuild-loader');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const HtmlPlugin = require('html-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const JSON5 = require('json5');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const { WebpackError } = require('webpack');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports =
	/**
	 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; } | undefined } env
	 * @param {{ mode: 'production' | 'development' | 'none' | undefined; }} argv
	 * @returns { WebpackConfig[] }
	 */
	function (env, argv) {
		const mode = argv.mode || 'none';

		env = {
			analyzeBundle: false,
			analyzeDeps: false,
			esbuild: true,
			...env,
		};

		return [
			getExtensionConfig('node', mode, env),
			getExtensionConfig('webworker', mode, env),
			getWebviewsConfig(mode, env),
		];
	};

/**
 * @param { 'node' | 'webworker' } target
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; }} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(target, mode, env) {
	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['!webviews/**'] }),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: {
				enabled: true,
				files: 'src/**/*.ts',
				options: {
					// cache: true,
					cacheLocation: path.join(
						__dirname,
						target === 'webworker' ? '.eslintcache.browser' : '.eslintcache',
					),
					overrideConfigFile: path.join(
						__dirname,
						target === 'webworker' ? '.eslintrc.browser.json' : '.eslintrc.json',
					),
				},
			},
			formatter: 'basic',
			typescript: {
				configFile: path.join(__dirname, target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json'),
			},
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

					// @ts-ignore
					compilation.warnings.push(new WebpackError(paths.join(' -> ')));
				},
			}),
		);
	}

	if (env.analyzeBundle) {
		plugins.push(new BundleAnalyzerPlugin());
	}

	return {
		name: `extension:${target}`,
		entry: {
			extension: './src/extension.ts',
		},
		mode: mode,
		target: target,
		devtool: 'source-map',
		output: {
			path: target === 'webworker' ? path.join(__dirname, 'dist', 'browser') : path.join(__dirname, 'dist'),
			libraryTarget: 'commonjs2',
			filename: 'gitlens.js',
			chunkFilename: 'feature-[name].js',
		},
		optimization: {
			minimizer: [
				env.esbuild
					? new ESBuildMinifyPlugin({
							format: 'cjs',
							// @ts-ignore
							implementation: esbuild,
							minify: true,
							treeShaking: true,
							// Keep the class names otherwise @log won't provide a useful name
							keepNames: true,
							target: 'es2020',
					  })
					: new TerserPlugin({
							extractComments: false,
							parallel: true,
							terserOptions: {
								ecma: 2020,
								// Keep the class names otherwise @log won't provide a useful name
								keep_classnames: true,
								module: true,
							},
					  }),
			],
			splitChunks: {
				cacheGroups: {
					defaultVendors: false,
				},
			},
		},
		externals: {
			vscode: 'commonjs vscode',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.join(__dirname, 'src'),
					test: /\.tsx?$/,
					use: env.esbuild
						? {
								loader: 'esbuild-loader',
								options: {
									implementation: esbuild,
									loader: 'ts',
									target: ['es2020', 'chrome91', 'node14.16'],
									tsconfigRaw: resolveTSConfig(
										path.join(
											__dirname,
											target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
										),
									),
								},
						  }
						: {
								loader: 'ts-loader',
								options: {
									configFile: path.join(
										__dirname,
										target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
									),
									experimentalWatchApi: true,
									transpileOnly: true,
								},
						  },
				},
			],
		},
		resolve: {
			alias:
				target === 'webworker'
					? {
							'@env': path.resolve(__dirname, 'src', 'env', 'browser'),
					  }
					: {
							'@env': path.resolve(__dirname, 'src', 'env', target),
							// 'universal-user-agent': path.join(
							// 	__dirname,
							// 	'node_modules',
							// 	'universal-user-agent',
							// 	'dist-node',
							// 	'index.js',
							// ),
					  },
			fallback:
				target === 'webworker'
					? {
							child_process: false,
							crypto: require.resolve('crypto-browserify'),
							fs: false,
							os: false,
							path: require.resolve('path-browserify'),
							process: false,
							stream: false,
							url: false,
					  }
					: undefined,
			mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
		},
		plugins: plugins,
		stats: {
			preset: 'errors-warnings',
			assets: true,
			colors: true,
			env: true,
			errorsCount: true,
			warningsCount: true,
			timings: true,
		},
	};
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; }} env
 * @returns { WebpackConfig }
 */
function getWebviewsConfig(mode, env) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');

	const cspHtmlPlugin = new CspHtmlPlugin(
		{
			'default-src': "'none'",
			'img-src': ['#{cspSource}', 'https:', 'data:'],
			'script-src':
				mode !== 'production'
					? ['#{cspSource}', "'nonce-#{cspNonce}'", "'unsafe-eval'"]
					: ['#{cspSource}', "'nonce-#{cspNonce}'"],
			'style-src': ['#{cspSource}', "'nonce-#{cspNonce}'"],
			'font-src': ['#{cspSource}'],
		},
		{
			enabled: true,
			hashingMethod: 'sha256',
			hashEnabled: {
				'script-src': true,
				'style-src': true,
			},
			nonceEnabled: {
				'script-src': true,
				'style-src': true,
			},
		},
	);
	// Override the nonce creation so we can dynamically generate them at runtime
	// @ts-ignore
	cspHtmlPlugin.createNonce = () => '#{cspNonce}';

	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new CleanPlugin(
			mode === 'production'
				? {
						cleanOnceBeforeBuildPatterns: [
							path.posix.join(__dirname.replace(/\\/g, '/'), 'images', 'settings', '**'),
						],
						dangerouslyAllowCleanPatternsOutsideProject: true,
						dry: false,
				  }
				: undefined,
		),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: {
				enabled: true,
				files: path.join(basePath, '**', '*.ts'),
				// options: { cache: true },
			},
			formatter: 'basic',
			typescript: {
				configFile: path.join(basePath, 'tsconfig.json'),
			},
		}),
		new MiniCssExtractPlugin({
			filename: '[name].css',
		}),
		new HtmlPlugin({
			template: 'rebase/rebase.html',
			chunks: ['rebase'],
			filename: path.join(__dirname, 'dist', 'webviews', 'rebase.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
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
			chunks: ['settings'],
			filename: path.join(__dirname, 'dist', 'webviews', 'settings.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
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
			chunks: ['welcome'],
			filename: path.join(__dirname, 'dist', 'webviews', 'welcome.html'),
			inject: true,
			inlineSource: mode === 'production' ? '.css$' : undefined,
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
		cspHtmlPlugin,
		new InlineChunkHtmlPlugin(HtmlPlugin, mode === 'production' ? ['\\.css$'] : []),
		new CopyPlugin({
			patterns: [
				{
					from: path.posix.join(basePath.replace(/\\/g, '/'), 'images', 'settings', '*.png'),
					to: __dirname.replace(/\\/g, '/'),
				},
				{
					from: path.posix.join(
						__dirname.replace(/\\/g, '/'),
						'node_modules',
						'@vscode',
						'codicons',
						'dist',
						'codicon.ttf',
					),
					to: path.posix.join(__dirname.replace(/\\/g, '/'), 'dist', 'webviews'),
				},
			],
		}),
		new ImageMinimizerPlugin({
			test: /\.(png)$/i,
			filename: '[path][name].webp',
			loader: false,
			deleteOriginalAssets: true,
			minimizerOptions: {
				plugins: [
					[
						'imagemin-webp',
						{
							lossless: true,
							nearLossless: 0,
							quality: 100,
							method: mode === 'production' ? 4 : 0,
						},
					],
				],
			},
		}),
	];

	return {
		name: 'webviews',
		context: basePath,
		entry: {
			rebase: './rebase/rebase.ts',
			settings: './settings/settings.ts',
			welcome: './welcome/welcome.ts',
		},
		mode: mode,
		target: 'web',
		devtool: 'source-map',
		output: {
			filename: '[name].js',
			path: path.join(__dirname, 'dist', 'webviews'),
			publicPath: '#{root}/dist/webviews/',
		},
		module: {
			rules: [
				{
					exclude: /\.d\.ts$/,
					include: path.join(__dirname, 'src'),
					test: /\.tsx?$/,
					use: env.esbuild
						? {
								loader: 'esbuild-loader',
								options: {
									implementation: esbuild,
									loader: 'ts',
									target: 'es2020',
									tsconfigRaw: resolveTSConfig(path.join(basePath, 'tsconfig.json')),
								},
						  }
						: {
								loader: 'ts-loader',
								options: {
									configFile: path.join(basePath, 'tsconfig.json'),
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
			modules: [basePath, 'node_modules'],
		},
		plugins: plugins,
		stats: {
			preset: 'errors-warnings',
			assets: true,
			colors: true,
			env: true,
			errorsCount: true,
			warningsCount: true,
			timings: true,
		},
		infrastructureLogging: {
			level: 'log', // enables logging required for problem matchers
		},
	};
}

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

/**
 * @param { string } configFile
 * @returns { string }
 */
function resolveTSConfig(configFile) {
	const result = spawnSync('yarn', ['tsc', `-p ${configFile}`, '--showConfig'], {
		cwd: __dirname,
		encoding: 'utf8',
		shell: true,
	});

	const data = result.stdout;
	const start = data.indexOf('{');
	const end = data.lastIndexOf('}') + 1;
	const json = JSON5.parse(data.substring(start, end));
	return json;
}
