import * as process from 'node:process';
import { defineConfig } from '@playwright/test';
import { editors } from './editors.js';

interface CustomOptions {
	editorId: string;
	editorExecutablePath: string;
}

// oxlint-disable-next-line import/no-default-export
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
	retries: process.env.CI ? 2 : 0,
	fullyParallel: true,
	workers: process.env.CI ? 4 : 8,
	expect: {
		timeout: 60000, // 1 minute
	},
	globalSetup: './setup',
	testDir: './specs',
	outputDir: '../../out/test-results',
	// One project per editor (see editors.ts). VS Code is always registered; a fork is registered only
	// when its binary path env var is set, so a plain `pnpm test:e2e` (no --project) runs just VS Code
	// instead of trying to launch forks that aren't provisioned locally.
	projects: editors
		.filter(e => e.id === 'vscode' || process.env[e.envVar])
		.map(e => ({
			name: e.id,
			use: {
				editorId: e.id,
				editorExecutablePath: e.envVar ? (process.env[e.envVar] ?? '') : '',
			},
			// Forks opt out of editor-incompatible specs via the `@no-fork` tag (see docs/testing.md).
			grepInvert: e.id === 'vscode' ? undefined : /@no-fork/,
			// All CI projects inherit the top-level retry budget. Login-walled forks (Cursor), whose
			// deterministic sign-in-wall failures shouldn't be retried, are excluded from the CI matrix
			// entirely via editors.ts `runInCI: false`, so no per-project retry override is needed here —
			// and the experimental forks that DO run (Kiro/Positron) need the retries to recover from the
			// transient render/launch contention flakes that a 4-worker CI runner induces.
		})),
	testMatch: '*.test.ts',
});
