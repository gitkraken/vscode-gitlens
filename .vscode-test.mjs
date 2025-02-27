import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		label: 'UnitTests',
		files: 'out/tests/**/*.test.js',
		version: 'insiders',
		mocha: {
			ui: 'bdd',
			timeout: 20000,
		},
	},
]);
