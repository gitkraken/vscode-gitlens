const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
	{
		mocha: {
			ui: 'bdd',
			timeout: 20000,
		},
		label: 'unitTests',
		files: 'out/test/suite/**/*.test.js',
	},
]);
