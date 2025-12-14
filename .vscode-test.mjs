import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'Unit Tests',
		files: 'out/tests/**/*.test.js',
		version: 'stable',
		launchArgs: ['--disable-extensions'],
		mocha: {
			ui: 'tdd',
			timeout: 20000,
			color: true,
		},
	},
]);
