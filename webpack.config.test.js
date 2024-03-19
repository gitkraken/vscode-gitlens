//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

const { spawnSync } = require('child_process');
var fs = require('fs');
var glob = require('glob');
const path = require('path');
const { CleanWebpackPlugin: CleanPlugin } = require('clean-webpack-plugin');
const esbuild = require('esbuild');
const ForkTsCheckerPlugin = require('fork-ts-checker-webpack-plugin');
const JSON5 = require('json5');
const nodeExternals = require('webpack-node-externals');

module.exports =
	/**
	 * @param {{ esbuild?: boolean } | undefined } env
	 * @param {{ mode: 'production' | 'development' | 'none' | undefined }} argv
	 * @returns { WebpackConfig[] }
	 */
	function (env, argv) {
		const mode = argv.mode || 'development';

		env = {
			esbuild: true,
			...env,
		};

		return [getExtensionConfig('node', mode, env) /*, getExtensionConfig('webworker', mode, env)*/];
	};

/**
 * @param { 'node' | 'webworker' } target
 * @param { 'production' | 'development' | 'none' } mode
 * @param {{ analyzeBundle?: boolean; analyzeDeps?: boolean; esbuild?: boolean } | undefined } env
 * @returns { WebpackConfig }
 */
function getExtensionConfig(target, mode, env) {
	/**
	 * @type WebpackConfig['plugins'] | any
	 */
	const plugins = [
		new CleanPlugin({ cleanOnceBeforeBuildPatterns: ['out/**'] }),
		new ForkTsCheckerPlugin({
			async: false,
			// eslint: {
			// 	enabled: true,
			// 	files: 'src/**/*.ts',
			// 	options: {
			// 		// cache: true,
			// 		cacheLocation: path.join(
			// 			__dirname,
			// 			target === 'webworker' ? '.eslintcache.browser' : '.eslintcache',
			// 		),
			// 		overrideConfigFile: path.join(
			// 			__dirname,
			// 			target === 'webworker' ? '.eslintrc.browser.json' : '.eslintrc.json',
			// 		),
			// 	},
			// },
			formatter: 'basic',
			typescript: {
				configFile: path.join(
					__dirname,
					target === 'webworker' ? 'tsconfig.test.browser.json' : 'tsconfig.test.json',
				),
			},
		}),
	];

	return {
		name: `tests:${target}`,
		entry: {
			runTest: './src/test/runTest.ts',
			'suite/index': './src/test/suite/index.ts',
			...glob.sync('./src/test/suite/**/*.test.ts').reduce(function (obj, e) {
				obj['suite/' + path.parse(e).name] = e;
				return obj;
			}, {}),
		},
		mode: mode,
		target: target,
		devtool: 'source-map',
		output: {
			path:
				target === 'webworker'
					? path.join(__dirname, 'out', 'test', 'browser')
					: path.join(__dirname, 'out', 'test'),
			filename: '[name].js',
			sourceMapFilename: '[name].js.map',
			libraryTarget: 'commonjs2',
		},
		externals: [{ vscode: 'commonjs vscode' }, nodeExternals()],
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
											target === 'webworker'
												? 'tsconfig.test.browser.json'
												: 'tsconfig.test.json',
										),
									),
								},
						  }
						: {
								loader: 'ts-loader',
								options: {
									configFile: path.join(
										__dirname,
										target === 'webworker' ? 'tsconfig.test.browser.json' : 'tsconfig.test.json',
									),
									experimentalWatchApi: true,
									transpileOnly: true,
								},
						  },
				},
			],
		},
		resolve: {
			alias: { '@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : target) },
			fallback: target === 'webworker' ? { path: require.resolve('path-browserify') } : undefined,
			mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
			extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
		},
		plugins: plugins,
		infrastructureLogging: {
			level: 'log', // enables logging required for problem matchers
		},
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
 * @param { string } configFile
 * @returns { string }
 */
function resolveTSConfig(configFile) {
	const result = spawnSync('pnpm', ['tsc', `-p ${configFile}`, '--showConfig'], {
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
