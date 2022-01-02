const esbuild = require('esbuild');
const path = require('path');

const args = process.argv.slice(2);

let index = args.indexOf('--mode');
const mode = (index >= 0 ? args[index + 1] : undefined) || 'none';

index = args.indexOf('--target');
const target = (index >= 0 ? args[index + 1] : undefined) || 'node';

const watch = args.includes('--watch');
const check = !args.includes('--no-check');

let plugins = [];

let TypeCheckerPlugin;
if (check) {
	({ EsbuildPlugin: TypeCheckerPlugin } = require('vite-esbuild-typescript-checker'));
	plugins.push(
		TypeCheckerPlugin({
			checker: {
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
					configFile: target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
				},
			},
		}),
	);
}

esbuild
	.build({
		bundle: true,
		entryPoints: ['src/extension.ts'],
		entryNames: '[dir]/gitlens',
		external:
			target === 'webworker'
				? ['vscode', 'child_process', 'crypto', 'fs', 'stream', 'os', 'src/env/node/*']
				: ['vscode', 'src/env/browser/*'],
		format: 'cjs',
		keepNames: true,
		logLevel: 'info',
		mainFields: target === 'webworker' ? ['browser', 'module', 'main'] : ['module', 'main'],
		minify: mode === 'production' ? true : false,
		outdir: target === 'webworker' ? 'dist/browser' : 'dist',
		// outfile: 'dist/gitlens.js',
		platform: target === 'webworker' ? 'browser' : target,
		sourcemap: true,
		// splitting: true,
		target: ['es2020', 'chrome91', 'node14.16'],
		treeShaking: true,
		tsconfig: target === 'webworker' ? 'tsconfig.browser.json' : 'tsconfig.json',
		watch: watch,
		plugins: plugins,
	})
	.catch(() => process.exit(1));
