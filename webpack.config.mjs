//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

import { spawnSync } from 'child_process';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import CircularDependencyPlugin from 'circular-dependency-plugin';
import { CleanWebpackPlugin as CleanPlugin } from 'clean-webpack-plugin';
import CopyPlugin from 'copy-webpack-plugin';
import CspHtmlPlugin from 'csp-html-webpack-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import esbuild from 'esbuild';
import { ESLintLitePlugin } from '@eamodio/eslint-lite-webpack-plugin';
import { generateFonts } from '@twbs/fantasticon';
import ForkTsCheckerPlugin from 'fork-ts-checker-webpack-plugin';
import fs from 'fs';
import HtmlPlugin from 'html-webpack-plugin';
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import path from 'path';
import { validate } from 'schema-utils';
import TerserPlugin from 'terser-webpack-plugin';
import webpack from 'webpack';
import WebpackRequireFromPlugin from 'webpack-require-from';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { DefinePlugin, optimize, WebpackError } = webpack;

const require = createRequire(import.meta.url);

/**
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; skipLint?: boolean } | undefined } env
 * @param {{ mode: 'production' | 'development' | 'none' | undefined }} argv
 * @returns { WebpackConfig[] }
 */
export default function (env, argv) {
	const mode = argv.mode || 'none';

	env = {
		analyzeBundle: false,
		analyzeDeps: false,
		esbuild: true,
		skipLint: false,
		...env,
	};

	return [
		getExtensionConfig('node', mode, env),
		getExtensionConfig('webworker', mode, env),
		getWebviewsConfig(mode, env),
	];
}

/**
 * @param { 'node' | 'webworker' } target
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; skipLint?: boolean }} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(target, mode, env) {
	const tsConfigPath = path.join(__dirname, `tsconfig.${target === 'webworker' ? 'browser' : 'node'}.json`);

	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['!dist/webviews/**'] }),
		new DefinePlugin({
			DEBUG: mode === 'development',
		}),
		new ForkTsCheckerPlugin({
			async: false,
			formatter: 'basic',
			typescript: {
				configFile: tsConfigPath,
			},
		}),
	];

	if (!env.skipLint) {
		plugins.push(
			new ESLintLitePlugin({
				files: path.join(__dirname, 'src', '**', '*.ts'),
				worker: true,
				eslintOptions: {
					cache: true,
					cacheLocation: path.join(__dirname, '.eslintcache/', target === 'webworker' ? 'browser/' : ''),
					cacheStrategy: 'content',
				},
			}),
		);
	}

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
				onBefore:
					mode !== 'production'
						? undefined
						: () =>
								spawnSync('pnpm', ['run', 'icons:svgo'], {
									cwd: __dirname,
									encoding: 'utf8',
									shell: true,
								}),
				onComplete: () =>
					spawnSync('pnpm', ['run', 'icons:apply'], {
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
			chunkFilename: '[name].js',
			filename: 'gitlens.js',
			libraryTarget: 'commonjs2',
			path: target === 'webworker' ? path.join(__dirname, 'dist', 'browser') : path.join(__dirname, 'dist'),
		},
		optimization: {
			minimizer: [
				new TerserPlugin({
					minify: TerserPlugin.swcMinify,
					extractComments: false,
					parallel: true,
					terserOptions: {
						compress: {
							drop_debugger: true,
							ecma: 2020,
							// Keep the class names otherwise @log won't provide a useful name
							keep_classnames: true,
							module: true,
						},
						ecma: 2020,
						format: {
							comments: false,
							ecma: 2020,
						},
						// Keep the class names otherwise @log won't provide a useful name
						keep_classnames: true,
						mangle: {
							keep_classnames: true,
						},
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
									target: ['es2022', 'chrome114', 'node18.15.0'],
									tsconfig: tsConfigPath,
								},
						  }
						: {
								loader: 'ts-loader',
								options: {
									configFile: tsConfigPath,
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
				// Stupid dependency that is used by `http[s]-proxy-agent`
				debug: path.resolve(__dirname, 'patches', 'debug.js'),
				// This dependency is very large, and isn't needed for our use-case
				tr46: path.resolve(__dirname, 'patches', 'tr46.js'),
				// This dependency is unnecessary for our use-case
				'whatwg-url': path.resolve(__dirname, 'patches', 'whatwg-url.js'),
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
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; skipLint?: boolean }} env
 * @returns { WebpackConfig }
 */
function getWebviewsConfig(mode, env) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');
	const tsConfigPath = path.join(basePath, 'tsconfig.json');

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
			formatter: 'basic',
			typescript: {
				configFile: tsConfigPath,
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
		getHtmlPlugin('patchDetails', true, mode, env),
		getCspHtmlPlugin(mode, env),
		// new InlineChunkHtmlPlugin(HtmlPlugin, mode === 'production' ? ['\\.css$'] : []),
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

	if (!env.skipLint) {
		plugins.push(
			new ESLintLitePlugin({
				files: path.join(basePath, '**', '*.ts?(x)'),
				worker: true,
				eslintOptions: {
					cache: true,
					cacheLocation: path.join(__dirname, '.eslintcache', 'webviews/'),
					cacheStrategy: 'content',
				},
			}),
		);
	}

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
			patchDetails: './plus/patchDetails/patchDetails.ts',
		},
		mode: mode,
		target: 'web',
		devtool: mode === 'production' ? false : 'source-map',
		output: {
			chunkFilename: '[name].js',
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
							new TerserPlugin({
								// Terser seems better than SWC for minifying the webviews (esm?)
								// minify: TerserPlugin.swcMinify,
								extractComments: false,
								parallel: true,
								terserOptions: {
									compress: {
										drop_debugger: true,
										drop_console: true,
										ecma: 2020,
										// Keep the class names otherwise @log won't provide a useful name
										keep_classnames: true,
										module: true,
									},
									ecma: 2020,
									format: {
										comments: false,
										ecma: 2020,
									},
									// Keep the class names otherwise @log won't provide a useful name
									keep_classnames: true,
									mangle: {
										keep_classnames: true,
									},
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
										{
											autoprefixer: false,
											discardUnused: false,
											mergeIdents: false,
											reduceIdents: false,
											zindex: false,
										},
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
									target: ['es2021', 'chrome114'],
									tsconfig: tsConfigPath,
								},
						  }
						: {
								loader: 'ts-loader',
								options: {
									configFile: tsConfigPath,
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
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean } | undefined } env
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
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean } | undefined } env
 * @returns { ImageMinimizerPlugin.Generator<any> }
 */
function getImageMinimizerConfig(mode, env) {
	/** @type ImageMinimizerPlugin.Generator<any> */
	// @ts-ignore
	return {
		type: 'asset',
		implementation: ImageMinimizerPlugin.sharpGenerate,
		options: {
			encodeOptions: {
				webp: {
					lossless: true,
				},
			},
		},
	};
}

/**
 * @param { string } name
 * @param { boolean } plus
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean } | undefined } env
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

		const fontConfig = { ...loadedConfig, ...config };

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
			logger.log(`Generating '${compiler.name}' icon font...`);

			const start = Date.now();

			let onBeforeDuration = 0;
			if (onBefore != null) {
				const start = Date.now();
				await onBefore(fontConfig);
				onBeforeDuration = Date.now() - start;
			}

			await generateFonts(fontConfig);

			let onCompleteDuration = 0;
			if (onComplete != null) {
				const start = Date.now();
				await onComplete(fontConfig);
				onCompleteDuration = Date.now() - start;
			}

			let suffix = '';
			if (onBeforeDuration > 0 || onCompleteDuration > 0) {
				suffix = ` (${onBeforeDuration > 0 ? `onBefore: ${onBeforeDuration}ms` : ''}${
					onCompleteDuration > 0
						? `${onBeforeDuration > 0 ? ', ' : ''}onComplete: ${onCompleteDuration}ms`
						: ''
				})`;
			}

			logger.log(`Generated '${compiler.name}' icon font in \x1b[32m${Date.now() - start}ms\x1b[0m${suffix}`);
		}

		const generateFn = generate.bind(this);
		compiler.hooks.beforeRun.tapPromise(this.pluginName, generateFn);
		compiler.hooks.watchRun.tapPromise(this.pluginName, generateFn);
	}
}
