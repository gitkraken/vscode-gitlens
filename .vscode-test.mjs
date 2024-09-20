import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		mocha: {
			ui: 'bdd',
			timeout: 20000,
		},
		label: 'unitTests',
		files: 'out/**/*.test.js',
	},
]);
