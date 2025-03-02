import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'Unit Tests',
		files: 'out/tests/**/*.test.js',
		version: 'insiders',
		mocha: {
			ui: 'tdd',
			timeout: 20000,
		},
	},
]);
