/** @typedef {import('esbuild').BuildOptions} BuildOptions **/
/** @typedef {import('esbuild').WatchOptions} WatchOptions **/

import { rm } from 'node:fs/promises';
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
		define: {
			DEBUG: 'false',
		},
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
		// Bundle the `@gitlens/*` workspace packages from source (via the aliases below) rather than
		// externalizing them. Their published `dist/` is ESM that statically named-imports the CJS
		// `@gitkraken/provider-apis` (getter-based exports) — which Node's ESM loader can't resolve,
		// so loading the dist in the test host throws "does not provide an export named ...". Bundling
		// from source lets esbuild resolve the CJS interop, matching the package's own test runner.
		plugins: [nodeExternalsPlugin({ allowList: [/^@gitlens\//] })],
		sourcemap: true,
		target: ['es2023', 'chrome124', 'node20.14.0'],
		tsconfig: target === 'webworker' ? 'tsconfig.test.browser.json' : 'tsconfig.test.json',
	};

	config.alias = {
		'@env': path.resolve(__dirname, 'src', 'env', target === 'webworker' ? 'browser' : 'node'),
		'@gitlens/utils': path.resolve(__dirname, 'packages', 'utils', 'src'),
		'@gitlens/ipc': path.resolve(__dirname, 'packages', 'ipc', 'src'),
		'@gitlens/git': path.resolve(__dirname, 'packages', 'git', 'src'),
		'@gitlens/git-cli': path.resolve(__dirname, 'packages', 'git-cli', 'src'),
		'@gitlens/git-github': path.resolve(__dirname, 'packages', 'plus', 'git-github', 'src'),
		'@gitlens/integrations': path.resolve(__dirname, 'packages', 'plus', 'integrations', 'src'),
		'@gitlens/ai': path.resolve(__dirname, 'packages', 'plus', 'ai', 'src'),
		'@gitlens/agents': path.resolve(__dirname, 'packages', 'plus', 'agents', 'src'),

		// Stupid dependency that is used by `http[s]-proxy-agent` (via @gitkraken/provider-apis)
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

	// Clear stale bundles first: esbuild doesn't prune outputs, so tests that were renamed,
	// deleted, or moved out of `src` (e.g. into a workspace package) would otherwise linger in
	// `out/tests` and get picked up by the vscode-test runner.
	await rm(path.join(__dirname, config.outdir), { recursive: true, force: true });

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
