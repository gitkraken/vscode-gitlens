/* oxlint-disable no-empty-pattern */
import type { ChildProcess } from 'node:child_process';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

/** GitLens extension identifier (publisher.name) */
const gitlensExtensionId = 'eamodio.gitlens';

/**
 * Waits for the GitLens extension host to activate, polling `extensions.getExtension().isActive`.
 * This is editor-agnostic (works on VS Code and forks like Cursor) since it doesn't depend on any
 * workbench UI chrome, unlike the activity-bar-based {@link GitLensPage.waitForActivation}.
 */
async function waitForGitLensActivation(evaluate: VSCodeEvaluator['evaluate'], timeout = 30000): Promise<void> {
	const start = Date.now();
	let lastError: unknown;
	while (Date.now() - start < timeout) {
		try {
			const active = await evaluate(
				(vscode, id) => vscode.extensions.getExtension(id)?.isActive === true,
				gitlensExtensionId,
			);
			if (active) return;
		} catch (ex) {
			// Extension host / test server may not be ready yet; keep polling
			lastError = ex;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
	throw new Error(
		`GitLens did not activate within ${timeout}ms${lastError ? `: ${(lastError as Error).message}` : ''}`,
	);
}

/**
 * Dismisses editor-specific onboarding overlays that intercept pointer events on the workbench.
 * Kiro renders a `<kiro-sign-in-page>` shadow-DOM overlay on first launch that sits above the
 * workbench and swallows clicks (the extension host still runs beneath it); clicking its "Skip All"
 * button removes it. Best-effort and a no-op on editors without such an overlay (e.g. VS Code).
 */
async function dismissOnboardingOverlays(page: Page): Promise<void> {
	// The overlay can appear a beat after activation, so poll briefly.
	for (let attempt = 0; attempt < 20; attempt++) {
		const result = await page
			.evaluate(() => {
				const host = document.querySelector('kiro-sign-in-page');
				if (host == null) return 'absent';

				const roots: (Element | ShadowRoot)[] = [host.shadowRoot ?? host];
				while (roots.length) {
					const root = roots.pop()!;
					for (const el of Array.from(root.querySelectorAll('*'))) {
						if (
							(el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') &&
							/^skip all$/i.test((el.textContent ?? '').trim())
						) {
							(el as HTMLElement).click();
							return 'dismissed';
						}
						if (el.shadowRoot != null) roots.push(el.shadowRoot);
					}
				}
				return 'pending';
			})
			.catch(() => 'absent' as const);

		if (result === 'absent') return;
		if (result === 'dismissed') {
			await page
				.locator('kiro-sign-in-page')
				.waitFor({ state: 'detached', timeout: 5000 })
				.catch(() => {});
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 250));
	}
}

/** Xvfb display number used for headless Linux testing */
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

/**
 * Patches the test VS Code's product.json to disable the win32VersionedUpdate mutex check.
 *
 * On Windows, VS Code checks for a `vscode-updating` mutex created by the InnoSetup installer.
 * If the system VS Code is being updated (installer waiting for VS Code to restart), this mutex
 * is active and causes the test VS Code instance to exit immediately with:
 *   "Code is currently being updated. Please wait for the update to complete before launching."
 *
 * Setting `win32VersionedUpdate: false` bypasses this check for the isolated test instance.
 */
function patchTestVSCodeProductJson(vscodePath: string): void {
	if (process.platform !== 'win32') return;

	const vscodeDir = path.dirname(vscodePath);
	for (const entry of readdirSync(vscodeDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;

		const productJsonPath = path.join(vscodeDir, entry.name, 'resources', 'app', 'product.json');
		if (!existsSync(productJsonPath)) continue;

		const product = JSON.parse(readFileSync(productJsonPath, 'utf8')) as Record<string, unknown>;
		if (product['win32VersionedUpdate']) {
			product['win32VersionedUpdate'] = false;
			writeFileSync(productJsonPath, JSON.stringify(product, null, '\t'));
		}
		break;
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
	// Skip onboarding/welcome screens — ephemeral test environments shouldn't show welcome views
	'gitlens.advanced.skipOnboarding': true,

	// Associate git-rebase-todo files with GitLens rebase editor
	// TODO: is this needed?
	'workbench.editorAssociations': {
		'git-rebase-todo': 'gitlens.rebase',
	},
};

export interface LaunchOptions {
	vscodeVersion?: string;
	/**
	 * Absolute path to a VS Code-compatible editor binary (e.g. Cursor, Windsurf, Trae).
	 * When set, the harness launches this binary instead of downloading VS Code.
	 * Overridable per-project or globally via the `VSCODE_E2E_EXECUTABLE_PATH` env var.
	 */
	executablePath?: string;
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
			// Allow pointing tests at a VS Code-compatible editor binary (Cursor, Windsurf, Kiro, etc.)
			// instead of downloading VS Code. When unset (or empty), downloads the requested VS Code version.
			// `||` (not `??`) so an empty env var — e.g. the VS Code leg of a CI editor matrix — falls through.
			const executableOverride = vscodeOptions.executablePath || process.env.VSCODE_E2E_EXECUTABLE_PATH;
			const vscodePath =
				executableOverride || (await downloadAndUnzipVSCode(vscodeOptions.vscodeVersion ?? 'stable'));
			// Patch product.json to prevent installer-mutex false positive on Windows
			patchTestVSCodeProductJson(vscodePath);
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

			// Wait for GitLens to activate before providing to tests.
			// Gate on the extension host (editor-agnostic) so this works on VS Code as well as
			// forks like Cursor whose customized UI has no standard activity bar to key off of.
			await waitForGitLensActivation(evaluate);

			// Clear any editor onboarding overlay (e.g. Kiro's sign-in page) that would block UI clicks.
			await dismissOnboardingOverlays(page);

			// On editors with a standard activity bar, also wait for the GitLens tab to paint so
			// UI-driven tests have a settled workbench. Skipped on forks without one (e.g. Cursor).
			if ((await page.locator('[id="workbench.parts.activitybar"]').count()) > 0) {
				await gitlens.waitForActivation();
			}

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
