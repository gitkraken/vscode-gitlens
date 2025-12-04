/* eslint-disable no-empty-pattern */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron, test as base } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
import { GitFixture } from './fixtures/git';
import { VSCodeEvaluator } from './fixtures/vscodeEvaluator';
import { GitLensPage } from './pageObjects/gitLensPage';

export { expect } from '@playwright/test';
export { GitFixture } from './fixtures/git';
export type { VSCode } from './fixtures/vscodeEvaluator';

export const MaxTimeout = 10000;

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
	page: Page;
	electronApp: ElectronApplication;
	gitlens: GitLensPage;
	/**
	 * Evaluate a function in the VS Code Extension Host context.
	 * The function receives the `vscode` module as its first argument.
	 *
	 * @example
	 * ```ts
	 * await vscode.evaluate(vscode => {
	 *   vscode.commands.executeCommand('gitlens.showCommitGraph');
	 * });
	 *
	 * const version = await vscode.evaluate(vscode => vscode.version);
	 * ```
	 */
	evaluate: VSCodeEvaluator['evaluate'];
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
	// eslint-disable-next-line no-restricted-globals
	vscodeOptions: [{ vscodeVersion: process.env.VSCODE_VERSION ?? 'stable' }, { scope: 'worker', option: true }],

	// vscode launches VS Code with GitLens extension (shared per worker)
	vscode: [
		async ({ vscodeOptions }, use) => {
			const tempDir = await createTmpDir();
			const vscodePath = await downloadAndUnzipVSCode(vscodeOptions.vscodeVersion ?? 'stable');
			const extensionPath = path.join(__dirname, '..', '..');
			const runnerPath = path.join(__dirname, 'runner', 'dist');
			const userDataDir = path.join(tempDir, 'user-data');

			// Write user settings before launching VS Code
			const settingsDir = path.join(userDataDir, 'User');
			await fs.promises.mkdir(settingsDir, { recursive: true });
			const mergedSettings = { ...defaultUserSettings, ...vscodeOptions.userSettings };
			await fs.promises.writeFile(
				path.join(settingsDir, 'settings.json'),
				JSON.stringify(mergedSettings, null, '\t'),
			);

			// Run setup callback if provided, otherwise open extension folder
			const workspacePath = vscodeOptions.setup ? await vscodeOptions.setup() : extensionPath;

			const electronApp = await _electron.launch({
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
			});

			// Connect to the VS Code test server using Playwright's internal API
			const evaluator = await VSCodeEvaluator.connect(electronApp);
			const evaluate = evaluator.evaluate.bind(evaluator);

			const page = await electronApp.firstWindow();
			const gitlens = new GitLensPage(page, evaluate);

			// Wait for GitLens to activate before providing to tests
			await gitlens.waitForActivation();

			await use({
				page: page,
				electronApp: electronApp,
				gitlens: gitlens,
				evaluate: evaluate,
			} satisfies VSCodeInstance);

			// Cleanup
			evaluator.close();
			await electronApp.close();
			await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
			await fs.promises.rm(repo.repoDir, { recursive: true, force: true }).catch(() => {});
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
			await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
		}
	},
});

export async function createTmpDir(): Promise<string> {
	return fs.promises.realpath(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gltest-')));
}
