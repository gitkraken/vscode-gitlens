/**
 * Graph Details Panel E2E Tests
 *
 * Tests the embedded details panel in the Commit Graph view, including:
 * - Panel visibility and toggle behavior
 * - Single commit details (author, message, files)
 * - WIP (working changes) mode
 * - Compare mode (multi-select commits)
 * - Split panel layout
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

// Configure with a purpose-built test repository
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				// Create 3 additional commits with distinct files for meaningful details and compare tests
				await git.commit('Add greeting module', 'greeting.ts', 'export function greet() { return "hello"; }');
				await git.commit(
					'Add math module',
					'math.ts',
					'export function add(a: number, b: number) { return a + b; }',
				);
				await git.commit('Add utils module', 'utils.ts', 'export function noop() {}');

				// Leave an uncommitted file for WIP testing
				await git.createFile('wip-file.txt', 'work in progress content');

				// Add a fake remote (non-GitHub host to avoid integration timeouts)
				await git.addRemote('origin', 'https://example.com/test/test-repo.git');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

// All graph details tests run serially on a single VS Code worker instance
test.describe.configure({ mode: 'serial' });

/**
 * Open the graph view with Pro subscription and return the webview FrameLocator.
 * The graph is a Pro feature, so subscription simulation is required.
 */
async function openGraphWithPro(vscode: VSCodeInstance): Promise<{
	graphWebview: FrameLocator;
	dispose: () => Promise<void>;
}> {
	const sim = await vscode.gitlens.startSubscriptionSimulation({
		state: 6 /* SubscriptionState.Paid */,
		planId: 'pro',
	});

	await vscode.gitlens.showCommitGraphView();

	const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(graphWebview).not.toBeNull();

	// Wait for graph to fully render (column headers appear)
	await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: 30000 });

	return {
		graphWebview: graphWebview!,
		dispose: () => {
			sim[Symbol.dispose]();
			return Promise.resolve();
		},
	};
}

/**
 * Re-open the graph view after a resetUI and return a fresh webview FrameLocator.
 */
async function reopenGraph(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const graphWebview = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 30000);
	expect(graphWebview).not.toBeNull();
	await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: 30000 });
	return graphWebview!;
}

/**
 * Select a commit row in the graph by clicking on its message text.
 * Graph rows are rendered by @gitkraken/gitkraken-components with commit messages as visible text.
 */
async function selectCommitByMessage(graphWebview: FrameLocator, messageText: string): Promise<void> {
	const messageEl = graphWebview.getByText(messageText, { exact: true }).first();
	await expect(messageEl).toBeVisible({ timeout: MaxTimeout });
	await messageEl.click();
}

async function ensureDetailsPanelOpen(graphWebview: FrameLocator): Promise<void> {
	const toggleButton = graphWebview.locator('gl-button[aria-label$="Details Panel"]').first();
	await expect(toggleButton).toBeVisible({ timeout: MaxTimeout });

	if ((await toggleButton.getAttribute('aria-label')) === 'Show Details Panel') {
		await toggleButton.click();
		await expect(graphWebview.locator('gl-button[aria-label="Hide Details Panel"]').first()).toBeVisible({
			timeout: MaxTimeout,
		});
	}
}

async function selectWip(graphWebview: FrameLocator): Promise<void> {
	await ensureDetailsPanelOpen(graphWebview);

	const existingWipHeader = graphWebview.locator('gl-details-wip-header gl-details-header').first();
	if (await existingWipHeader.isVisible().catch(() => false)) {
		return;
	}

	const closeButton = graphWebview
		.locator(
			'gl-details-commit-panel gl-action-chip[icon="close"], gl-details-multicommit-panel gl-action-chip[icon="close"]',
		)
		.first();
	if (await closeButton.isVisible().catch(() => false)) {
		await closeButton.click();
		await ensureDetailsPanelOpen(graphWebview);
		await expect(existingWipHeader).toBeVisible({ timeout: MaxTimeout });
		return;
	}

	const overviewButton = graphWebview.locator('gl-button[data-action="wip"]').first();
	if (await overviewButton.isVisible().catch(() => false)) {
		await overviewButton.click();
		await ensureDetailsPanelOpen(graphWebview);
		await expect(existingWipHeader).toBeVisible({ timeout: MaxTimeout });
		return;
	}

	const wipRow = graphWebview.getByText(/Working (Changes|Tree)/).first();
	await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
	await wipRow.click();
	await ensureDetailsPanelOpen(graphWebview);
}

/**
 * Wait for the details panel to show loaded content (commit details, WIP details, or compare panel).
 * RPC services may take significant time to resolve on first load.
 */
async function waitForDetailsLoaded(graphWebview: FrameLocator): Promise<void> {
	await ensureDetailsPanelOpen(graphWebview);

	// Wait for any of the detail sub-components to render (indicates RPC data loaded)
	const commitDetails = graphWebview.locator('gl-details-commit-panel').first();
	const wipDetails = graphWebview.locator('gl-details-wip-panel').first();
	const comparePanel = graphWebview.locator('gl-details-multicommit-panel').first();
	await expect(commitDetails.or(wipDetails).or(comparePanel)).toBeVisible({ timeout: 30000 });
}

// ============================================================================
// Panel Visibility
// ============================================================================

test.describe('Graph Details - Panel Visibility', () => {
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

	test('should show details panel with auto-selected commit on open', async () => {
		// The graph auto-selects the HEAD commit on open, so details should be visible
		await waitForDetailsLoaded(graphWebview);

		// Either commit details or WIP details should be visible (depends on auto-selection)
		const commitDetails = graphWebview.locator('gl-details-commit-panel').first();
		const wipDetails = graphWebview.locator('gl-details-wip-panel').first();
		await expect(commitDetails.or(wipDetails)).toBeVisible({ timeout: 30000 });

		// Toggle button should be visible with an accessible details label
		const toggleButton = graphWebview.locator('gl-button[aria-label$="Details Panel"]');
		await expect(toggleButton).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show details panel when selecting a different commit', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Commit details component should be visible
		await expect(graphWebview.locator('gl-details-commit-panel').first()).toBeVisible({ timeout: MaxTimeout });

		// Toggle button should be visible with "Hide" label
		const toggleButton = graphWebview.locator('gl-button[aria-label="Hide Details Panel"]');
		await expect(toggleButton).toBeVisible({ timeout: MaxTimeout });
	});

	test('should hide details panel when toggle button is clicked', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Click the toggle button to hide
		const hideButton = graphWebview.locator('gl-button[aria-label="Hide Details Panel"]');
		await expect(hideButton).toBeVisible({ timeout: MaxTimeout });
		await hideButton.click();

		// Toggle button should now say "Show"
		const showButton = graphWebview.locator('gl-button[aria-label="Show Details Panel"]');
		await expect(showButton).toBeVisible({ timeout: MaxTimeout });

		// Click again to show
		await showButton.click();

		// Details should reappear
		await expect(graphWebview.locator('gl-details-commit-panel').first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should close details panel via close button', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Click the close action chip in the commit details header
		const closeButton = graphWebview.locator('gl-details-commit-panel gl-action-chip[icon="close"]').first();
		await expect(closeButton).toBeVisible({ timeout: MaxTimeout });
		await closeButton.click();

		// Details content should no longer be visible
		await expect(graphWebview.locator('.details-content')).not.toBeVisible({ timeout: MaxTimeout });
	});
});

// ============================================================================
// Single Commit Details
// ============================================================================

test.describe('Graph Details - Single Commit', () => {
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

	test('should show commit author and message', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Commit details component should be visible
		const commitDetails = graphWebview.locator('gl-details-commit-panel').first();
		await expect(commitDetails).toBeVisible({ timeout: MaxTimeout });

		// Author element should be present
		const author = graphWebview.locator('gl-details-commit-panel gl-commit-author').first();
		await expect(author).toBeVisible({ timeout: MaxTimeout });

		// Commit message should be visible in the embedded message area
		const messageArea = graphWebview.locator('gl-details-commit-panel .message-block__text').first();
		await expect(messageArea).toBeVisible({ timeout: MaxTimeout });
		await expect(messageArea.getByText('Add greeting module')).toBeVisible();

		// Metadata bar with SHA should be present
		const metadataBar = graphWebview.locator('gl-details-commit-panel .metadata-bar').first();
		await expect(metadataBar).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show file changes section for selected commit', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// The embedded split panel holds the message (start) and files section (end).
		// Check for the vertical split panel structure with the files container.
		const embeddedSplit = graphWebview.locator('gl-details-commit-panel gl-split-panel.split').first();
		await expect(embeddedSplit).toBeVisible({ timeout: 15000 });

		// The bottom section (files + autolinks) should exist in the DOM
		const bottomSection = graphWebview.locator('gl-details-commit-panel .bottom-section').first();
		await expect(bottomSection).toBeAttached({ timeout: MaxTimeout });
	});

	test('should update details when switching between commits', async () => {
		// Select first commit
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Verify message changes when switching commits
		const messageArea = graphWebview.locator('gl-details-commit-panel .message-block__text').first();
		await expect(messageArea).toBeVisible({ timeout: MaxTimeout });
		await expect(messageArea.getByText('Add greeting module')).toBeVisible();

		// Select a different commit
		await selectCommitByMessage(graphWebview, 'Add math module');
		await waitForDetailsLoaded(graphWebview);

		// Message should update
		await expect(messageArea.getByText('Add math module')).toBeVisible({ timeout: 15000 });
	});
});

// ============================================================================
// WIP Mode
// ============================================================================

test.describe('Graph Details - WIP Mode', () => {
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

	test('should show working changes when WIP row is selected', async () => {
		await selectWip(graphWebview);

		// WIP details component should appear
		const wipDetails = graphWebview.locator('gl-details-wip-panel').first();
		await expect(wipDetails).toBeVisible({ timeout: 15000 });

		// Should show "Working Changes" title
		const wipTitle = graphWebview.locator('gl-details-wip-header .graph-details-header__wip-title').first();
		await expect(wipTitle).toBeVisible({ timeout: MaxTimeout });
		await expect(wipTitle).toHaveText('Working Changes');
	});

	test('should show WIP header with branch name', async () => {
		await selectWip(graphWebview);

		const wipDetails = graphWebview.locator('gl-details-wip-panel').first();
		await expect(wipDetails).toBeVisible({ timeout: 15000 });

		// The branch row should show the branch name
		const branchRow = graphWebview.locator('gl-details-wip-header .graph-details-header__branch-row').first();
		await expect(branchRow).toBeVisible({ timeout: MaxTimeout });
	});

	test('should close WIP details via close button', async () => {
		await selectWip(graphWebview);

		const wipDetails = graphWebview.locator('gl-details-wip-panel').first();
		await expect(wipDetails).toBeVisible({ timeout: 15000 });

		// Click close button
		const closeButton = graphWebview.locator('gl-details-wip-header gl-action-chip[icon="close"]').first();
		await expect(closeButton).toBeVisible({ timeout: MaxTimeout });
		await closeButton.click();

		// Details content should close
		await expect(graphWebview.locator('.details-content')).not.toBeVisible({ timeout: MaxTimeout });
	});
});

// ============================================================================
// Compare Mode
// ============================================================================

test.describe('Graph Details - Compare Mode', () => {
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

	test('should show compare panel when multi-selecting two commits', async () => {
		// Select first commit normally
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// Ctrl+Click second commit to multi-select
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await expect(secondCommit).toBeVisible({ timeout: MaxTimeout });
		await secondCommit.click({ modifiers: ['Control'] });

		// Compare panel should appear with its header
		const compareHeader = graphWebview.locator('.compare-header__title').first();
		await expect(compareHeader).toBeVisible({ timeout: 15000 });
		await expect(compareHeader).toHaveText('Comparing References');
	});

	test('should show pole cards for both compared commits', async () => {
		// Multi-select two commits
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await secondCommit.click({ modifiers: ['Control'] });

		// Wait for compare panel
		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: 15000 });

		// Two pole cards should be visible
		const poleCards = graphWebview.locator('.pole-card');
		await expect(poleCards.first()).toBeVisible({ timeout: MaxTimeout });
		// Verify we have at least 2 pole cards
		await expect(poleCards.nth(1)).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show swap button in compare mode', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await secondCommit.click({ modifiers: ['Control'] });

		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: 15000 });

		// Swap button should be visible
		const swapButton = graphWebview.locator('button[aria-label="Swap comparison direction"]').first();
		await expect(swapButton).toBeVisible({ timeout: MaxTimeout });

		// Click swap and verify it doesn't error
		await swapButton.click();

		// Compare panel should still be visible after swap
		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show between-count for non-adjacent commits', async () => {
		// Select "Add greeting module" (2nd commit) and "Add utils module" (4th commit)
		// There is 1 commit in between: "Add math module"
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await secondCommit.click({ modifiers: ['Control'] });

		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: 15000 });

		// The between-count should show "1 commit in between"
		const betweenCount = graphWebview.locator('.compare-middle__count').first();
		await expect(betweenCount).toBeVisible({ timeout: MaxTimeout });
		await expect(betweenCount).toContainText('in between');
	});

	test('should close compare panel via close button', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await secondCommit.click({ modifiers: ['Control'] });

		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: 15000 });

		// Click close button in the compare header
		const closeButton = graphWebview
			.locator('gl-details-multicommit-panel gl-details-header gl-action-chip[icon="close"]')
			.first();
		await expect(closeButton).toBeVisible({ timeout: MaxTimeout });
		await closeButton.click();

		// Compare panel should close
		await expect(graphWebview.locator('.compare-header__title')).not.toBeVisible({ timeout: MaxTimeout });
	});

	test('should show changed files section in compare mode', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);
		const secondCommit = graphWebview.getByText('Add utils module', { exact: true }).first();
		await secondCommit.click({ modifiers: ['Control'] });

		await expect(graphWebview.locator('.compare-header__title').first()).toBeVisible({ timeout: 15000 });

		// Changed files section should exist in the DOM (the actual file tree
		// renders inside shadow DOM components which may report as hidden)
		const compareFiles = graphWebview.locator('.compare-files').first();
		await expect(compareFiles).toBeAttached({ timeout: MaxTimeout });

		// webview-pane-group should be present for the files list
		const paneGroup = graphWebview.locator('.compare-files webview-pane-group').first();
		await expect(paneGroup).toBeAttached({ timeout: MaxTimeout });
	});
});

// ============================================================================
// Split Panel
// ============================================================================

test.describe('Graph Details - Split Panel', () => {
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

	test('should show split panel with both panes when details are visible', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// The split panel should be present
		const splitPanel = graphWebview.locator('gl-split-panel.graph__details-split').first();
		await expect(splitPanel).toBeVisible({ timeout: MaxTimeout });

		// Both pane slots should have content
		const graphPane = graphWebview.locator('.graph__graph-pane').first();
		await expect(graphPane).toBeVisible({ timeout: MaxTimeout });

		const detailsPane = graphWebview.locator('.graph__details-pane').first();
		await expect(detailsPane).toBeVisible({ timeout: MaxTimeout });
	});

	test('should have the details panel element inside the end pane', async () => {
		await selectCommitByMessage(graphWebview, 'Add greeting module');
		await waitForDetailsLoaded(graphWebview);

		// gl-graph-details-panel should be inside the details pane
		const detailsPanel = graphWebview.locator('.graph__details-pane gl-graph-details-panel').first();
		await expect(detailsPanel).toBeVisible({ timeout: MaxTimeout });
	});
});
