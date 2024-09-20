/** @typedef {import('esbuild').BuildOptions} BuildOptions **/
/** @typedef {import('esbuild').WatchOptions} WatchOptions **/

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { nodeExternalsPlugin } from 'esbuild-node-externals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const args = process.argv.slice(2);

let index = args.indexOf('--mode');
const mode = (index >= 0 ? args[index + 1] : undefined) || 'none';

const watch = args.includes('--watch');

/**
 * @param { 'node' | 'webworker' } target
 * @param { 'production' | 'development' | 'none' } mode
 */
async function buildTests(target, mode) {
	/** @type BuildOptions | WatchOptions */
	const config = {
		bundle: true,
		entryPoints: ['src/test/suite/index.ts', 'src/**/*.test.ts'],
		entryNames: '[name]',
		drop: ['debugger'],
		external: ['vscode'],
		format: 'cjs',
		logLevel: 'info',
		mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
		metafile: false,
		minify: mode === 'production',
		outdir: target === 'webworker' ? 'out/tests/browser' : 'out/tests',
		platform: target === 'webworker' ? 'browser' : target,
		plugins: [nodeExternalsPlugin()],
		sourcemap: mode !== 'production',
		target: ['es2022', 'chrome102', 'node16.14.2'],
		treeShaking: true,
		tsconfig: target === 'webworker' ? 'tsconfig.test.browser.json' : 'tsconfig.test.json',
	};

	config.alias = {
		'@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : target),
		// Stupid dependency that is used by `http[s]-proxy-agent`
		debug: path.resolve(__dirname, 'patches', 'debug.js'),
		// This dependency is very large, and isn't needed for our use-case
		tr46: path.resolve(__dirname, 'patches', 'tr46.js'),
		// This dependency is unnecessary for our use-case
		'whatwg-url': path.resolve(__dirname, 'patches', 'whatwg-url.js'),
	};

	if (target === 'webworker') {
		config.alias.path = 'path-browserify';
		config.alias.os = 'os-browserify/browser';
	}

	if (watch) {
		const ctx = await esbuild.context(config);
		await ctx.watch();
	} else {
		await esbuild.build(config);
	}
}

try {
	await Promise.allSettled([buildTests('node', mode)]);
} catch (ex) {
	console.error(ex);
	process.exit(1);
}
