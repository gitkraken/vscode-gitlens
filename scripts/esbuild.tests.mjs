/** @typedef {import('esbuild').BuildOptions} BuildOptions **/
/** @typedef {import('esbuild').WatchOptions} WatchOptions **/

import * as esbuild from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { nodeExternalsPlugin } from 'esbuild-node-externals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const args = process.argv.slice(2);
const watch = args.includes('--watch');

/**
 * @param { 'node' | 'webworker' } target
 */
async function buildTests(target) {
	/** @type BuildOptions | WatchOptions */
	const config = {
		bundle: true,
		entryPoints: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.benchmark.ts'],
		entryNames: '[dir]/[name]',
		external: ['vscode'],
		format: 'cjs',
		logLevel: 'info',
		logOverride: {
			'duplicate-case': 'silent',
		},
		mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
		metafile: false,
		minify: false,
		outdir: target === 'webworker' ? 'out/tests/browser' : 'out/tests',
		platform: target === 'webworker' ? 'browser' : target,
		plugins: [nodeExternalsPlugin()],
		sourcemap: true,
		target: ['es2023', 'chrome124', 'node20.14.0'],
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
	await Promise.allSettled([buildTests('node')]);
} catch (ex) {
	console.error(ex);
	process.exit(1);
}
