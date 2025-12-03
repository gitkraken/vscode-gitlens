/* eslint-disable no-empty-pattern */
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ElectronApplication, Page } from '@playwright/test';
import { _electron, test as base } from '@playwright/test';
import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';
import { GitFixture } from './fixtures/git';
import { GitLensPage } from './pageObjects/gitLensPage';

export { expect } from '@playwright/test';
export { GitFixture } from './fixtures/git';

export const MaxTimeout = 10000;

export interface LaunchOptions {
	vscodeVersion?: string;
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
					`--extensions-dir=${path.join(tempDir, 'extensions')}`,
					`--user-data-dir=${path.join(tempDir, 'user-data')}`,
					workspacePath,
				],
			});

			const page = await electronApp.firstWindow();
			const gitlens = new GitLensPage(page);

			// Wait for GitLens to activate before providing to tests
			await gitlens.waitForActivation();

			await use({ page: page, electronApp: electronApp, gitlens: gitlens } satisfies VSCodeInstance);

			// Cleanup
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
