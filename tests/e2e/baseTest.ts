/* eslint-disable no-empty-pattern */
import type { ChildProcess } from 'node:child_process';
import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as process from 'node:process';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron, test as base } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
import { GitFixture } from './fixtures/git.js';
import { VSCodeEvaluator } from './fixtures/vscodeEvaluator.js';
import { GitLensPage } from './pageObjects/gitLensPage.js';

export { expect } from '@playwright/test';
export { GitFixture } from './fixtures/git.js';
export type { VSCode } from './fixtures/vscodeEvaluator.js';

export const MaxTimeout = 10000;
export const DefaultTimeout = 2000;
export const ShortTimeout = 500;

/** Xvfb display number used for headless Linux testing */
// eslint-disable-next-line @typescript-eslint/naming-convention
const XVFB_DISPLAY = ':99';

/** Xvfb process reference for cleanup */
let xvfbProcess: ChildProcess | undefined;

/**
 * Ensures Xvfb is running for headless Linux environments (WSL/SSH).
 * Returns the DISPLAY value to use, or undefined if not needed.
 */
function ensureXvfb(): string | undefined {
	// Only needed on Linux without a display
	if (process.platform !== 'linux' || process.env.DISPLAY) {
		return process.env.DISPLAY;
	}

	try {
		// Check if Xvfb is available
		execSync('which Xvfb', { stdio: 'ignore' });

		// Check if Xvfb is already running on our display
		try {
			execSync(`xdpyinfo -display ${XVFB_DISPLAY}`, { stdio: 'ignore' });
			// Already running
			return XVFB_DISPLAY;
		} catch {
			// Not running, start it
		}

		// Start Xvfb
		xvfbProcess = spawn('Xvfb', [XVFB_DISPLAY, '-screen', '0', '1920x1080x24'], {
			detached: true,
			stdio: 'ignore',
		});
		xvfbProcess.unref();

		// Give Xvfb time to start
		execSync('sleep 0.5');

		return XVFB_DISPLAY;
	} catch {
		// Xvfb not available
		return undefined;
	}
}

/** Ensures the E2E runner is built before tests run */
function ensureRunnerBuilt(): void {
	const runnerDist = path.join(__dirname, 'runner', 'dist', 'index.js');
	if (!existsSync(runnerDist)) {
		const rootDir = path.resolve(__dirname, '../..');
		execSync('pnpm run build:e2e-runner', { cwd: rootDir, stdio: 'inherit' });
	}
}

/** Default VS Code settings applied to all E2E tests */
const defaultUserSettings: Record<string, unknown> = {
	// Disable telemetry
	'telemetry.telemetryLevel': 'off',
	// Disable distracting UI elements
	'workbench.tips.enabled': false,
	'workbench.startupEditor': 'none',
	'workbench.enableExperiments': false,
	'workbench.welcomePage.walkthroughs.openOnInstall': false,
	// Disable extension recommendations
	'extensions.ignoreRecommendations': true,
	'extensions.autoUpdate': false,
	// Disable update checks
	'update.mode': 'none',
	// Use custom dialogs for consistent behavior
	'files.simpleDialog.enable': true,
	'window.dialogStyle': 'custom',

	'gitlens.outputLevel': 'debug',
	'gitlens.telemetry.enabled': false,

	// Associate git-rebase-todo files with GitLens rebase editor
	// TODO: is this needed?
	'workbench.editorAssociations': {
		'git-rebase-todo': 'gitlens.rebase',
	},
};

export interface LaunchOptions {
	vscodeVersion?: string;
	/**
	 * User settings to apply to VS Code.
	 * These are merged with (and override) the default test settings.
	 */
	userSettings?: Record<string, unknown>;
	/**
	 * Optional async setup callback that runs before VS Code launches.
	 * Use this to create a test repo, files, or any other setup needed.
	 * Returns the path to open in VS Code.
	 * If not provided, opens the extension folder.
	 */
	setup?: () => Promise<string>;
}

export interface VSCodeInstance {
	electron: {
		app: ElectronApplication;
		/** Path to the VS Code executable for this test instance */
		executablePath: string;
		/** Launch arguments used for this VS Code instance (for reuse in sequence editor, etc.) */
		args: string[];
		/** Path to the workspace opened in VS Code */
		workspacePath: string;
	};
	gitlens: GitLensPage;
	page: Page;
}

/** Base fixtures for all E2E tests */
interface BaseFixtures {
	createTempFolder: () => Promise<string>;
	/**
	 * Creates and initializes a new Git repository in a temporary directory.
	 * The repository is automatically cleaned up after the test.
	 * Returns a GitFixture instance for interacting with the repository.
	 */
	createGitRepo: () => Promise<GitFixture>;
}

interface WorkerFixtures {
	vscode: VSCodeInstance;
	vscodeOptions: LaunchOptions;
}

export const test = base.extend<BaseFixtures, WorkerFixtures>({
	// Default options (can be overridden per-file)
	vscodeOptions: [{ vscodeVersion: process.env.VSCODE_VERSION ?? 'stable' }, { scope: 'worker', option: true }],

	// vscode launches VS Code with GitLens extension (shared per worker)
	vscode: [
		async ({ vscodeOptions }, use) => {
			// Ensure the E2E runner is built (handles VS Code extension skipping globalSetup)
			ensureRunnerBuilt();

			const tempDir = await createTmpDir();
			const vscodePath = await downloadAndUnzipVSCode(vscodeOptions.vscodeVersion ?? 'stable');
			const extensionPath = path.join(__dirname, '..', '..');
			const runnerPath = path.join(__dirname, 'runner', 'dist');
			const userDataDir = path.join(tempDir, 'user-data');

			// Write user settings before launching VS Code
			const settingsDir = path.join(userDataDir, 'User');
			await mkdir(settingsDir, { recursive: true });
			const mergedSettings = { ...defaultUserSettings, ...vscodeOptions.userSettings };
			await writeFile(path.join(settingsDir, 'settings.json'), JSON.stringify(mergedSettings, null, '\t'));

			// Run setup callback if provided, otherwise open extension folder
			const workspacePath = vscodeOptions.setup ? await vscodeOptions.setup() : extensionPath;

			const options: { executablePath: string; args: string[] } = {
				executablePath: vscodePath,
				args: [
					'--no-sandbox',
					'--disable-gpu-sandbox',
					'--disable-updates',
					'--skip-welcome',
					'--skip-release-notes',
					'--disable-workspace-trust',
					`--extensionDevelopmentPath=${extensionPath}`,
					`--extensionTestsPath=${runnerPath}`,
					`--extensions-dir=${path.join(tempDir, 'extensions')}`,
					`--user-data-dir=${userDataDir}`,
					workspacePath,
				],
			} satisfies Parameters<typeof _electron.launch>[0];

			// Ensure Xvfb is running for headless Linux environments
			const display = ensureXvfb();

			const electronApp = await _electron.launch({
				...options,
				env: {
					...process.env,
					// Allows Claude Code and other CLI agents run the tests from within VS Code
					ELECTRON_RUN_AS_NODE: undefined!,
					// Set DISPLAY for headless Linux (Xvfb)
					...(display ? { DISPLAY: display } : {}),
				},
			});

			// Connect to the VS Code test server using Playwright's internal API
			const evaluator = await VSCodeEvaluator.connect(electronApp);
			const evaluate = evaluator.evaluate.bind(evaluator);

			const page = await electronApp.firstWindow();
			const gitlens = new GitLensPage(page, evaluate);

			// Wait for GitLens to activate before providing to tests
			await gitlens.waitForActivation();

			await use({
				electron: { app: electronApp, ...options, workspacePath: workspacePath },
				gitlens: gitlens,
				page: page,
			} satisfies VSCodeInstance);

			// Cleanup
			evaluator.close();
			await electronApp.close();
			await rm(tempDir, { recursive: true, force: true }).catch(() => {});
		},
		{ scope: 'worker' },
	],

	createGitRepo: async ({}, use) => {
		const repos: GitFixture[] = [];
		await use(async () => {
			const dir = await createTmpDir();
			const git = new GitFixture(dir);
			await git.init();
			repos.push(git);
			return git;
		});
		// Cleanup after test
		for (const repo of repos) {
			await rm(repo.repoPath, { recursive: true, force: true }).catch(() => {});
		}
	},

	createTempFolder: async ({}, use) => {
		const dirs: string[] = [];
		await use(async () => {
			const dir = await createTmpDir();
			dirs.push(dir);
			return dir;
		});
		// Cleanup after test
		for (const dir of dirs) {
			await rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	},
});

export async function createTmpDir(): Promise<string> {
	return realpath(await mkdtemp(path.join(os.tmpdir(), 'gltest-e2e-')));
}
