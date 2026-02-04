//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

import { spawn, spawnSync } from 'child_process';
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';
import CircularDependencyPlugin from 'circular-dependency-plugin';

import CopyPlugin from 'copy-webpack-plugin';
import CspHtmlPlugin from 'csp-html-webpack-plugin';
import CssMinimizerPlugin from 'css-minimizer-webpack-plugin';
import esbuild from 'esbuild';
import { ESLintLitePlugin } from '@eamodio/eslint-lite-webpack-plugin';
import { generateFonts } from 'fantasticon';
import ForkTsCheckerPlugin from 'fork-ts-checker-webpack-plugin';
import fs from 'fs';
import HtmlPlugin from 'html-webpack-plugin';
import ImageMinimizerPlugin from 'image-minimizer-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import { createRequire } from 'module';
import { availableParallelism } from 'os';
import path from 'path';
import { defineReactCompilerLoaderOption, reactCompilerLoader } from 'react-compiler-webpack';
import { validate } from 'schema-utils';
import TerserPlugin from 'terser-webpack-plugin';
import { fileURLToPath, pathToFileURL } from 'url';
import webpack from 'webpack';
import WebpackRequireFromPlugin from 'webpack-require-from';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { DefinePlugin, optimize, WebpackError } = webpack;

const require = createRequire(import.meta.url);

const cores = Math.max(Math.floor(availableParallelism() / 6) - 1, 1);
const eslintWorker = { max: cores, filesPerWorker: 100 };
/** @type import('@eamodio/eslint-lite-webpack-plugin').ESLintLitePluginOptions['eslintOptions'] */
const eslintOptions = {
	cache: true,
	cacheStrategy: 'metadata',
	// concurrency: 'auto',
};

const debug = Boolean(process.env.DEBUG);
const useAsyncTypeChecking = false;
const useNpm = Boolean(process.env.GL_USE_NPM);
if (useNpm) {
	console.log('Using npm to run scripts');
}

const pkgMgr = useNpm ? 'npm' : 'pnpm';

/** @typedef {'production' | 'development' | 'none'} GlMode */
/** @typedef { 'node' | 'webworker' } GlTarget */
/** @typedef {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean; quick?: 'turbo' | boolean; trace?: boolean; webviews?: string }} GlEnv */
/** @typedef {{ [key: string]: { entry: string; plus?: boolean; alias?: { [key: string]: string } } }} GlWebviews */

/**
 * @param {GlEnv | undefined } env
 * @param {{ mode: GlMode | undefined }} argv
 * @returns { WebpackConfig[] }
 */
export default function (env, argv) {
	const mode = argv.mode || 'none';

	env = {
		analyzeBundle: false,
		analyzeDeps: false,
		esbuild: true,
		quick: false,
		trace: false,
		...env,
	};

	if (env.quick) {
		if (env.quick === 'turbo') {
			console.log('Turbo mode enabled — skipping type checking, linting, and docs generation');
		} else {
			console.log('Quick mode enabled — skipping linting and docs generation');
		}
	}

	if (env.trace) {
		console.log('Trace mode enabled — generating TypeScript trace files in dist/trace/');
	}

	/** @type {WebpackConfig[]} */
	const configs = [
		getCommonConfig(mode, env),
		getExtensionConfig('node', mode, env),
		getExtensionConfig('webworker', mode, env),
		getWebviewsCommonConfig(mode, env),
		...getWebviewsConfigs(mode, env),
		getUnitTestConfig('node', mode, env),
	];

	const buildComplete = new BuildCompletePlugin();
	for (const config of configs) {
		(config.plugins ??= []).push(buildComplete);
	}

	return configs;
}

/** @type WebpackConfig['stats'] */
const stats = {
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
};

/**
 * @param {string} name
 * @param { GlTarget } target
 * @param { GlMode } mode
 * @returns { WebpackConfig['cache'] }
 */
function getCacheConfig(name, target, mode) {
	return undefined;
	// Attempt at caching to improve build times, but it doesn't seem to help much if at all
	// return {
	// 	type: 'filesystem',
	// 	cacheDirectory: path.join(__dirname, '.webpack-cache'),
	// 	buildDependencies: {
	// 		config: [__filename],
	// 	},
	// 	name: `${name}-${target}-${mode}`, // Unique per config
	// };
}

/**
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { WebpackConfig }
 */
function getCommonConfig(mode, env) {
	// Ensure that the dist folder exists otherwise the FantasticonPlugin will fail
	const dist = path.join(__dirname, 'dist');
	if (!fs.existsSync(dist)) {
		fs.mkdirSync(dist);
	}

	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [];
	if (!env.quick && mode !== 'production') {
		plugins.push(new DocsPlugin());
	}

	if (!env.quick || mode === 'production') {
		plugins.push(
			new LicensesPlugin(),
			new FantasticonPlugin({
				configPath: '.fantasticonrc.js',
				onBefore:
					mode !== 'production'
						? undefined
						: () =>
								spawnSync(pkgMgr, ['run', 'icons:svgo'], {
									cwd: __dirname,
									encoding: 'utf8',
									shell: true,
								}),
				onComplete: () =>
					spawnSync(pkgMgr, ['run', 'icons:apply'], { cwd: __dirname, encoding: 'utf8', shell: true }),
			}),
		);
	}

	return {
		name: 'common',
		context: __dirname,
		entry: {},
		mode: mode,
		plugins: plugins,
		infrastructureLogging: mode === 'production' ? undefined : { level: 'log' }, // enables logging required for problem matchers
		stats: stats,
		cache: getCacheConfig('common', 'node', mode),
	};
}

/**
 * @param { GlTarget } target
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(target, mode, env) {
	const tsConfigPath = path.join(__dirname, `tsconfig.${target === 'webworker' ? 'browser' : 'node'}.json`);

	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new DefinePlugin({
			DEBUG: debug || mode === 'development',
			'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
		}),
	];

	if (env.quick !== 'turbo') {
		plugins.push(
			new ForkTsCheckerPlugin({
				async: useAsyncTypeChecking,
				formatter: 'basic',
				typescript: {
					configFile: tsConfigPath,
					memoryLimit: 4096,
					...(env.trace
						? {
								configOverwrite: {
									compilerOptions: {
										generateTrace: path.join(__dirname, 'dist', 'trace', `extension-${target}`),
									},
								},
							}
						: {}),
				},
			}),
		);
	}

	// Only lint in node build - webworker uses same ESLint config, just different tsconfig
	if (!env.quick && target !== 'webworker') {
		plugins.push(
			new ESLintLitePlugin({
				files: path.join(__dirname, 'src', '**', '*.ts'),
				exclude: ['**/@types/**', '**/webviews/apps/**', '**/__tests__/**'],
				worker: eslintWorker,
				eslintOptions: { ...eslintOptions, cacheLocation: path.join(__dirname, '.eslintcache/') },
			}),
		);
	}

	if (target === 'webworker') {
		plugins.push(new optimize.LimitChunkCountPlugin({ maxChunks: 1 }));
	} else {
		plugins.push(
			new GenerateContributionsPlugin(),
			new ExtractContributionsPlugin(),
			new GenerateCommandTypesPlugin(),
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
		entry: { extension: './src/extension.ts' },
		mode: mode,
		target: target,
		devtool: mode === 'production' && !env.analyzeBundle ? false : 'source-map',
		output: {
			chunkFilename: '[name].js',
			filename: 'gitlens.js',
			libraryTarget: 'commonjs2',
			path: target === 'webworker' ? path.join(__dirname, 'dist', 'browser') : path.join(__dirname, 'dist'),
			// Clean output directory, but preserve other build targets' output directories
			// node target (dist/) needs to preserve webviews/, browser/, and glicons font files; webworker target (dist/browser/) can clean freely
			clean:
				target === 'webworker'
					? true
					: {
							keep: asset =>
								asset.startsWith('webviews/') ||
								asset.startsWith('browser/') ||
								asset.startsWith('glicons'),
						},
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
							drop_console: true,
							ecma: 2020,
							// Keep the class names otherwise @log won't provide a useful name
							keep_classnames: true,
							module: true,
						},
						format: { comments: false, ecma: 2020 },
						mangle: {
							// Keep the class names otherwise @log won't provide a useful name
							keep_classnames: true,
						},
					},
				}),
			],
			splitChunks:
				target === 'webworker'
					? false
					: {
							// Disable all non-async code splitting
							chunks: () => false,
							cacheGroups: { default: false, vendors: false },
						},
		},
		externals: { vscode: 'commonjs vscode' },
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
									target: ['es2023', 'chrome124', 'node20.14.0'],
									tsconfig: tsConfigPath,
								},
							}
						: {
								loader: 'ts-loader',
								options: { configFile: tsConfigPath, experimentalWatchApi: true, transpileOnly: true },
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
			extensionAlias: { '.js': ['.ts', '.js'], '.jsx': ['.tsx', '.jsx'] },
			fallback: {
				'../../../product.json': false,
				...(target === 'webworker'
					? { path: require.resolve('path-browserify'), os: require.resolve('os-browserify/browser') }
					: {}),
			},
			mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
		},
		plugins: plugins,
		infrastructureLogging: mode === 'production' ? undefined : { level: 'log' }, // enables logging required for problem matchers
		stats: stats,
		cache: getCacheConfig('extension', target, mode),
	};
}

/**
 * Unit test config - delegates to esbuild via EsbuildTestsPlugin for faster builds.
 * @param { GlTarget } _target
 * @param { GlMode } mode
 * @param {GlEnv} _env
 * @returns { WebpackConfig }
 */
function getUnitTestConfig(_target, mode, _env) {
	return {
		name: 'unit-tests',
		context: __dirname,
		// Empty entry - esbuild handles the actual bundling
		entry: {},
		mode: mode,
		plugins: [new EsbuildTestsPlugin()],
		infrastructureLogging: mode === 'production' ? undefined : { level: 'log' },
		stats: 'none',
	};
}

/**
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { WebpackConfig[] }
 */
function getWebviewsConfigs(mode, env) {
	/** @type GlWebviews */
	let webviews = {
		commitDetails: { entry: './commitDetails/commitDetails.ts' },
		composer: { entry: './plus/composer/composer.ts', plus: true },
		graph: { entry: './plus/graph/graph.ts', plus: true },
		home: { entry: './home/home.ts' },
		rebase: { entry: './rebase/rebase.ts' },
		settings: { entry: './settings/settings.ts' },
		timeline: { entry: './plus/timeline/timeline.ts', plus: true },
		patchDetails: { entry: './plus/patchDetails/patchDetails.ts', plus: true },
		welcome: { entry: './welcome/welcome.ts' },
	};

	if (env.webviews) {
		const chosen = env.webviews.split(',');
		webviews = Object.fromEntries(Object.entries(webviews).filter(([key]) => chosen.includes(key)));
	}

	return [getWebviewConfig(webviews, {}, mode, env)];
}

/**
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { WebpackConfig }
 */
function getWebviewsCommonConfig(mode, env) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');

	/** @type WebpackConfig['plugins'] | any */
	const plugins = [
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

	if (!env.quick) {
		plugins.push(
			new ESLintLitePlugin({
				files: '**/*.ts?(x)',
				exclude: ['**/__tests__/**'],
				worker: eslintWorker,
				eslintOptions: { ...eslintOptions, cacheLocation: path.join(__dirname, '.eslintcache', 'webviews/') },
			}),
		);
	}

	const imageGeneratorConfig = getImageMinimizerConfig(mode, env);

	if (!env.quick && mode !== 'production') {
		// Only need to add the plugin for dev mode, as prod is handled by the minimization
		plugins.push(new ImageMinimizerPlugin({ deleteOriginalAssets: true, generator: [imageGeneratorConfig] }));
	}

	return {
		name: 'webviews:common',
		context: basePath,
		entry: {},
		mode: mode,
		target: 'web',
		output: {
			path: path.join(__dirname, 'dist', 'webviews'),
			publicPath: '#{root}/dist/webviews/',
			// In production, clean media folder (actual webview cleaning is handled in getWebviewConfig)
			// In dev, don't clean (media is preserved between builds for faster rebuilds)
			clean: mode === 'production' ? { keep: asset => !asset.startsWith('media/') } : false,
		},
		optimization: {
			minimizer:
				mode === 'production'
					? [new ImageMinimizerPlugin({ deleteOriginalAssets: true, generator: [imageGeneratorConfig] })]
					: [],
		},
		plugins: plugins,
		infrastructureLogging: mode === 'production' ? undefined : { level: 'log' }, // enables logging required for problem matchers
		stats: stats,
		cache: getCacheConfig('webviews-common', 'webworker', mode),
	};
}

/**
 * @param {GlWebviews} webviews
 * @param {{ alias?: { [key:string]: string }}} overrides
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { WebpackConfig }
 */
function getWebviewConfig(webviews, overrides, mode, env) {
	const basePath = path.join(__dirname, 'src', 'webviews', 'apps');
	const tsConfigPath = path.join(basePath, 'tsconfig.json');

	/** @type WebpackConfig['plugins'] | any */
	const plugins = [
		new DefinePlugin({
			DEBUG: debug || mode === 'development',
			'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
		}),
		new WebpackRequireFromPlugin({ variableName: 'webpackResourceBasePath' }),
		new MiniCssExtractPlugin({ filename: '[name].css' }),
		...Object.entries(webviews).map(([name, config]) => getHtmlPlugin(name, Boolean(config.plus), mode, env)),
		getCspHtmlPlugin(mode, env),
	];

	// Add composer template compilation plugin when building composer webview
	if ('composer' in webviews) {
		plugins.push(new CompileComposerTemplatesPlugin());
	}

	let name = '';
	let filePrefix = '';
	if (Object.keys(webviews).length > 1) {
		name = 'webviews';
		filePrefix = 'webviews';
	} else {
		name = `webviews:${Object.keys(webviews)[0]}`;
		filePrefix = `webviews-${Object.keys(webviews)[0]}`;
	}

	if (env.quick !== 'turbo') {
		plugins.push(
			new ForkTsCheckerPlugin({
				async: useAsyncTypeChecking,
				formatter: 'basic',
				typescript: {
					configFile: tsConfigPath,
					memoryLimit: 4096,
					...(env.trace
						? {
								configOverwrite: {
									compilerOptions: {
										generateTrace: path.join(__dirname, 'dist', 'trace', filePrefix),
									},
								},
							}
						: {}),
				},
			}),
		);
	}

	if (!env.quick) {
		plugins.push(
			new ESLintLitePlugin({
				files: '**/*.ts?(x)',
				exclude: ['**/__tests__/**'],
				worker: eslintWorker,
				eslintOptions: { ...eslintOptions, cacheLocation: path.join(__dirname, '.eslintcache', 'webviews/') },
			}),
		);
	}

	const imageGeneratorConfig = getImageMinimizerConfig(mode, env);

	if (!env.quick && mode !== 'production') {
		// Only need to add the plugin for dev mode, as prod is handled by the minimization
		plugins.push(new ImageMinimizerPlugin({ deleteOriginalAssets: true, generator: [imageGeneratorConfig] }));
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
				reportFilename: path.join(out, `${filePrefix}-bundle-report.html`),
				statsFilename: path.join(out, `${filePrefix}-stats.json`),
			}),
		);
	}

	return {
		name: name,
		context: basePath,
		entry: Object.fromEntries(Object.entries(webviews).map(([n, { entry }]) => [n, entry])),
		mode: mode,
		target: 'web',
		devtool: mode === 'production' && !env.analyzeBundle ? false : 'source-map',
		output: {
			chunkFilename: '[name].js',
			filename: '[name].js',
			libraryTarget: 'module',
			path: path.join(__dirname, 'dist', 'webviews'),
			publicPath: '#{root}/dist/webviews/',
			// If building a subset of webviews, don't clean; otherwise clean everything except media and codicon.ttf
			// These assets are copied by webviews:common which runs in parallel
			clean: env.webviews ? false : { keep: asset => asset.startsWith('media/') || asset === 'codicon.ttf' },
		},
		experiments: { outputModule: true },
		optimization: {
			minimizer:
				mode === 'production'
					? [
							new TerserPlugin({
								minify: TerserPlugin.swcMinify,
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
									format: {
										comments: false,
										ecma: 2020,
									},
									mangle: {
										// Keep the class names otherwise @log won't provide a useful name
										keep_classnames: true,
									},
								},
							}),
							new ImageMinimizerPlugin({ deleteOriginalAssets: true, generator: [imageGeneratorConfig] }),
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
				cacheGroups: { default: false, vendors: false },
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
					use: [
						// React Compiler - must come before esbuild-loader/ts-loader
						{ loader: reactCompilerLoader, options: defineReactCompilerLoaderOption({ target: '19' }) },
						// TypeScript transpilation
						env.esbuild
							? {
									loader: 'esbuild-loader',
									options: {
										format: 'esm',
										implementation: esbuild,
										target: ['es2023', 'chrome124'],
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
					],
				},
				{
					test: /\.scss$/,
					use: [
						{ loader: MiniCssExtractPlugin.loader },
						{
							loader: 'css-loader',
							options: { sourceMap: mode !== 'production' && !env.quick, url: false },
						},
						{ loader: 'sass-loader', options: { sourceMap: mode !== 'production' && !env.quick } },
					],
					exclude: /node_modules/,
				},
			],
		},

		resolve: {
			alias: {
				'@env': path.resolve(__dirname, 'src', 'env', 'browser'),
				react: path.resolve(__dirname, 'node_modules', 'react'),
				'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
				...overrides.alias,
			},
			extensionAlias: { '.js': ['.ts', '.js'], '.jsx': ['.tsx', '.jsx'] },
			fallback: { path: require.resolve('path-browserify') },
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
			modules: [basePath, 'node_modules'],
			conditionNames: ['browser', 'import', 'module', 'default'],
		},
		ignoreWarnings: [
			// Ignore warnings about findDOMNode being removed from React 19
			{ module: /@gitkraken[\\/]gitkraken-components/, message: /export 'findDOMNode'/ },
		],
		plugins: plugins,
		infrastructureLogging: mode === 'production' ? undefined : { level: 'log' }, // enables logging required for problem matchers
		stats: stats,
		cache: getCacheConfig(name, 'webworker', mode),
	};
}

/**
 * @param { GlMode } mode
 * @param {GlEnv} env
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
			hashEnabled: { 'script-src': true, 'style-src': mode === 'production' },
			nonceEnabled: { 'script-src': true, 'style-src': mode === 'production' },
		},
	);
	// Override the nonce creation so we can dynamically generate them at runtime
	// @ts-ignore
	cspPlugin.createNonce = () => '#{cspNonce}';

	return cspPlugin;
}

/**
 * @param { GlMode } mode
 * @param {GlEnv} env
 * @returns { ImageMinimizerPlugin.Generator<any> }
 */
function getImageMinimizerConfig(mode, env) {
	/** @type ImageMinimizerPlugin.Generator<any> */
	// @ts-ignore
	return {
		type: 'asset',
		implementation: ImageMinimizerPlugin.sharpGenerate,
		options: { encodeOptions: { webp: { lossless: true } } },
	};
}

/**
 * @param { string } name
 * @param { boolean } plus
 * @param { GlMode } mode
 * @param {GlEnv} env
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

// class InlineChunkHtmlPlugin {
// 	constructor(htmlPlugin, patterns) {
// 		this.htmlPlugin = htmlPlugin;
// 		this.patterns = patterns;
// 	}

// 	getInlinedTag(publicPath, assets, tag) {
// 		if (
// 			(tag.tagName !== 'script' || !(tag.attributes && tag.attributes.src)) &&
// 			(tag.tagName !== 'link' || !(tag.attributes && tag.attributes.href))
// 		) {
// 			return tag;
// 		}

// 		let chunkName = tag.tagName === 'link' ? tag.attributes.href : tag.attributes.src;
// 		if (publicPath) {
// 			chunkName = chunkName.replace(publicPath, '');
// 		}
// 		if (!this.patterns.some(pattern => chunkName.match(pattern))) {
// 			return tag;
// 		}

// 		const asset = assets[chunkName];
// 		if (asset == null) {
// 			return tag;
// 		}

// 		return { tagName: tag.tagName === 'link' ? 'style' : tag.tagName, innerHTML: asset.source(), closeTag: true };
// 	}

// 	apply(compiler) {
// 		let publicPath = compiler.options.output.publicPath || '';
// 		if (publicPath && !publicPath.endsWith('/')) {
// 			publicPath += '/';
// 		}

// 		compiler.hooks.compilation.tap('InlineChunkHtmlPlugin', compilation => {
// 			const getInlinedTagFn = tag => this.getInlinedTag(publicPath, compilation.assets, tag);
// 			const sortFn = (a, b) => (a.tagName === 'script' ? 1 : -1) - (b.tagName === 'script' ? 1 : -1);
// 			this.htmlPlugin.getHooks(compilation).alterAssetTagGroups.tap('InlineChunkHtmlPlugin', assets => {
// 				assets.headTags = assets.headTags.map(getInlinedTagFn).sort(sortFn);
// 				assets.bodyTags = assets.bodyTags.map(getInlinedTagFn).sort(sortFn);
// 			});
// 		});
// 	}
// }

const schema = {
	type: 'object',
	properties: {
		config: { type: 'object' },
		configPath: { type: 'string' },
		onBefore: { instanceof: 'Function' },
		onComplete: { instanceof: 'Function' },
	},
};

class FileGeneratorPlugin {
	/**
	 * @param {{pluginName: string; pathsToWatch: string[]; command: { name: string; command: string; args: string[] }; strings?: { starting: string; completed: string } }} config
	 */
	constructor(config) {
		this.pluginName = config.pluginName;
		this.pathsToWatch = config.pathsToWatch;
		this.command = config.command;
		this.strings = config.strings ?? { starting: 'Generating', completed: 'Generated' };
		this.lastModified = 0;
	}

	/**
	 * @private
	 * @param {string[]} paths
	 */
	pathsChanged(paths) {
		let changed = false;
		for (const path of paths) {
			try {
				const stats = fs.statSync(path);
				if (stats.mtimeMs > this.lastModified) {
					changed = true;
					break;
				}
			} catch {}
		}

		return changed;
	}

	/**
	 * @param {import("webpack").Compiler} compiler
	 */
	apply(compiler) {
		let pendingGeneration = false;

		// Add dependent paths for watching
		compiler.hooks.thisCompilation.tap(this.pluginName, compilation => {
			this.pathsToWatch.map(path => compilation.fileDependencies.add(path));
		});

		// Run generation when needed
		compiler.hooks.make.tapAsync(this.pluginName, async (compilation, callback) => {
			const logger = compiler.getInfrastructureLogger(this.pluginName);
			try {
				const changed = this.pathsChanged(this.pathsToWatch);
				// Only regenerate if the file has changed since last time
				if (!changed) {
					callback();
					return;
				}

				// Avoid duplicate runs
				if (pendingGeneration) {
					callback();
					return;
				}

				pendingGeneration = true;

				try {
					logger.log(`${this.strings.starting} ${this.command.name}...`);
					const start = Date.now();

					const result = spawnSync(this.command.command, this.command.args, {
						cwd: __dirname,
						encoding: 'utf8',
						shell: true,
					});

					if (result.status === 0) {
						this.lastModified = Date.now();
						logger.log(
							`${this.strings.completed} ${this.command.name} in \x1b[32m${Date.now() - start}ms\x1b[0m`,
						);
					} else {
						logger.error(`[${this.pluginName}] Failed to run ${this.command.name}: ${result.stderr}`);
					}
				} finally {
					pendingGeneration = false;
				}
			} catch (ex) {
				// File doesn't exist or other error
				logger.error(`[${this.pluginName}] Error checking source file: ${ex}`);
			}

			callback();
		});
	}
}

class GenerateCommandTypesPlugin extends FileGeneratorPlugin {
	constructor() {
		super({
			pluginName: 'commandTypes',
			pathsToWatch: [path.join(__dirname, 'contributions.json')],
			command: {
				name: "'src/constants.commands.generated.ts' command types",
				command: pkgMgr,
				args: ['run', 'generate:commandTypes'],
			},
		});
	}
}

class GenerateContributionsPlugin extends FileGeneratorPlugin {
	constructor() {
		super({
			pluginName: 'contributions',
			pathsToWatch: [path.join(__dirname, 'contributions.json')],
			command: {
				name: "'package.json' contributions",
				command: pkgMgr,
				args: ['run', 'generate:contributions'],
			},
		});
	}
}

class ExtractContributionsPlugin extends FileGeneratorPlugin {
	constructor() {
		super({
			pluginName: 'contributions',
			pathsToWatch: [path.join(__dirname, 'package.json')],
			command: {
				name: "contributions from 'package.json'",
				command: pkgMgr,
				args: ['run', 'extract:contributions'],
			},
			strings: {
				starting: 'Extracting',
				completed: 'Extracted',
			},
		});
	}
}

class DocsPlugin extends FileGeneratorPlugin {
	constructor() {
		super({
			pluginName: 'docs',
			pathsToWatch: [path.join(__dirname, 'src', 'constants.telemetry.ts')],
			command: {
				name: 'docs',
				command: pkgMgr,
				args: ['run', 'generate:docs:telemetry'],
			},
		});
	}
}

class LicensesPlugin extends FileGeneratorPlugin {
	constructor() {
		super({
			pluginName: 'licenses',
			pathsToWatch: [path.join(__dirname, 'package.json')],
			command: {
				name: 'licenses',
				command: pkgMgr,
				args: ['run', 'generate:licenses'],
			},
		});
	}
}

class FantasticonPlugin {
	alreadyRun = false;

	/**
	 * @param {{config?: { [key:string]: any }; configPath?: string; onBefore?: Function; onComplete?: Function }} options
	 */
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
			logger.log(`Generating icon font...`);

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

			logger.log(`Generated icon font in \x1b[32m${Date.now() - start}ms\x1b[0m${suffix}`);
		}

		const generateFn = generate.bind(this);
		// @ts-ignore
		compiler.hooks.beforeRun.tapPromise(this.pluginName, generateFn);
		// @ts-ignore
		compiler.hooks.watchRun.tapPromise(this.pluginName, generateFn);
	}
}

/**
 * Webpack plugin that tracks multi-compiler completion and emits a single
 * "starting"/"done" signal when ALL compilers in a cycle have finished.
 *
 * This solves the problem where VS Code's background problem matchers trigger
 * on the first compiler's "compiled successfully" line, causing the task to be
 * considered "ready" before slower compilers have finished.
 *
 * Uses shared static state (all configs run in the same process) and a debounce
 * to handle the rare case where a fast compiler finishes before a slow compiler's
 * watchRun has fired.
 */
class BuildCompletePlugin {
	static _activeCount = 0;
	static _hasErrors = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	static _doneTimer;

	/**
	 * @param {import('webpack').Compiler} compiler
	 */
	apply(compiler) {
		const pluginName = 'BuildCompletePlugin';

		const onStart = () => {
			// Cancel any pending "done" signal — another compiler is starting
			clearTimeout(BuildCompletePlugin._doneTimer);

			if (BuildCompletePlugin._activeCount === 0) {
				BuildCompletePlugin._hasErrors = false;
				process.stdout.write('[build] Compilation starting...\n');
			}
			BuildCompletePlugin._activeCount++;
		};

		compiler.hooks.watchRun.tap(pluginName, onStart);
		compiler.hooks.beforeRun.tap(pluginName, onStart);

		compiler.hooks.done.tap(pluginName, stats => {
			if (stats.hasErrors()) {
				BuildCompletePlugin._hasErrors = true;
			}
			BuildCompletePlugin._activeCount--;

			if (BuildCompletePlugin._activeCount <= 0) {
				// Debounce: wait briefly for any other compilers that haven't
				// fired watchRun yet (handles the fast-compiler race in watch mode)
				clearTimeout(BuildCompletePlugin._doneTimer);
				BuildCompletePlugin._doneTimer = setTimeout(() => {
					if (BuildCompletePlugin._activeCount <= 0) {
						BuildCompletePlugin._activeCount = 0;
						process.stdout.write(
							BuildCompletePlugin._hasErrors
								? '[build] Compiled with problems\n'
								: '[build] Compiled successfully\n',
						);
					}
				}, 100);
			}
		});
	}
}

/**
 * Webpack plugin to run esbuild for unit tests.
 * Uses esbuild for faster test builds while integrating with webpack's build lifecycle.
 */
class EsbuildTestsPlugin {
	/** @type {import('child_process').ChildProcess | undefined} */
	watchProcess;

	/**
	 * @param {import('webpack').Compiler} compiler
	 */
	apply(compiler) {
		const pluginName = 'EsbuildTestsPlugin';
		const scriptPath = path.join(__dirname, 'scripts', 'esbuild.tests.mjs');

		compiler.hooks.beforeRun.tapPromise(pluginName, async () => {
			const logger = compiler.getInfrastructureLogger(pluginName);
			logger.log('Building unit tests with esbuild...');

			const start = Date.now();
			const result = spawnSync(process.execPath, [scriptPath], {
				cwd: __dirname,
				stdio: 'inherit',
			});

			if (result.status !== 0) {
				throw new WebpackError(`esbuild tests failed with exit code ${result.status}`);
			}

			logger.log(`Built unit tests in \x1b[32m${Date.now() - start}ms\x1b[0m`);
		});

		compiler.hooks.watchRun.tapPromise(pluginName, async () => {
			// Only start the watch process once (check exitCode to detect if process died)
			if (this.watchProcess && this.watchProcess.exitCode == null) return;

			const logger = compiler.getInfrastructureLogger(pluginName);
			logger.log('Starting esbuild watch for unit tests...');

			this.watchProcess = spawn(process.execPath, [scriptPath, '--watch'], {
				cwd: __dirname,
				stdio: 'inherit',
			});

			this.watchProcess.on('error', err => {
				logger.error(`esbuild watch error: ${err.message}`);
			});

			this.watchProcess.on('exit', code => {
				if (code != null && code !== 0) {
					logger.error(`esbuild watch exited with code ${code}`);
				}
			});
		});

		compiler.hooks.shutdown.tapPromise(pluginName, async () => {
			if (this.watchProcess && this.watchProcess.exitCode == null) {
				this.watchProcess.kill();
				this.watchProcess = undefined;
			}
		});
	}
}

/**
 * Webpack plugin to precompile Composer custom diff2html Hogan templates.
 * This avoids runtime eval and ensures templates are compiled at build time.
 */
class CompileComposerTemplatesPlugin {
	static name = 'CompileComposerTemplatesPlugin';

	/** @type {Promise<void> | undefined} */
	static _compilationPromise;

	/**
	 * @param {import('webpack').Compiler} compiler
	 */
	apply(compiler) {
		compiler.hooks.beforeCompile.tapPromise(CompileComposerTemplatesPlugin.name, async () => {
			// Deduplicate compilation across parallel builds
			if (!CompileComposerTemplatesPlugin._compilationPromise) {
				CompileComposerTemplatesPlugin._compilationPromise = this._compile();
			}
			return CompileComposerTemplatesPlugin._compilationPromise;
		});
	}

	async _compile() {
		/** @type {typeof import('@profoundlogic/hogan')} */
		let Hogan;
		try {
			// Prefer root-level hogan.js if hoisted
			// @ts-ignore
			Hogan = await import('@profoundlogic/hogan');
		} catch {
			// Fallback: resolve from diff2html's nested dependency to support pnpm non-hoisted layout
			const diff2htmlPkg = require.resolve('diff2html/package.json');
			const hoganPath = require.resolve('hogan.js', {
				paths: [path.join(path.dirname(diff2htmlPkg), 'node_modules')],
			});
			// @ts-ignore
			Hogan = await import(pathToFileURL(hoganPath).href);
		}
		// @ts-ignore
		Hogan = Hogan?.default || Hogan;

		const srcPath = path.join(__dirname, 'src/webviews/apps/plus/composer/components/diff/diff-templates.ts');
		const outPath = path.join(
			__dirname,
			'src/webviews/apps/plus/composer/components/diff/diff-templates.compiled.ts',
		);

		const source = fs.readFileSync(srcPath, 'utf8');

		/**
		 * @param {string} name
		 * @returns {string}
		 */
		function extractTemplate(name) {
			const re = new RegExp(`export const ${name} = \`([\\s\\S]*?)\`;`);
			const m = source.match(re);
			if (!m) throw new Error(`Template ${name} not found in ${srcPath}`);
			return m[1];
		}

		const blockHeader = extractTemplate('blockHeaderTemplate');
		const lineByLineFile = extractTemplate('lineByLineFileTemplate');
		const sideBySideFile = extractTemplate('sideBySideFileTemplate');
		const genericFilePath = extractTemplate('genericFilePathTemplate');

		/**
		 * @param {string} name
		 * @param {string} tpl
		 * @returns {string}
		 */
		function precompile(name, tpl) {
			const code = Hogan.compile(tpl, { asString: true });
			return `  "${name}": new Hogan.Template(${code})`;
		}

		const header = `/* eslint-disable */\n// @ts-nocheck\n// Generated — DO NOT EDIT\nimport type { CompiledTemplates } from 'diff2html/lib-esm/hoganjs-utils.js';\nimport * as Hogan from '@profoundlogic/hogan';\n`;

		const body = `export const compiledComposerTemplates: CompiledTemplates = {\n${precompile(
			'generic-block-header',
			blockHeader,
		)},\n${precompile('line-by-line-file-diff', lineByLineFile)},\n${precompile(
			'side-by-side-file-diff',
			sideBySideFile,
		)},\n${precompile('generic-file-path', genericFilePath)}\n};\n`;

		const newContent = header + body;
		const existingContent = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';

		// Only write if content changed to avoid unnecessary rebuilds
		if (newContent !== existingContent) {
			fs.writeFileSync(outPath, newContent, 'utf8');
			console.log(`[CompileComposerTemplatesPlugin] Wrote ${outPath}`);
		}
	}
}
