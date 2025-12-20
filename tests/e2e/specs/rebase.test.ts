/* eslint-disable @typescript-eslint/no-unsafe-return */
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

/** Store the ongoing cleanup promise to prevent race conditions */
let ongoingCleanup: Promise<void> | null = null;

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
	await rebaseTab.waitFor({ state: 'visible', timeout: 5000 });
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

async function standardSetup({ vscode: _vscode }: { vscode: VSCodeInstance }) {
	// Clear any lingering rebase context from previous test
	currentRebaseContext = null;

	// Wait for any ongoing cleanup from previous test to complete
	if (ongoingCleanup) {
		await ongoingCleanup;
		ongoingCleanup = null;
	}

	// Get the repo path and completely wipe it
	const repoPath = git.repoPath;

	// Remove the entire .git directory and all files to start fresh
	const fs = (await import('node:fs')).promises;
	try {
		await fs.rm(repoPath, { recursive: true, force: true });
	} catch {
		// Ignore errors if directory doesn't exist
	}

	// Recreate the directory and reinitialize the repo
	await fs.mkdir(repoPath, { recursive: true });
	await git.init();

	// Capture the initial commit SHA
	initialCommitSha = await git.getShortSha('HEAD');

	// Create test commits
	await git.commit('Commit A', 'a.txt', 'content a');
	await git.branch('feature-a');
	await git.commit('Commit B', 'b.txt', 'content b');
	await git.branch('feature-b');
	await git.commit('Commit C', 'c.txt', 'content c');
	await git.commit('Commit D', 'd.txt', 'content d');
}

async function standardTeardown({ vscode }: { vscode: VSCodeInstance }) {
	const { gitlens } = vscode;

	// Store the cleanup promise so next setup can wait for it
	ongoingCleanup = (async () => {
		// Signal any running wait editor to exit (if it was started)
		if (currentRebaseContext) {
			// Try to signal abort (this requires waitForTodoFile to have been called)
			await currentRebaseContext.signalEditorAbort().catch(() => {
				// If signaling fails, we'll reinitialize in setup anyway
			});
			// Wait briefly for the signal to be processed
			await Promise.race([
				currentRebaseContext.rebasePromise.catch(() => {}),
				new Promise(resolve => setTimeout(resolve, 1000)),
			]);
			currentRebaseContext = null;
		}

		// Close all editors to clean up UI state
		await gitlens.closeAllEditors();
	})();

	// Wait for cleanup to complete before returning
	await ongoingCleanup;
}

test.describe('Rebase Editor', () => {
	test.setTimeout(30000);

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
			await page.waitForTimeout(500);

			// Verify the webview content is loaded with rebase entries
			const webviewFrame = await getRebaseWebviewWithRetry(vscode);

			// Wait for the rebase editor to be fully loaded
			await expect(webviewFrame.locator('gl-rebase-editor')).toBeVisible({ timeout: 5000 });

			const rebaseEntry = webviewFrame.locator('gl-rebase-entry').first();
			await expect(rebaseEntry).toBeVisible({ timeout: 3000 });

			// Signal the wait editor to exit before clicking abort
			// This ensures the .done file exists when git tries to exit
			await signalEditorDone();

			// Click the Abort button (gl-button custom element with exact text "Abort")
			// Use appearance="secondary" to target the main abort button, not the "Abort > Recompose" button
			const abortButton = webviewFrame.locator('gl-button[appearance="secondary"]').filter({ hasText: 'Abort' });
			await abortButton.click();

			// Wait for abort to complete with timeout
			await Promise.race([rebasePromise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);

			// Give Git extra time to finish cleanup
			await new Promise(resolve => setTimeout(resolve, 500));

			// Verify rebase was aborted - HEAD unchanged
			const currentHead = await git.getShortSha('HEAD');
			expect(currentHead).toBe(originalHead);

			// Verify the rebase editor tab is closed
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 3000 });

			currentRebaseContext = null;

			// Extra wait to ensure Git has completely finished cleanup
			// This helps prevent race conditions with the next test
			await new Promise(resolve => setTimeout(resolve, 500));
		});
	});

	test.describe('Action changes', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('changes commit actions using keyboard shortcuts', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 3000 });

			// Test single action change: 's' for squash (can't squash first entry)
			await entries.nth(1).click();
			await page.keyboard.press('s');
			await page.waitForTimeout(200);
			await expect(entries.nth(1).locator('.action-select')).toHaveAttribute('value', 'squash');

			// Test bulk action change: multi-select with Ctrl+Click then drop with 'd'
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

	test.describe('Commit Reordering', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('reorders single commit using keyboard shortcuts', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 3000 });

			// Test moving single commit down: Select Commit D (index 0)
			await entries.nth(0).click();
			await page.keyboard.press('Alt+ArrowDown');
			await page.waitForTimeout(200);

			let messages = await entries.evaluateAll((elements: HTMLElement[]) => {
				return elements.slice(0, 4).map(el => {
					const root = el.shadowRoot;
					if (!root) return '';
					const div = root.querySelector('[role="listitem"]');
					if (!div) return '';
					const ariaLabel = div.getAttribute('aria-label') || '';
					const parts = ariaLabel.split(', ');
					return parts.length >= 2 ? parts.slice(1, -1).join(', ') : '';
				});
			});
			expect(messages).toEqual(['Commit C', 'Commit D', 'Commit B', 'Commit A']);

			// Test moving single commit up: Move Commit D back up (now at index 1)
			await entries.nth(1).click();
			await page.keyboard.press('Alt+ArrowUp');
			await page.waitForTimeout(200);

			messages = await entries.evaluateAll((elements: HTMLElement[]) => {
				return elements.slice(0, 4).map(el => {
					const root = el.shadowRoot;
					if (!root) return '';
					const div = root.querySelector('[role="listitem"]');
					if (!div) return '';
					const ariaLabel = div.getAttribute('aria-label') || '';
					const parts = ariaLabel.split(', ');
					return parts.length >= 2 ? parts.slice(1, -1).join(', ') : '';
				});
			});
			expect(messages).toEqual(['Commit D', 'Commit C', 'Commit B', 'Commit A']);
		});

		test('reorders multiple commits using keyboard shortcuts', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { waitForTodoFile } = rebaseContext;
			const todoFilePath = await waitForTodoFile();
			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 3000 });

			// Test moving commits down: Select 2nd and 3rd entries (Commit C and Commit B)
			await entries.nth(1).click();
			await entries.nth(2).click({ modifiers: ['Control'] });
			await page.keyboard.press('Alt+ArrowDown');
			await page.waitForTimeout(200);

			let messages = await entries.evaluateAll((elements: HTMLElement[]) => {
				return elements.slice(0, 4).map(el => {
					const root = el.shadowRoot;
					if (!root) return '';
					const div = root.querySelector('[role="listitem"]');
					if (!div) return '';
					const ariaLabel = div.getAttribute('aria-label') || '';
					const parts = ariaLabel.split(', ');
					return parts.length >= 2 ? parts.slice(1, -1).join(', ') : '';
				});
			});
			expect(messages).toEqual(['Commit D', 'Commit A', 'Commit C', 'Commit B']);

			// Test moving commits up: Select repositioned Commit C and Commit B (now at indices 2 and 3)
			await entries.nth(2).click();
			await entries.nth(3).click({ modifiers: ['Control'] });
			await page.keyboard.press('Alt+ArrowUp');
			await page.waitForTimeout(200);

			// Verify they moved back up (should now be: D, C, B, A)
			messages = await entries.evaluateAll((elements: HTMLElement[]) => {
				return elements.slice(0, 4).map(el => {
					const root = el.shadowRoot;
					if (!root) return '';
					const div = root.querySelector('[role="listitem"]');
					if (!div) return '';
					const ariaLabel = div.getAttribute('aria-label') || '';
					const parts = ariaLabel.split(', ');
					return parts.length >= 2 ? parts.slice(1, -1).join(', ') : '';
				});
			});
			expect(messages).toEqual(['Commit D', 'Commit C', 'Commit B', 'Commit A']);
		});
	});

	test.describe('Accessibility', () => {
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('provides proper ARIA labels and roles for screen readers', async ({ vscode }) => {
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
		test.setTimeout(30000); // 30s timeout for git operations
		test.beforeEach(standardSetup);
		test.afterEach(standardTeardown);

		test('completes rebase after dropping a commit', async ({ vscode }) => {
			const { page } = vscode;

			const originalHead = await git.getShortSha('HEAD');

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { rebasePromise, waitForTodoFile, signalEditorDone } = rebaseContext;
			const todoFilePath = await waitForTodoFile();

			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 3000 });

			// Drop the first entry to create a visible change
			await entries.first().click();
			await page.keyboard.press('d');
			await page.waitForTimeout(200);

			// Click Start/Continue button (gl-button custom element)
			const startButton = webviewFrame.locator('gl-button').filter({ hasText: /Start|Continue/i });
			// Wait for any notifications to disappear or timeout
			await page.waitForTimeout(1000);
			// Try to close any visible notifications
			try {
				const notifications = page.locator('.notifications-toasts');
				if (await notifications.isVisible()) {
					await page.keyboard.press('Escape');
					await page.waitForTimeout(500);
				}
			} catch {}
			await startButton.click();
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 3000 });

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

		test('squashes commits using fixup and drops unwanted commits', async ({ vscode }) => {
			const { page } = vscode;

			const rebaseContext = startInteractiveRebase();
			currentRebaseContext = rebaseContext;
			const { rebasePromise, waitForTodoFile, signalEditorDone } = rebaseContext;
			const todoFilePath = await waitForTodoFile();

			await openRebaseEditor(vscode, todoFilePath);

			const webviewFrame = await getRebaseWebviewWithRetry(vscode);
			const entries = webviewFrame.locator('gl-rebase-entry');
			await expect(entries.first()).toBeVisible({ timeout: 3000 });

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
			// Wait for any notifications to disappear or timeout
			await page.waitForTimeout(1000);
			// Try to close any visible notifications
			try {
				const notifications = page.locator('.notifications-toasts');
				if (await notifications.isVisible()) {
					await page.keyboard.press('Escape');
					await page.waitForTimeout(500);
				}
			} catch {}
			await startButton.click();
			const rebaseTab = page.getByRole('tab', { name: /Interactive Rebase/i });
			await expect(rebaseTab).not.toBeVisible({ timeout: 3000 });

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
			const dExists = fs.existsSync(path.join(git.repoPath, 'd.txt'));
			expect(dExists).toBe(false);

			// Verify c.txt is present (fixup kept changes)
			const cExists = fs.existsSync(path.join(git.repoPath, 'c.txt'));
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

/**
 * Tests for update-ref handling during interactive rebase.
 * When using --update-refs, branches pointing to rebased commits get update-ref entries
 * that must follow their commits when reordered.
 */
test.describe('Update Refs', () => {
	test.beforeEach(standardSetup);
	test.afterEach(standardTeardown);

	test('displays update-ref badges on commits with branches', async ({ vscode }) => {
		const rebaseContext = git.startRebaseInteractiveWithWaitEditor(initialCommitSha, { updateRefs: true });
		currentRebaseContext = rebaseContext;
		const { rebasePromise, waitForTodoFile, signalEditorDone, signalEditorAbort } = rebaseContext;

		const todoFilePath = await waitForTodoFile();
		await openRebaseEditor(vscode, todoFilePath);

		const webviewFrame = await getRebaseWebviewWithRetry(vscode);
		const entries = webviewFrame.locator('gl-rebase-entry');
		await expect(entries.first()).toBeVisible({ timeout: 3000 });

		// Verify update-ref badges are displayed
		// Commit A should have feature-a badge, Commit B should have feature-b badge
		const updateRefBadges = webviewFrame.locator('gl-ref-overflow-chip');
		await expect(updateRefBadges).toHaveCount(2);

		// Signal done and abort to clean up
		await signalEditorDone();
		await signalEditorAbort();
		await Promise.race([rebasePromise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
		currentRebaseContext = null;
	});

	test('update-refs follow their commit when moved via keyboard', async ({ vscode }) => {
		const { page } = vscode;

		const rebaseContext = git.startRebaseInteractiveWithWaitEditor(initialCommitSha, { updateRefs: true });
		currentRebaseContext = rebaseContext;
		const { rebasePromise, waitForTodoFile, signalEditorDone, signalEditorAbort } = rebaseContext;

		const todoFilePath = await waitForTodoFile();
		await openRebaseEditor(vscode, todoFilePath);

		const webviewFrame = await getRebaseWebviewWithRetry(vscode);
		const entries = webviewFrame.locator('gl-rebase-entry');
		await expect(entries.first()).toBeVisible({ timeout: 3000 });

		// Read initial todo file content
		const initialContent = fs.readFileSync(todoFilePath, 'utf-8');

		// Verify initial structure has update-refs after their commits
		// Order should be: pick D, pick C, pick B, update-ref feature-b, pick A, update-ref feature-a
		// Git adds '#' before commit messages in the todo file
		expect(initialContent).toMatch(/pick [a-f0-9]+ #? ?Commit A[\s\S]*update-ref refs\/heads\/feature-a/);
		expect(initialContent).toMatch(/pick [a-f0-9]+ #? ?Commit B[\s\S]*update-ref refs\/heads\/feature-b/);

		// Select Commit B (which has feature-b branch) and move it up
		// In descending order: D, C, B, A - so B is at index 2
		await entries.nth(2).click();
		await page.keyboard.press('Alt+ArrowUp');
		await page.waitForTimeout(500);

		// Read the updated todo file
		const updatedContent = fs.readFileSync(todoFilePath, 'utf-8');

		// Verify: After moving B up, it should be before C
		// The update-ref for feature-b should still follow Commit B
		const lines = updatedContent.split('\n').filter(l => l.trim() && !l.startsWith('#'));

		// Find positions of key entries
		const commitBIndex = lines.findIndex(l => l.includes('Commit B'));
		const updateRefBIndex = lines.findIndex(l => l.includes('update-ref') && l.includes('feature-b'));

		// update-ref for feature-b should immediately follow Commit B
		expect(updateRefBIndex).toBe(commitBIndex + 1);

		// Signal done and abort to clean up
		await signalEditorDone();
		await signalEditorAbort();
		await Promise.race([rebasePromise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
		currentRebaseContext = null;
	});
});

test.describe('Rebase Merges', () => {
	test.beforeEach(standardSetup);
	test.afterEach(standardTeardown);

	test('enforces read-only mode for rebase with merges', async ({ vscode }) => {
		// Start interactive rebase with --rebase-merges
		const rebaseContext = startInteractiveRebase({ rebaseMerges: true });
		currentRebaseContext = rebaseContext;
		const { rebasePromise, waitForTodoFile, signalEditorDone, signalEditorAbort } = rebaseContext;

		const todoFilePath = await waitForTodoFile();
		await openRebaseEditor(vscode, todoFilePath);

		// Get the webview
		const webviewFrame = await getRebaseWebviewWithRetry(vscode);

		// Check for the read-only banner
		const readOnlyBanner = webviewFrame.locator('.read-only-banner');
		await expect(readOnlyBanner).toBeVisible({ timeout: 3000 });
		await expect(readOnlyBanner).toContainText('merge commits');

		// Signal editor done to keep it open, then abort
		await signalEditorDone();
		await signalEditorAbort();
		await Promise.race([rebasePromise.catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
		currentRebaseContext = null;
	});
});
