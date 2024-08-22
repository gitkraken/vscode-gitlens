import { defineConfig } from '@playwright/test';
import { TestOptions } from './tests/baseTest';

export default defineConfig({
	use: {
		headless: true, // Ensure headless mode is enabled
		viewport: { width: 1920, height: 1080 },
	},
	reporter: 'list', // process.env.CI ? 'html' : 'list',
	timeout: 30000,
	workers: 1,
	expect: {
		timeout: 30000,
	},
	globalSetup: './setup',
	projects: [
		{
			name: 'VSCode stable',
			use: {
				vscodeVersion: 'stable',
			},
		},
	],
});
