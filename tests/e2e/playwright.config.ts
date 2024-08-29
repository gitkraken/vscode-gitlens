import { defineConfig } from '@playwright/test';
import { TestOptions } from './tests/baseTest';

export default defineConfig({
	use: {
		headless: true, // Ensure headless mode is enabled
		viewport: { width: 1920, height: 1080 },
	},
	reporter: 'list', // process.env.CI ? 'html' : 'list',
	timeout: 60000, // 1 minute
	workers: 1,
	expect: {
		timeout: 60000, // 1 minute
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
