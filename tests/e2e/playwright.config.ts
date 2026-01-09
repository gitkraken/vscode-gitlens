import { defineConfig } from '@playwright/test';

interface CustomOptions {
	vscodeVersion: string;
}

// eslint-disable-next-line import-x/no-default-export
export default defineConfig<CustomOptions>({
	use: {
		headless: true, // Ensure headless mode is enabled
		viewport: { width: 1920, height: 1080 },
		trace: 'on-first-retry',
		video: 'on-first-retry',
		screenshot: 'only-on-failure',
	},
	reporter: 'list', // process.env.CI ? 'html' : 'list',
	timeout: 60000, // 1 minute
	workers: 1,
	expect: {
		timeout: 60000, // 1 minute
	},
	globalSetup: './setup',
	testDir: './specs',
	outputDir: '../../out/test-results',
	projects: [{ name: 'VSCode stable', use: { vscodeVersion: 'stable' } }],
	testMatch: '*.test.ts',
});
