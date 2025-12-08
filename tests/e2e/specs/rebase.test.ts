import * as fs from 'node:fs';
import * as path from 'node:path';
import * as process from 'node:process';
import type { VSCodeInstance } from '../baseTest';
import { test as base, createTmpDir, expect, GitFixture } from '../baseTest';

/** SHA of the initial commit - captured during repo setup */
let initialCommitSha: string;
/** Git fixture for the test repository */
let git: GitFixture;

// Configure vscodeOptions with setup callback to create test repo
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			userSettings: {
				'gitlens.mode.active': false,
				'gitlens.graph.autorefresh.enabled': false,
				'gitlens.views.repositories.autoRefresh': false,
			},
			setup: async () => {
				const repoDir = await createTmpDir();
				git = new GitFixture(repoDir);
				await git.init();
				// Capture initial commit SHA for reset
				initialCommitSha = await git.getShortSha('HEAD');
				// Create test commits
				await git.commit('Commit A', 'a.txt', 'content a');
				await git.commit('Commit B', 'b.txt', 'content b');
				await git.commit('Commit C', 'c.txt', 'content c');
				await git.commit('Commit D', 'd.txt', 'content d');
				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

/** Store the current rebase context for cleanup */
let currentRebaseContext: ReturnType<GitFixture['startRebaseInteractiveWithWaitEditor']> | null = null;

/**
 * Helper to start an interactive rebase (git process only).
 * Returns helpers to wait for the todo file and signal completion.
 */
function startInteractiveRebase(
	options: { rebaseMerges?: boolean } = {},
): ReturnType<GitFixture['startRebaseInteractiveWithWaitEditor']> {
	const result = git.startRebaseInteractiveWithWaitEditor(initialCommitSha, {
		rebaseMerges: options?.rebaseMerges,
	});

	return result;
}

/**
 * Opens the rebase todo file in VS Code and waits for the rebase editor tab to appear.
 */
async function openRebaseEditor(vscode: VSCodeInstance, todoFilePath: string): Promise<void> {
	await vscode.gitlens.openFile(todoFilePath, true);

	// Wait for the rebase editor tab to appear
	const rebaseTab = vscode.page.getByRole('tab', { name: /Interactive Rebase/i });
	await rebaseTab.waitFor({ state: 'visible', timeout: 45000 });
}

/**
 * Helper to get the rebase webview frame with retry.
 */
async function getRebaseWebviewWithRetry(
	vscode: VSCodeInstance,
): Promise<NonNullable<Awaited<ReturnType<typeof vscode.gitlens.getRebaseWebview>>>> {
	let frame = await vscode.gitlens.getRebaseWebview();
	let retries = 0;
	while (!frame && retries < 60) {
		await vscode.page.waitForTimeout(500);
		frame = await vscode.gitlens.getRebaseWebview();
		retries++;
	}
	if (!frame) {
		throw new Error('Rebase webview frame not found');
	}
	return frame;
}

async function standardSetup({ vscode }: { vscode: VSCodeInstance }) {
	// Access vscode to ensure setup has run
	void vscode;

	// Abort any in-progress rebase
	if (await git.isRebaseInProgress()) {
		await git.rebaseAbort();
	}

	// Ensure rebase-merge and rebase-apply directories are removed for a clean state
	try {
		await fs.promises.rm(path.join(git.repoDir, '.git', 'rebase-merge'), { recursive: true, force: true });
	} catch {}
	try {
		await fs.promises.rm(path.join(git.repoDir, '.git', 'rebase-apply'), { recursive: true, force: true });
	} catch {}
	try {
		await fs.promises.rm(path.join(git.repoDir, '.git', 'index.lock'), { force: true });
	} catch {}
	try {
		await fs.promises.rm(path.join(git.repoDir, '.git', 'HEAD.lock'), { force: true });
	} catch {}

	// Reset to a known state: recreate commits A, B, C, D on top of initial
	await git.reset(initialCommitSha, 'hard');
	await git.clean();
	await git.commit('Commit A', 'a.txt', 'content a');
	await git.commit('Commit B', 'b.txt', 'content b');
	await git.commit('Commit C', 'c.txt', 'content c');
	await git.commit('Commit D', 'd.txt', 'content d');
}

async function standardTeardown({ vscode }: { vscode: VSCodeInstance }) {
	const { gitlens } = vscode;

	// Signal any running wait editor to exit
	if (currentRebaseContext) {
		await currentRebaseContext.signalEditorDone().catch(() => {});
		// Wait with a timeout - don't hang forever if the process was killed
		await Promise.race([
			currentRebaseContext.rebasePromise.catch((ex: unknown) => {
				console.error('rebasePromise rejected (afterEach):', ex);
			}),
			new Promise(resolve => setTimeout(resolve, 5000)),
		]);
		currentRebaseContext = null;
	}

	// Abort any in-progress rebase
	if (await git.isRebaseInProgress()) {
		await git.rebaseAbort();
	}

	// Ensure the repo is clean after each test
	await git.reset(initialCommitSha, 'hard');

	// Close all editors
	await gitlens.closeAllEditors();
}

test.describe('Rebase Editor', () => {
	test.setTimeout(120000); // 2 minute timeout for rebase tests

	test.describe('Start & Abort', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('aborts interactive rebase and restores state', async ({ vscode }) => {
			const { page } = vscode;

			// Record the current HEAD before rebase
			const originalHead = await git.getShortSha('HEAD');

			// Start interactive rebase
			const { rebasePromise, waitForTodoFile, signalEditorDone, signalEditorAbort } = startInteractiveRebase();
			currentRebaseContext = {
				rebasePromise: rebasePromise,
				waitForTodoFile: waitForTodoFile,
				signalEditorDone: signalEditorDone,
				signalEditorAbort: signalEditorAbort,
			};
			const todoFilePath = await waitForTodoFile();

			// Open the rebase editor
			await openRebaseEditor(vscode, todoFilePath);

			// Wait a bit for the webview to load
			await page.waitForTimeout(2000);

			// Verify the webview content is loaded with rebase entries
			const webviewFrame = await getRebaseWebviewWithRetry(vscode);

			// Wait for the rebase editor to be fully loaded
			await expect(webviewFrame.locator('gl-rebase-editor')).toBeVisible({ timeout: 15000 });

			const rebaseEntry = webviewFrame.locator('gl-rebase-entry').first();
			await expect(rebaseEntry).toBeVisible({ timeout: 10000 });

			// Signal the wait editor to exit before clicking abort
			// This ensures the .done file exists when git tries to exit
			await signalEditorDone();

			// Click the Abort button (gl-button custom element with text "Abort")
			const abortButton = webviewFrame.locator('gl-button').filter({ hasText: 'Abort' });
			await abortButton.click();

			// Wait briefly for abort to complete
			await rebasePromise.catch(() => {});

			// Verify rebase was aborted - HEAD unchanged
			const currentHead = await git.getShortSha('HEAD');
			expect(currentHead).toBe(originalHead);

			// Verify the rebase editor tab is closed
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 5000 });

			currentRebaseContext = null;
		});
	});

	test.describe('Action changes', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('updates entry action via keyboard shortcuts and dropdown', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });

			// Test keyboard shortcut: 's' for squash
			// Note: First entry cannot be squashed, so use the second one
			await entries.nth(1).click();
			await page.keyboard.press('s');
			await page.waitForTimeout(200);

			// Check that the action select has the 'squash' value
			const actionSelect = entries.nth(1).locator('.action-select');
			await expect(actionSelect).toHaveAttribute('value', 'squash');

			// Test multi-select: Ctrl+Click then change action
			await entries.nth(2).click();
			await entries.nth(3).click({ modifiers: ['Control'] });
			await page.keyboard.press('d');
			await page.waitForTimeout(200);

			await expect(entries.nth(2).locator('.action-select')).toHaveAttribute('value', 'drop');
			await expect(entries.nth(3).locator('.action-select')).toHaveAttribute('value', 'drop');
		});

		test('prevents squashing the root commit', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			// Target inner div with data-type="commit" to exclude the base entry
			// The custom element host doesn't reflect data-type, so we look inside
			const commitEntries = webviewFrame.locator('[data-type="commit"]');
			const lastEntry = commitEntries.last(); // Oldest commit in descending order

			await lastEntry.click();
			await page.keyboard.press('s');
			await page.waitForTimeout(200);

			// Should still be 'pick'
			// Use locator to find the select within the clicked entry
			const actionSelect = lastEntry.locator('.action-select');
			await expect(actionSelect).toHaveAttribute('value', 'pick');
		});

		test('prevents squashing the root commit during bulk update', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const commitEntries = webviewFrame.locator('[data-type="commit"]');
			const newestEntry = commitEntries.first(); // Commit D
			const oldestEntry = commitEntries.last(); // Commit A

			// Select oldest then newest (so newest is focused)
			await oldestEntry.click();
			await newestEntry.click({ modifiers: ['Control'] });

			// Press 's' to squash selection
			await page.keyboard.press('s');
			await page.waitForTimeout(200);

			// Verify newest entry became 'squash'
			await expect(newestEntry.locator('.action-select')).toHaveAttribute('value', 'squash');

			// Verify oldest entry remained 'pick'
			await expect(oldestEntry.locator('.action-select')).toHaveAttribute('value', 'pick');
		});
	});

	test.describe('Multi-select and Bulk Actions', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('moves multiple entries down via keyboard shortcuts', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });

			// Select 2nd and 3rd entries (Commit C and Commit B)
			await entries.nth(1).click();
			await entries.nth(2).click({ modifiers: ['Control'] });

			// Move them down using Alt+Down
			await page.keyboard.press('Alt+ArrowDown');
			await page.waitForTimeout(200);

			const messages = await entries.locator('.entry-message-content').allTextContents();
			// Filter out base entry if present (it's usually last)
			const commitMessages = messages.slice(0, 4);
			expect(commitMessages).toEqual(['Commit D', 'Commit A', 'Commit C', 'Commit B']);
		});

		test('moves multiple entries up via keyboard shortcuts', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });

			// Select 3rd and 4th entries (Commit B and Commit A)
			await entries.nth(2).click();
			await entries.nth(3).click({ modifiers: ['Control'] });

			// Move them up using Alt+Up
			await page.keyboard.press('Alt+ArrowUp');
			await page.waitForTimeout(200);

			const messages = await entries.locator('.entry-message-content').allTextContents();
			const commitMessages = messages.slice(0, 4);
			expect(commitMessages).toEqual(['Commit D', 'Commit B', 'Commit A', 'Commit C']);
		});
	});

	test.describe('Entry display', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('renders commit entries with correct details', async ({ vscode }) => {
			// Start interactive rebase
			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();

			// Open the rebase editor
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });
			// Verify we have the expected number of entries (4 commits + 1 base = 5 total)
			await expect(entries).toHaveCount(5);

			// Verify the commit entries have expected messages (in descending/newest-first order)
			// The first 4 are our commits, the 5th is the base entry
			const messages = ['Commit D', 'Commit C', 'Commit B', 'Commit A'];
			for (let i = 0; i < 4; i++) {
				const message = await entries.nth(i).locator('.entry-message-content').textContent();
				expect(message).toBe(messages[i]);
			}

			// Verify all regular entries have an action select element
			for (let i = 0; i < 4; i++) {
				await expect(entries.nth(i).locator('.action-select')).toBeVisible();
			}
		});

		test('verifies accessibility attributes on entries', async ({ vscode }) => {
			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);

			// Check list role on the virtualizer
			const list = webviewFrame.locator('lit-virtualizer');
			await expect(list).toHaveAttribute('role', 'list');

			// Check listitem role and aria-label on entries
			const firstEntry = webviewFrame.locator('gl-rebase-entry').first().locator('[role="listitem"]');
			await expect(firstEntry).toBeVisible();

			// Verify aria-label contains key info (Action, Message, SHA)
			// Default action is 'pick'
			const label = await firstEntry.getAttribute('aria-label');
			expect(label).toContain('pick');
			expect(label).toContain('Commit D');
		});
	});

	test.describe('Execute rebase', () => {
		test.setTimeout(600000); // 10 minute timeout for git operations
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('executes rebase and closes editor on start', async ({ vscode }) => {
			const { page } = vscode;

			const originalHead = await git.getShortSha('HEAD');

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { rebasePromise, waitForTodoFile, signalEditorDone } = rebaseContext;
			const todoFilePath = await waitForTodoFile();

			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });

			// Drop the first entry to create a visible change
			await entries.first().click();
			await page.keyboard.press('d');
			await page.waitForTimeout(200);

			// Click Start/Continue button (gl-button custom element)
			const startButton = webviewFrame.locator('gl-button').filter({ hasText: /Start|Continue/i });
			await startButton.click();

			// Wait for the editor to close (indicates changes were saved)
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 10000 });

			// Signal the wait editor to exit so git can complete the rebase
			await signalEditorDone();

			// Wait for rebase to complete
			await rebasePromise;

			// Verify rebase completed - HEAD changed
			const newHead = await git.getShortSha('HEAD');
			expect(newHead).not.toBe(originalHead);

			// Verify editor closed
			await expect(rebaseTab).not.toBeVisible({ timeout: 5000 });

			currentRebaseContext = null;
		});

		test('applies drop and fixup actions correctly', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { rebasePromise, waitForTodoFile, signalEditorDone } = rebaseContext;
			const todoFilePath = await waitForTodoFile();

			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 10000 });

			// Drop "Commit D" (index 0)
			await entries.nth(0).click();
			await page.keyboard.press('d');
			await page.waitForTimeout(100);

			// Fixup "Commit C" (index 1) - merges into "Commit B" (index 2)
			await entries.nth(1).click();
			await page.keyboard.press('f');
			await page.waitForTimeout(100);

			// Click Start/Continue button
			const startButton = webviewFrame.locator('gl-button').filter({ hasText: /Start|Continue/i });
			await startButton.click();

			// Wait for the editor to close (indicates changes were saved)
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 10000 });

			// Signal the wait editor to exit so git can complete the rebase
			await signalEditorDone();

			// Wait for rebase to complete with timeout
			await Promise.race([
				rebasePromise,
				new Promise((_, reject) => setTimeout(() => reject(new Error('Rebase timeout after 60s')), 60000)),
			]);

			// Verify HEAD is "Commit B" (which now contains C's changes)
			const headMessage = await git.getCommitMessage('HEAD');
			expect(headMessage).toBe('Commit B');

			// Verify previous commit is "Commit A"
			const prevMessage = await git.getCommitMessage('HEAD^');
			expect(prevMessage).toBe('Commit A');

			// Verify d.txt is gone (dropped)
			const dExists = fs.existsSync(path.join(git.repoDir, 'd.txt'));
			expect(dExists).toBe(false);

			// Verify c.txt is present (fixup kept changes)
			const cExists = fs.existsSync(path.join(git.repoDir, 'c.txt'));
			expect(cExists).toBe(true);

			currentRebaseContext = null;
		});
	});

	test.describe('Drag and drop', () => {
		test.skip('reorders entries via drag and drop', async ({ vscode: _vscode }) => {
			// Skipping drag and drop tests due to issues with drag events in webview iframes
			// The drag events are not being properly dispatched through the nested iframe structure
		});

		// Skipping drag and drop tests due to issues with drag events in webview iframes
		// The drag events are not being properly dispatched through the nested iframe structure
		test.afterEach(standardTeardown);
	});
});

test.describe('Rebase Merges', () => {
	test.setTimeout(180000); // Increase timeout for rebase-merges		test.afterEach(standardTeardown);
	const rebaseMergesTest = test.extend({
		vscodeOptions: [
			async ({ vscodeOptions }, use) => {
				const repoDir = await createTmpDir();
				const gitMerge = new GitFixture(repoDir);
				await gitMerge.init();

				// Initial commit (A)
				await gitMerge.commit('Initial commit (A)', 'a.txt', 'content A');
				// commitASha captured but not needed for this test

				// Commit 1 on main (C1)
				await gitMerge.commit('Commit 1 (main)', 'b.txt', 'content B');
				const commitC1Sha = await gitMerge.getShortSha('HEAD'); // Rebase onto this

				// Create feature branch from C1
				await gitMerge.branch('feature');

				// Commit on feature branch (F1)
				await gitMerge.checkout('feature');
				await gitMerge.commit('Commit 2 (feature)', 'c.txt', 'content C');

				// Merge feature into main (Merge Commit M)
				await gitMerge.checkout('main');
				await gitMerge.merge('feature', 'Merge feature branch', { noFF: true });

				git = gitMerge;
				initialCommitSha = commitC1Sha; // Rebase onto Commit 1 (main)

				await use({
					...vscodeOptions,
					setup: () => Promise.resolve(repoDir),
				});
			},
			{ scope: 'worker' },
		],
	});

	rebaseMergesTest('enforces read-only mode for rebase with merges', async ({ vscode }) => {
		const { page } = vscode;

		// Start interactive rebase with --rebase-merges to generate merge commands
		const rebaseContext = startInteractiveRebase({ rebaseMerges: true });
		currentRebaseContext = rebaseContext;
		const { rebasePromise, waitForTodoFile, signalEditorAbort } = rebaseContext;

		const todoFilePath = await waitForTodoFile();

		// Open the rebase editor
		await openRebaseEditor(vscode, todoFilePath);

		await page.waitForTimeout(1000); // Give webview time to re-parse and render

		const webviewFrame = await getRebaseWebviewWithRetry(vscode);

		await expect(webviewFrame.locator('gl-rebase-editor')).toBeVisible();

		// Verify read-only banner is visible
		const readOnlyBanner = webviewFrame.locator('.read-only-banner');
		await expect(readOnlyBanner).toBeVisible();
		await expect(readOnlyBanner).toContainText('This rebase contains merge commits and cannot be edited here');

		// Verify "Switch to Text Editor" button is present
		await expect(readOnlyBanner.locator('gl-button').filter({ hasText: 'Switch to Text Editor' })).toBeVisible();

		// Verify action dropdowns are disabled for all entries
		const entries = webviewFrame.locator('gl-rebase-entry');
		await expect(entries.first()).toBeVisible();

		// Check that the entry container or the action select has a disabled state
		const actionSelect = entries.first().locator('.action-select');
		// Try to find it, but if it doesn't exist, that's OK - it might be hidden in read-only mode
		const actionSelectExists = (await actionSelect.count()) > 0;
		if (actionSelectExists) {
			await expect(actionSelect).toBeDisabled();
		}

		// Abort the rebase to clean up
		await signalEditorAbort();

		currentRebaseContext = null; // Clear context since we didn't fully run the rebase via git --continue

		// We still need to wait for the initial rebasePromise to resolve or reject
		await rebasePromise.catch(() => {});
	});
});
