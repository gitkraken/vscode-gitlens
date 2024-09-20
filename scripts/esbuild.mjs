import * as esbuild from 'esbuild';
import { sassPlugin } from 'esbuild-sass-plugin';
import * as fs from 'fs';
import * as path from 'path';
import { minify } from 'terser';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const args = process.argv.slice(2);

let index = args.indexOf('--mode');
const mode = (index >= 0 ? args[index + 1] : undefined) || 'none';

const watch = args.includes('--watch');
const check = !args.includes('--no-check');

/**
 * @param { 'node' | 'webworker' } target
 * @param { 'production' | 'development' | 'none' } mode
 */
async function buildExtension(target, mode) {
	let plugins = [];

	// let TypeCheckerPlugin;
	// if (check) {
	// 	({ EsbuildPlugin: TypeCheckerPlugin } = require('vite-esbuild-typescript-checker'));
	// 	plugins.push(
	// 		TypeCheckerPlugin({
	// 			checker: {
	// 				async: false,
	// 				eslint: {
	// 					enabled: true,
	// 					files: 'src/**/*.ts',
	// 					options: {
	// 						// cache: true,
	// 						cacheLocation: path.join(
	// 							__dirname,
	// 							target === 'webworker' ? '.eslintcache.browser' : '.eslintcache',
	// 						),
	// 						overrideConfigFile: path.join(
	// 							__dirname,
	// 							target === 'webworker' ? '.eslintrc.browser.json' : '.eslintrc.json',
	// 						),
	// 					},
	// 				},
	// 				formatter: 'basic',
	// 				typescript: {
	// 					configFile: target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
	// 				},
	// 			},
	// 		}),
	// 	);
	// }

	const alias = {
		'@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : target),
		// Stupid dependency that is used by `http[s]-proxy-agent`
		debug: path.resolve(__dirname, 'patches', 'debug.js'),
		// This dependency is very large, and isn't needed for our use-case
		tr46: path.resolve(__dirname, 'patches', 'tr46.js'),
		// This dependency is unnecessary for our use-case
		'whatwg-url': path.resolve(__dirname, 'patches', 'whatwg-url.js'),
	};

	if (target === 'webworker') {
		alias.path = 'path-browserify';
		alias.os = 'os-browserify/browser';
	}

	const out = target === 'webworker' ? 'dist/browser' : 'dist';

	const result = await esbuild.build({
		bundle: true,
		entryPoints: ['src/extension.ts'],
		entryNames: '[dir]/gitlens',
		alias: alias,
		drop: ['debugger'],
		external: ['vscode'],
		format: 'esm',
		keepNames: true,
		legalComments: 'none',
		logLevel: 'info',
		mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
		metafile: true,
		minify: mode === 'production',
		outdir: out,
		platform: target === 'webworker' ? 'browser' : target,
		sourcemap: mode !== 'production',
		// splitting: target !== 'webworker',
		// chunkNames: 'feature-[name]-[hash]',
		target: ['es2022', 'chrome102', 'node16.14.2'],
		treeShaking: true,
		tsconfig: target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
		// watch: watch,
		plugins: plugins,
	});

	if (!fs.existsSync(path.join('dist', 'meta'))) {
		fs.mkdirSync(path.join('dist', 'meta'));
	}
	fs.writeFileSync(
		path.join('dist', 'meta', `gitlens${target === 'webworker' ? '.browser' : ''}.json`),
		JSON.stringify(result.metafile),
	);

	if (mode === 'production') {
		const file = path.join(out, 'gitlens.js');
		console.log(`Minifying ${file}...`);

		const code = fs.readFileSync(file, 'utf8');
		const result = await minify(code, {
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
		});

		fs.writeFileSync(file, result.code);
	}
}

/**
 * @param { 'production' | 'development' | 'none' } mode
 */
async function buildGraphWebview(mode) {
	let plugins = [sassPlugin()];

	const out = 'dist/webviews';

	const result = await esbuild.build({
		bundle: true,
		entryPoints: ['src/webviews/apps/plus/graph/graph.tsx'],
		entryNames: '[dir]/graph',
		alias: {
			'@env': path.resolve(__dirname, 'src', 'env', 'browser'),
			tslib: path.resolve(__dirname, 'node_modules/tslib/tslib.es6.js'),
			'@microsoft/fast-foundation': path.resolve(
				__dirname,
				'node_modules/@microsoft/fast-foundation/dist/esm/index.js',
			),
			'@microsoft/fast-react-wrapper': path.resolve(
				__dirname,
				'node_modules/@microsoft/fast-react-wrapper/dist/esm/index.js',
			),
		},
		drop: ['debugger'],
		external: ['vscode'],
		format: 'esm',
		legalComments: 'none',
		logLevel: 'info',
		mainFields: ['browser', 'module', 'main'],
		metafile: true,
		minify: mode === 'production' ? true : false,
		outdir: out,
		platform: 'browser',
		sourcemap: true,
		target: ['es2022', 'chrome102'],
		treeShaking: true,
		tsconfig: 'src/webviews/apps/tsconfig.json',
		// watch: watch,
		plugins: plugins,
	});

	fs.writeFileSync(path.join('dist', 'meta', 'graph.json'), JSON.stringify(result.metafile));

	if (mode === 'production') {
		const file = path.join(out, 'graph.js');
		console.log(`Minifying ${file}...`);

		const code = fs.readFileSync(file, 'utf8');
		const result = await minify(code, {
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
			module: true,
		});

		fs.writeFileSync(file, result.code);
	}
}

try {
	await Promise.allSettled([
		buildExtension('node', mode),
		buildExtension('webworker', mode),
		buildGraphWebview(mode),
	]);
} catch (ex) {
	console.error(ex);
	process.exit(1);
}
