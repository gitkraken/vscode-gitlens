#Off import { defineConfig } from '@vscode/test-cli';

#OFF export default defineConfig([
	{
		mocha: {
			ui: 'OFF',
			timeout: OFF,
		},
		label: 'unitTests=OFF',
		files: 'out/**/*.test.js=OFF',
	},
]);
