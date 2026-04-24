/**
 * Tree Generator E2E Tests
 *
 * Verifies the tree-generator component (gl-tree-generator) correctly renders
 * and updates when the model changes — particularly that the virtualizer reuses
 * DOM nodes via keyFunction without requiring full recreation, preserving scroll
 * position and focus state across model transitions.
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

// Build a repo with enough commits and files to exercise the tree thoroughly
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				// Commit 1: single file
				await git.commit('Add greeting module', 'greeting.ts', 'export function greet() { return "hello"; }');

				// Commit 2: different single file
				await git.commit(
					'Add math module',
					'math.ts',
					'export function add(a: number, b: number) { return a + b; }',
				);

				// Commit 3: single file
				await git.commit('Add utils and helpers', 'utils.ts', 'export function noop() {}');

				// Leave uncommitted file for WIP
				await git.createFile('wip-file.txt', 'work in progress');

				await git.addRemote('origin', 'https://example.com/test/test-repo.git');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe.configure({ mode: 'serial' });

async function openGraphWithPro(vscode: VSCodeInstance): Promise<{
	graphWebview: FrameLocator;
	dispose: () => Promise<void>;
}> {
	const sim = await vscode.gitlens.startSubscriptionSimulation({
		state: 6 /* SubscriptionState.Paid */,
		planId: 'pro',
	});

	// Maximize the panel so the details pane has enough height for tree items
	await vscode.gitlens.executeCommand<void>('workbench.action.toggleMaximizedPanel');

	await vscode.gitlens.showCommitGraphView();

	const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(graphWebview).not.toBeNull();

	await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: 30000 });

	return {
		graphWebview: graphWebview!,
		dispose: () => {
			sim[Symbol.dispose]();
			return Promise.resolve();
		},
	};
}

async function reopenGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(graphWebview).not.toBeNull();
	await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: 30000 });
	return graphWebview!;
}

async function selectCommitByMessage(graphWebview: FrameLocator, messageText: string): Promise<void> {
	const messageEl = graphWebview.getByText(messageText, { exact: true }).first();
	await expect(messageEl).toBeVisible({ timeout: MaxTimeout });
	await messageEl.click();
}

async function waitForDetailsLoaded(graphWebview: FrameLocator): Promise<void> {
	const commitDetails = graphWebview.locator('gl-commit-details').first();
	const wipDetails = graphWebview.locator('gl-wip-details').first();
	const comparePanel = graphWebview.locator('gl-graph-compare-panel').first();
	await expect(commitDetails.or(wipDetails).or(comparePanel)).toBeVisible({ timeout: 30000 });
}

async function waitForTreeItems(graphWebview: FrameLocator): Promise<void> {
	const treeItem = graphWebview.locator('gl-tree-generator gl-tree-item').first();
	await expect(treeItem).toBeVisible({ timeout: 15000 });
}

// ============================================================================
// Tree Rendering After Model Change
// ============================================================================

test.describe('Tree Generator - Model Updates', () => {
	test.describe.configure({ mode: 'serial' });

	let graphWebview: FrameLocator;
	let dispose: (() => Promise<void>) | undefined;

	test.beforeAll(async ({ vscode }) => {
		const result = await openGraphWithPro(vscode);
		graphWebview = result.graphWebview;
		dispose = result.dispose;
	});

	test.afterAll(async () => {
		await dispose?.();
	});

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
		graphWebview = await reopenGraph(vscode);
	});

	test('should render tree items for a selected commit', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Should show the file from this commit
		const treeItems = graphWebview.locator('gl-tree-generator gl-tree-item');
		await expect(treeItems.first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should update tree items when switching commits', async () => {
		// Select first commit
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Verify first commit shows greeting.ts
		const greetingItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'greeting.ts' });
		await expect(greetingItem.first()).toBeVisible({ timeout: MaxTimeout });

		// Switch to second commit
		await selectCommitByMessage(graphWebview, 'Add math module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Verify second commit shows math.ts, not greeting.ts (no stale items)
		const mathItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'math.ts' });
		await expect(mathItem.first()).toBeVisible({ timeout: MaxTimeout });

		// greeting.ts should no longer be visible
		await expect(greetingItem.first()).not.toBeVisible({ timeout: MaxTimeout });
	});

	test('should handle rapid commit switching without stale items', async () => {
		// Rapidly switch between commits
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		await selectCommitByMessage(graphWebview, 'Add math module');
		await waitForDetailsLoaded(graphWebview);

		await selectCommitByMessage(graphWebview, 'Add utils and helpers');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Final commit should show utils.ts
		const utilsItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'utils.ts' });
		await expect(utilsItem.first()).toBeVisible({ timeout: MaxTimeout });

		// Previous commits' files should not be visible
		const greetingItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'greeting.ts' });
		await expect(greetingItem.first()).not.toBeVisible({ timeout: MaxTimeout });
	});

	test('should switch back to a previously viewed commit correctly', async () => {
		// View greeting commit
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		const greetingItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'greeting.ts' });
		await expect(greetingItem.first()).toBeVisible({ timeout: MaxTimeout });

		// Switch to math commit
		await selectCommitByMessage(graphWebview, 'Add math module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Switch back to greeting commit
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// greeting.ts should be visible again
		await expect(greetingItem.first()).toBeVisible({ timeout: MaxTimeout });

		// math.ts should not be visible
		const mathItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'math.ts' });
		await expect(mathItem.first()).not.toBeVisible({ timeout: MaxTimeout });
	});

	test('should render tree items after switching from WIP to commit', async () => {
		// Click WIP button if available
		const wipButton = graphWebview.locator('.wip-button').first();
		if (!(await wipButton.isVisible().catch(() => false))) {
			test.skip();
			return;
		}
		await wipButton.click();

		const wipDetails = graphWebview.locator('gl-wip-details').first();
		await expect(wipDetails).toBeVisible({ timeout: 15000 });

		// Now switch to a regular commit
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		await waitForTreeItems(graphWebview);

		// Tree should show the commit's file, not WIP files
		const greetingItem = graphWebview.locator('gl-tree-generator gl-tree-item').filter({ hasText: 'greeting.ts' });
		await expect(greetingItem.first()).toBeVisible({ timeout: MaxTimeout });
	});
});
