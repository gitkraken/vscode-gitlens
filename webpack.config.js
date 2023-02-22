//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

const { spawnSync } = require('child_process');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const CircularDependencyPlugin = require('circular-dependency-plugin');
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const CspHtmlPlugin = require('csp-html-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const esbuild = require('esbuild');
const { EsbuildPlugin } = require('esbuild-loader');
const { generateFonts } = require('fantasticon');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const fs = require('fs');
const HtmlPlugin = require('html-webpack-plugin');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const path = require('path');
const { validate } = require('schema-utils');
const TerserPlugin = require('terser-webpack-plugin');
const { DefinePlugin, optimize, WebpackError } = require('webpack');
const WebpackRequireFromPlugin = require('webpack-require-from');

module.exports =
	/**
	 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; esbuildMinify?: boolean; useSharpForImageOptimization?: boolean } | undefined } env
	 * @param {{ mode: 'production' | 'development' | 'none' | undefined }} argv
	 * @returns { WebpackConfig[] }
	 */
	function (env, argv) {
		const mode = argv.mode || 'none';

		env = {
			analyzeBundle: false,
			analyzeDeps: false,
			esbuild: true,
			esbuildMinify: false,
			useSharpForImageOptimization: true,
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
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; esbuildMinify?: boolean; useSharpForImageOptimization?: boolean }} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(target, mode, env) {
	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['!dist/webviews/**'] }),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: {
				enabled: true,
				files: 'src/**/*.ts?(x)',
				options: {
					cache: true,
					cacheLocation: path.join(__dirname, '.eslintcache/', target === 'webworker' ? 'browser/' : ''),
					cacheStrategy: 'content',
					fix: mode !== 'production',
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

	if (target === 'webworker') {
		plugins.push(new optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
	} else {
		// Ensure that the dist folder exists otherwise the FantasticonPlugin will fail
		const dist = path.join(__dirname, 'dist');
		if (!fs.existsSync(dist)) {
			fs.mkdirSync(dist);
		}

		plugins.push(
			new FantasticonPlugin({
				configPath: '.fantasticonrc.js',
				onBefore: () =>
					spawnSync('yarn', ['run', 'icons:svgo'], {
						cwd: __dirname,
						encoding: 'utf8',
						shell: true,
					}),
				onComplete: () =>
					spawnSync('yarn', ['run', 'icons:apply'], {
						cwd: __dirname,
						encoding: 'utf8',
						shell: true,
					}),
			}),
		);
	}

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
		const out = path.join(__dirname, 'out');
		if (!fs.existsSync(out)) {
			fs.mkdirSync(out);
		}

		plugins.push(
			new BundleAnalyzerPlugin({
				analyzerMode: 'static',
				generateStatsFile: true,
				openAnalyzer: false,
				reportFilename: path.join(out, `extension-${target}-bundle-report.html`),
				statsFilename: path.join(out, 'stats.json'),
			}),
		);
	}

	return {
		name: `extension:${target}`,
		entry: {
			extension: './src/extension.ts',
		},
		mode: mode,
		target: target,
		devtool: mode === 'production' ? false : 'source-map',
		output: {
			chunkFilename: 'feature-[name].js',
			filename: 'gitlens.js',
			libraryTarget: 'commonjs2',
			path: target === 'webworker' ? path.join(__dirname, 'dist', 'browser') : path.join(__dirname, 'dist'),
		},
		optimization: {
			minimizer: [
				env.esbuildMinify
					? new EsbuildPlugin({
							drop: ['debugger'],
							format: 'cjs',
							// Keep the class names otherwise @log won't provide a useful name
							keepNames: true,
							legalComments: 'none',
							minify: true,
							target: 'es2022',
							treeShaking: true,
					  })
					: new TerserPlugin({
							extractComments: false,
							parallel: true,
							terserOptions: {
								compress: {
									drop_debugger: true,
									ecma: 2020,
									module: true,
								},
								ecma: 2020,
								format: {
									comments: false,
									ecma: 2020,
								},
								// Keep the class names otherwise @log won't provide a useful name
								keep_classnames: true,
								module: true,
							},
					  }),
			],
			splitChunks:
				target === 'webworker'
					? false
					: {
							// Disable all non-async code splitting
							chunks: () => false,
							cacheGroups: {
								default: false,
								vendors: false,
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
									format: 'esm',
									implementation: esbuild,
									target: ['es2022', 'chrome102', 'node16.14.2'],
									tsconfig: path.join(
										__dirname,
										target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
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
			alias: {
				'@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : target),
				// This dependency is very large, and isn't needed for our use-case
				tr46: path.resolve(__dirname, 'patches', 'tr46.js'),
				// Stupid dependency that is used by `http-proxy-agent`
				debug:
					target === 'webworker'
						? path.resolve(__dirname, 'node_modules', 'debug', 'src', 'browser.js')
						: path.resolve(__dirname, 'node_modules', 'debug', 'src', 'node.js'),
			},
			fallback:
				target === 'webworker'
					? { path: require.resolve('path-browserify'), os: require.resolve('os-browserify/browser') }
					: undefined,
			mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
		},
		plugins: plugins,
		infrastructureLogging:
			mode === 'production'
				? undefined
				: {
						level: 'log', // enables logging required for problem matchers
				  },
		stats: {
			preset: 'errors-warnings',
			assets: true,
			assetsSort: 'name',
			assetsSpace: 100,
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
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; esbuildMinify?: boolean; useSharpForImageOptimization?: boolean }} env
 * @returns { WebpackConfig }
 */
function getWebviewsConfig(mode, env) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');

	/** @type WebpackConfig['plugins'] | any */
	const plugins = [
		new CleanPlugin(
			mode === 'production'
				? {
						cleanOnceBeforeBuildPatterns: [
							path.posix.join(__dirname.replace(/\\/g, '/'), 'dist', 'webviews', 'media', '**'),
						],
						dangerouslyAllowCleanPatternsOutsideProject: true,
						dry: false,
				  }
				: undefined,
		),
		new DefinePlugin({
			DEBUG: mode === 'development',
		}),
		new ForkTsCheckerPlugin({
			async: false,
			eslint: {
				enabled: true,
				files: path.join(basePath, '**', '*.ts?(x)'),
				options: {
					cache: true,
					cacheLocation: path.join(__dirname, '.eslintcache', 'webviews/'),
					cacheStrategy: 'content',
					fix: mode !== 'production',
				},
			},
			formatter: 'basic',
			typescript: {
				configFile: path.join(basePath, 'tsconfig.json'),
			},
		}),
		new WebpackRequireFromPlugin({
			variableName: 'webpackResourceBasePath',
		}),
		new MiniCssExtractPlugin({ filename: '[name].css' }),
		getHtmlPlugin('commitDetails', false, mode, env),
		getHtmlPlugin('graph', true, mode, env),
		getHtmlPlugin('home', false, mode, env),
		getHtmlPlugin('rebase', false, mode, env),
		getHtmlPlugin('settings', false, mode, env),
		getHtmlPlugin('timeline', true, mode, env),
		getHtmlPlugin('welcome', false, mode, env),
		getHtmlPlugin('focus', true, mode, env),
		getCspHtmlPlugin(mode, env),
		new InlineChunkHtmlPlugin(HtmlPlugin, mode === 'production' ? ['\\.css$'] : []),
		new CopyPlugin({
			patterns: [
				{
					from: path.posix.join(basePath.replace(/\\/g, '/'), 'media', '*.*'),
					to: path.posix.join(__dirname.replace(/\\/g, '/'), 'dist', 'webviews'),
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
	];

	const imageGeneratorConfig = getImageMinimizerConfig(mode, env);

	if (mode !== 'production') {
		plugins.push(
			new ImageMinimizerPlugin({
				deleteOriginalAssets: true,
				generator: [imageGeneratorConfig],
			}),
		);
	}

	if (env.analyzeBundle) {
		const out = path.join(__dirname, 'out');
		if (!fs.existsSync(out)) {
			fs.mkdirSync(out);
		}

		plugins.push(
			new BundleAnalyzerPlugin({
				analyzerMode: 'static',
				generateStatsFile: true,
				openAnalyzer: false,
				reportFilename: path.join(out, 'webview-bundle-report.html'),
				statsFilename: path.join(out, 'stats.json'),
			}),
		);
	}

	return {
		name: 'webviews',
		context: basePath,
		entry: {
			commitDetails: './commitDetails/commitDetails.ts',
			graph: './plus/graph/graph.tsx',
			home: './home/home.ts',
			rebase: './rebase/rebase.ts',
			settings: './settings/settings.ts',
			timeline: './plus/timeline/timeline.ts',
			welcome: './welcome/welcome.ts',
			focus: './plus/focus/focus.ts',
		},
		mode: mode,
		target: 'web',
		devtool: mode === 'production' ? false : 'source-map',
		output: {
			chunkFilename: 'feature-[name].js',
			filename: '[name].js',
			libraryTarget: 'module',
			path: path.join(__dirname, 'dist', 'webviews'),
			publicPath: '#{root}/dist/webviews/',
		},
		experiments: {
			outputModule: true,
		},
		optimization: {
			minimizer:
				mode === 'production'
					? [
							env.esbuildMinify
								? new EsbuildPlugin({
										css: true,
										drop: ['debugger', 'console'],
										format: 'esm',
										// Keep the class names otherwise @log won't provide a useful name
										// keepNames: true,
										legalComments: 'none',
										minify: true,
										target: 'es2022',
										treeShaking: true,
								  })
								: new TerserPlugin({
										extractComments: false,
										parallel: true,
										terserOptions: {
											compress: {
												drop_debugger: true,
												drop_console: true,
												ecma: 2020,
												module: true,
											},
											ecma: 2020,
											format: {
												comments: false,
												ecma: 2020,
											},
											// // Keep the class names otherwise @log won't provide a useful name
											// keep_classnames: true,
											module: true,
										},
								  }),
							new ImageMinimizerPlugin({
								deleteOriginalAssets: true,
								generator: [imageGeneratorConfig],
							}),
							new CssMinimizerPlugin({
								minimizerOptions: {
									preset: [
										'cssnano-preset-advanced',
										{ discardUnused: false, mergeIdents: false, reduceIdents: false },
									],
								},
							}),
					  ]
					: [],
			splitChunks: {
				// Disable all non-async code splitting
				// chunks: () => false,
				cacheGroups: {
					default: false,
					vendors: false,
				},
			},
		},
		module: {
			rules: [
				{
					test: /\.m?js/,
					resolve: { fullySpecified: false },
				},
				{
					exclude: /\.d\.ts$/,
					include: path.join(__dirname, 'src'),
					test: /\.tsx?$/,
					use: env.esbuild
						? {
								loader: 'esbuild-loader',
								options: {
									format: 'esm',
									implementation: esbuild,
									target: 'es2021',
									tsconfig: path.join(basePath, 'tsconfig.json'),
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
								sourceMap: mode !== 'production',
								url: false,
							},
						},
						{
							loader: 'sass-loader',
							options: {
								sourceMap: mode !== 'production',
							},
						},
					],
					exclude: /node_modules/,
				},
			],
		},
		resolve: {
			alias: {
				'@env': path.resolve(__dirname, 'src', 'env', 'browser'),
				'@microsoft/fast-foundation': path.resolve(
					__dirname,
					'node_modules/@microsoft/fast-foundation/dist/esm/index.js',
				),
				'@microsoft/fast-react-wrapper': path.resolve(
					__dirname,
					'node_modules/@microsoft/fast-react-wrapper/dist/esm/index.js',
				),
				react: path.resolve(__dirname, 'node_modules', 'react'),
				'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
				tslib: path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js'),
			},
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			modules: [basePath, 'node_modules'],
		},
		plugins: plugins,
		infrastructureLogging:
			mode === 'production'
				? undefined
				: {
						level: 'log', // enables logging required for problem matchers
				  },
		stats: {
			preset: 'errors-warnings',
			assets: true,
			assetsSort: 'name',
			assetsSpace: 100,
			colors: true,
			env: true,
			errorsCount: true,
			excludeAssets: [/\.(ttf|webp)/],
			warningsCount: true,
			timings: true,
		},
	};
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; useSharpForImageOptimization?: boolean } | undefined } env
 * @returns { CspHtmlPlugin }
 */
function getCspHtmlPlugin(mode, env) {
	const cspPlugin = new CspHtmlPlugin(
		{
			'default-src': "'none'",
			'img-src': ['#{cspSource}', 'https:', 'data:'],
			'script-src':
				mode !== 'production'
					? ['#{cspSource}', "'nonce-#{cspNonce}'", "'unsafe-eval'"]
					: ['#{cspSource}', "'nonce-#{cspNonce}'"],
			'style-src':
				mode === 'production'
					? ['#{cspSource}', "'nonce-#{cspNonce}'", "'unsafe-hashes'"]
					: ['#{cspSource}', "'unsafe-hashes'", "'unsafe-inline'"],
			'font-src': ['#{cspSource}'],
		},
		{
			enabled: true,
			hashingMethod: 'sha256',
			hashEnabled: {
				'script-src': true,
				'style-src': mode === 'production',
			},
			nonceEnabled: {
				'script-src': true,
				'style-src': mode === 'production',
			},
		},
	);
	// Override the nonce creation so we can dynamically generate them at runtime
	// @ts-ignore
	cspPlugin.createNonce = () => '#{cspNonce}';

	return cspPlugin;
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; useSharpForImageOptimization?: boolean } | undefined } env
 * @returns { ImageMinimizerPlugin.Generator<any> }
 */
function getImageMinimizerConfig(mode, env) {
	/** @type ImageMinimizerPlugin.Generator<any> */
	// @ts-ignore
	return env.useSharpForImageOptimization
		? {
				type: 'asset',
				implementation: ImageMinimizerPlugin.sharpGenerate,
				options: {
					encodeOptions: {
						webp: {
							lossless: true,
						},
					},
				},
		  }
		: {
				type: 'asset',
				implementation: ImageMinimizerPlugin.imageminGenerate,
				options: {
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
		  };
}

/**
 * @param { string } name
 * @param { boolean } plus
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; useSharpForImageOptimization?: boolean } | undefined } env
 * @returns { HtmlPlugin }
 */
function getHtmlPlugin(name, plus, mode, env) {
	return new HtmlPlugin({
		template: plus ? path.join('plus', name, `${name}.html`) : path.join(name, `${name}.html`),
		chunks: [name],
		filename: path.join(__dirname, 'dist', 'webviews', `${name}.html`),
		inject: true,
		scriptLoading: 'module',
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
	});
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
			const sortFn = (a, b) => (a.tagName === 'script' ? 1 : -1) - (b.tagName === 'script' ? 1 : -1);
			this.htmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('InlineChunkHtmlPlugin', assets => {
				assets.headTags = assets.headTags.map(getInlinedTagFn).sort(sortFn);
				assets.bodyTags = assets.bodyTags.map(getInlinedTagFn).sort(sortFn);
			});
		});
	}
}

const schema = {
	type: 'object',
	properties: {
		config: {
			type: 'object',
		},
		configPath: {
			type: 'string',
		},
		onBefore: {
			instanceof: 'Function',
		},
		onComplete: {
			instanceof: 'Function',
		},
	},
};

class FantasticonPlugin {
	alreadyRun = false;

	constructor(options = {}) {
		this.pluginName = 'fantasticon';
		this.options = options;

		validate(
			// @ts-ignore
			schema,
			options,
			{
				name: this.pluginName,
				baseDataPath: 'options',
			},
		);
	}

	/**
	 * @param {import("webpack").Compiler} compiler
	 */
	apply(compiler) {
		const {
			config = undefined,
			configPath = undefined,
			onBefore = undefined,
			onComplete = undefined,
		} = this.options;

		let loadedConfig;
		if (configPath) {
			try {
				loadedConfig = require(path.join(__dirname, configPath));
			} catch (ex) {
				console.error(`[${this.pluginName}] Error loading configuration: ${ex}`);
			}
		}

		if (!loadedConfig && !config) {
			console.error(`[${this.pluginName}] Error loading configuration: no configuration found`);
			return;
		}

		const fontConfig = { ...(loadedConfig ?? {}), ...(config ?? {}) };

		// TODO@eamodio: Figure out how to add watching for the fontConfig.inputDir
		// Maybe something like: https://github.com/Fridus/webpack-watch-files-plugin

		/**
		 * @this {FantasticonPlugin}
		 * @param {import("webpack").Compiler} compiler
		 */
		async function generate(compiler) {
			if (compiler.watchMode) {
				if (this.alreadyRun) return;
				this.alreadyRun = true;
			}

			const logger = compiler.getInfrastructureLogger(this.pluginName);
			logger.log(`Generating icon font...`);
			await onBefore?.(fontConfig);
			await generateFonts(fontConfig);
			await onComplete?.(fontConfig);
			logger.log(`Generated icon font`);
		}

		compiler.hooks.beforeRun.tapPromise(this.pluginName, generate.bind(this));
		compiler.hooks.watchRun.tapPromise(this.pluginName, generate.bind(this));
	}
}
