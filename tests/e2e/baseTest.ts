/* oxlint-disable no-empty-pattern */
import type { ChildProcess } from 'node:child_process';
import { execSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
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
	const detail = lastError instanceof Error ? lastError.message : '';
	throw new Error(`GitLens did not activate within ${timeout}ms${detail ? `: ${detail}` : ''}`);
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
					for (const el of [...root.querySelectorAll('*')]) {
						if (
							(el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button') &&
							/^skip all$/i.test((el.textContent ?? '').trim())
						) {
							(el as HTMLElement).click();

							return 'dismissed';
						}

						if (el.shadowRoot != null) {
							roots.push(el.shadowRoot);
						}
					}
				}

				return 'pending';
			})
			// A thrown evaluate (e.g. execution context briefly torn down during startup) is transient —
			// treat it as 'pending' and keep polling, not 'absent', so a slightly-late overlay isn't missed.
			.catch(() => 'pending' as const);

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

/**
 * Some VS Code forks hard-gate their entire workbench behind a full-screen sign-in wall on a fresh
 * (unauthenticated) profile — every CI run and every harness-created temp profile is such a profile.
 * Cursor shows `.onboarding-v2-overlay` ("Sign Up / Log In", "Cursor's AI features require you to be
 * logged in"): there is no "continue without an account" affordance, Escape does nothing, and the
 * workbench stays in `nomaineditorarea nosidebar`, so every pointer event is swallowed and UI-driven
 * specs would each burn their full 30s click timeout before failing (a ~20-min job that gets cancelled).
 * We can't bypass it — it requires a real auth token we won't (and CI can't) carry, and seeding the
 * non-auth onboarding flags into `state.vscdb` does not lift it (verified).
 *
 * So detect it and fail fast with a clear message. On such a login-walled fork this throws during the
 * (worker-scoped) `vscode` fixture setup, turning each doomed UI spec into an immediate, self-explanatory
 * failure instead of a 30s-per-click timeout. Login-walled forks are `experimental` (informational /
 * continue-on-error in CI), so a fast red is the honest outcome. No-op on VS Code and forks that reach a
 * normal workbench (Windsurf).
 */
async function assertWorkbenchReachable(page: Page, editorId: string): Promise<void> {
	if (editorId === 'vscode') return;

	// Cursor's sign-in wall. Add other forks' login-overlay selectors here if they surface the same way.
	const signInWall = await page.locator('.onboarding-v2-overlay').count();
	if (signInWall > 0) {
		throw new Error(
			`E2E editor "${editorId}" is showing a sign-in wall (.onboarding-v2-overlay) on this fresh ` +
				`profile and its workbench is unreachable — UI-driven specs cannot run without an authenticated ` +
				`account (see docs/testing.md). This is a known structural limitation of the fork, not a product ` +
				`or harness bug.`,
		);
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

/**
 * Force-kills an editor process tree by its main PID.
 *
 * Windows does not cascade termination to child processes, so a worker whose `electronApp.close()`
 * hangs or half-completes (timed-out or crashed editor) leaves orphaned renderer / GPU / utility /
 * spawned-`git` children behind — visible locally as a pile of stray `Cursor`/`Code`/`git`/
 * `chrome_crashpad_handler` processes after a run. Killing the tree from the still-live main PID
 * (`taskkill /T`) reaps them. A no-op when the process already exited cleanly (the happy path).
 * Scoped strictly to this instance's PID so it never touches the developer's own editor windows.
 */
function killProcessTree(pid: number | undefined): void {
	if (pid == null) return;

	try {
		if (process.platform === 'win32') {
			execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
		} else {
			process.kill(pid, 'SIGKILL');
		}
	} catch {
		// Already gone / no such process — nothing to clean up.
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
	 * Per-spec escape hatch; the normal path is the `editorExecutablePath` worker option set by
	 * Playwright projects (see editors.ts / playwright.config.ts).
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
	/** Editor identity for this project (e.g. 'vscode', 'windsurf'); set by Playwright projects. */
	editorId: string;
	/** Absolute path to the editor binary; empty means download VS Code. Set by Playwright projects. */
	editorExecutablePath: string;
}

export const test = base.extend<BaseFixtures, WorkerFixtures>({
	// Default options (can be overridden per-file)
	vscodeOptions: [{ vscodeVersion: process.env.VSCODE_VERSION ?? 'stable' }, { scope: 'worker', option: true }],

	// Editor identity — set per-project (see editors.ts / playwright.config.ts).
	// Defaults target VS Code so a config-less run (or the `vscode` project) downloads VS Code.
	editorId: ['vscode', { scope: 'worker', option: true }],
	editorExecutablePath: ['', { scope: 'worker', option: true }],

	// vscode launches VS Code with GitLens extension (shared per worker)
	vscode: [
		async ({ vscodeOptions, editorId, editorExecutablePath }, use) => {
			// Ensure the E2E runner is built (handles VS Code extension skipping globalSetup)
			ensureRunnerBuilt();

			const tempDir = await createTmpDir();
			// Resolve the editor binary: project-provided path (forks like Cursor/Windsurf/Kiro),
			// then a per-spec override, else download VS Code. `||` (not `??`) so an empty path falls through.
			const executableOverride = editorExecutablePath || vscodeOptions.executablePath;
			// A fork project MUST supply a binary — never silently fall back to downloading VS Code, which
			// would run the wrong editor under the fork's project name (a false-green result).
			if (editorId !== 'vscode' && !executableOverride) {
				throw new Error(
					`E2E project "${editorId}" requires an editor binary path (env not set); refusing to fall back to VS Code`,
				);
			}

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

			// On Linux, VS Code (and forks) create a single-instance IPC socket under $XDG_RUNTIME_DIR
			// (default /run/user/<uid>). Headless environments without a systemd login session — CI under
			// xvfb, non-interactive WSL — often have no such dir, so the socket `listen` fails with EACCES
			// at launch (forks like Positron abort on this where VS Code falls back). Give each worker its
			// own writable runtime dir: fixes access and avoids cross-worker socket-name collisions.
			let runtimeDir: string | undefined;
			if (process.platform === 'linux') {
				runtimeDir = path.join(tempDir, 'xdg-runtime');
				await mkdir(runtimeDir, { recursive: true });
				await chmod(runtimeDir, 0o700);
			}

			const launchEnv = {
				...process.env,
				// Allows Claude Code and other CLI agents run the tests from within VS Code
				ELECTRON_RUN_AS_NODE: undefined!,
				// Set DISPLAY for headless Linux (Xvfb)
				...(display ? { DISPLAY: display } : {}),
				// Per-worker writable runtime dir for the editor's IPC socket (see note above)
				...(runtimeDir ? { XDG_RUNTIME_DIR: runtimeDir } : {}),
			};

			// Bringing up the editor + its in-process test server can transiently fail under
			// parallel-launch contention: Electron aborts with `Process failed to launch`, or the test
			// server doesn't print its ready line before the connect deadline. Most visible on the
			// heavier forks (Windsurf/Positron) when several workers spawn at once. Retry launch+connect
			// a few times so a contended worker recovers instead of failing the whole shard. Each
			// attempt keeps the SAME per-attempt connect timeout, so a healthy worker still starts
			// immediately — only a genuinely failed spawn pays the (failure-path) retry cost.
			const maxLaunchAttempts = 3;
			let electronApp!: ElectronApplication;
			let evaluator!: VSCodeEvaluator;
			for (let attempt = 1; attempt <= maxLaunchAttempts; attempt++) {
				let app: ElectronApplication | undefined;
				try {
					app = await _electron.launch({ ...options, env: launchEnv });
					evaluator = await VSCodeEvaluator.connect(app);
					electronApp = app;
					break;
				} catch (ex) {
					// Tear down the half-started editor (if it launched) so the retry starts clean and
					// no orphan process/socket lingers. Kill the tree first (while the root is live) so the
					// fork's helper children are reaped, then let close() settle Playwright's side.
					killProcessTree(app?.process().pid);
					await app?.close().catch(() => {});
					if (attempt >= maxLaunchAttempts) throw ex;

					// Back-off (failure-path only) to let the launch contention drain before respawning;
					// an immediate relaunch tends to hit the same pressure.
					await new Promise(resolve => setTimeout(resolve, 2000));
				}
			}
			const evaluate = evaluator.evaluate.bind(evaluator);
			// Main editor PID, captured up-front so teardown can force-kill the tree even if setup below
			// throws (e.g. the fail-fast sign-in-wall guard) before `use()` is ever reached.
			const editorPid = electronApp.process().pid;

			try {
				const page = await electronApp.firstWindow();
				const gitlens = new GitLensPage(page, evaluate);

				// Wait for GitLens to activate before providing to tests.
				// Gate on the extension host (editor-agnostic) so this works on VS Code as well as
				// forks like Cursor whose customized UI has no standard activity bar to key off of.
				await waitForGitLensActivation(evaluate);

				// Clear any editor onboarding overlay (e.g. Kiro's sign-in page) that would block UI clicks.
				await dismissOnboardingOverlays(page);

				// Fail fast (with a clear message) on a login-walled fork whose workbench is unreachable on a
				// fresh profile (e.g. Cursor's sign-in wall) instead of letting every UI spec burn its click
				// timeout. Must come after the dismiss attempt above so a genuinely-dismissable overlay isn't
				// mistaken for a hard wall.
				await assertWorkbenchReachable(page, editorId);

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
			} finally {
				// Cleanup — runs on the happy path AND when setup above throws, so a failed worker never
				// leaks its editor.
				evaluator.close();
				// Force-kill the whole process tree BEFORE close(): Windows doesn't cascade termination, and
				// once the main process has exited a `taskkill /T` can no longer walk to its (now-orphaned)
				// children — so a post-close kill misses the fork's helper processes (language servers,
				// GPU/utility/renderer). Killing from the still-live root reaps them all; close() then just
				// settles Playwright's side.
				killProcessTree(editorPid);
				await electronApp.close().catch(() => {});
				await rm(tempDir, { recursive: true, force: true }).catch(() => {});
			}
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
