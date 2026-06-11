/**
 * Review & Compose Sub-Panel Tests — Graph Details Panel
 *
 * Tests the AI review and compose modes within the graph details panel.
 * These modes replace the panel body while keeping the header visible.
 * Since AI providers aren't available in the test environment, tests
 * verify UI structure, state transitions, mode switching, and idle states.
 *
 * All tests run serially on a single VS Code instance.
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Initial commit', 'README.md', '# Test Project');
				await git.commit('Add auth module', 'auth.ts', 'export function login() {}');
				await git.commit('Add session handling', 'session.ts', 'export class Session {}');

				await git.addRemote('origin', 'https://example.com/test/test-repo.git');

				// Leave working changes for WIP testing
				await git.createFile('wip-file.ts', 'export function pending() {}');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Review & Compose Sub-Panels', () => {
	test.describe.configure({ mode: 'serial' });
	test.setTimeout(90000);

	let graphWebview: FrameLocator;
	let dispose: (() => Promise<void>) | undefined;

	async function ensureDetailsPanelOpen(): Promise<void> {
		const toggleButton = graphWebview.locator('gl-button[aria-label$="Details Panel"]').first();
		await expect(toggleButton).toBeVisible({ timeout: MaxTimeout });

		if ((await toggleButton.getAttribute('aria-label')) === 'Show Details Panel') {
			await toggleButton.click();
			await expect(graphWebview.locator('gl-button[aria-label="Hide Details Panel"]').first()).toBeVisible({
				timeout: MaxTimeout,
			});
		}
	}

	async function selectWip(): Promise<void> {
		await ensureDetailsPanelOpen();

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
			await ensureDetailsPanelOpen();
			await expect(existingWipHeader).toBeVisible({ timeout: MaxTimeout });
			return;
		}

		const overviewButton = graphWebview.locator('gl-button[data-action="wip"]').first();
		if (await overviewButton.isVisible().catch(() => false)) {
			await overviewButton.click();
			await ensureDetailsPanelOpen();
			await expect(existingWipHeader).toBeVisible({ timeout: MaxTimeout });
			return;
		}

		// Match the visible WIP row label, not the hidden tooltip-content span that also carries
		// the "Working Changes" text (a plain .first() can pick the hidden tooltip span).
		const wipRow = graphWebview
			.getByText(/Working (Changes|Tree)/)
			.filter({ visible: true })
			.first();
		await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
		await wipRow.click();
		await ensureDetailsPanelOpen();
		await expect(graphWebview.locator('gl-details-wip-header')).toBeVisible({ timeout: MaxTimeout });
	}

	test.beforeAll(async ({ vscode }) => {
		const sim = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});
		dispose = () => {
			sim[Symbol.dispose]();
			return Promise.resolve();
		};

		await vscode.gitlens.showCommitGraphView();
		await vscode.gitlens.panel.open();

		const wv = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 60000);
		expect(wv).not.toBeNull();
		graphWebview = wv!;

		await expect(graphWebview.getByText('BRANCH / TAG').first()).toBeVisible({ timeout: 30000 });
		await expect(graphWebview.locator('.details-content').first()).toBeVisible({ timeout: 30000 });
	});

	test.afterAll(async ({ vscode }) => {
		await dispose?.();
		await vscode.gitlens.resetUI();
	});

	test.beforeEach(async () => {
		await selectWip();
	});

	// Exit any active mode after each test. While a mode is active the mode-toggle chips are
	// removed from the header, so the only way out is the close chip in the mode header.
	test.afterEach(async () => {
		const closeChip = graphWebview.locator('gl-action-chip.mode-close');
		if (await closeChip.isVisible().catch(() => false)) {
			await closeChip.click();
			// Wait for the mode to actually exit before the next test starts, to avoid races.
			await expect(
				graphWebview.locator('gl-details-wip-header gl-details-header .mode-header--active'),
			).not.toBeVisible({ timeout: MaxTimeout });
		}
	});

	test('WIP header shows review (checklist) and compose (wand) toggle chips', async () => {
		const header = graphWebview.locator('gl-details-wip-header gl-details-header');
		await expect(header).toBeVisible({ timeout: 30000 });

		const reviewChip = header.locator('gl-action-chip[icon="checklist"]');
		await expect(reviewChip).toBeVisible();

		const composeChip = header.locator('gl-action-chip[icon="wand"]');
		await expect(composeChip).toBeVisible();
	});

	test('clicking review chip enters review mode with idle state', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();

		const reviewPanel = graphWebview.locator('.review-panel');
		await expect(reviewPanel).toBeVisible({ timeout: MaxTimeout });

		// Header should have purple tint
		const header = graphWebview.locator('gl-details-wip-header gl-details-header .mode-header--active');
		await expect(header).toBeVisible();

		// While a mode is active the mode-toggle chips are removed from the header (the mode
		// identity is carried by the header title instead), so the review chip is no longer shown.
		await expect(
			graphWebview.locator('gl-details-wip-header gl-details-header gl-action-chip[icon="checklist"]'),
		).not.toBeVisible();

		// WIP details and commit bottom should be hidden
		const wipDetails = graphWebview.locator('gl-details-wip-panel');
		await expect(wipDetails).not.toBeVisible();
		const commitBottom = graphWebview.locator('.commit-panel__bottom');
		await expect(commitBottom).not.toBeVisible();
	});

	test('review idle shows explain input with "Start Review" button', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();

		// The gl-ai-input should be present with "Start Review" label
		const explainInput = graphWebview.locator('gl-ai-input[button-label="Start Review"]');
		await expect(explainInput).toBeVisible({ timeout: MaxTimeout });
	});

	test('exiting review mode via the close chip restores WIP details', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();
		await expect(graphWebview.locator('.review-panel')).toBeVisible({ timeout: MaxTimeout });

		// The mode-toggle chips are gone while in a mode; exit via the close chip in the header
		await graphWebview.locator('gl-action-chip.mode-close').first().click();

		// Review panel should be gone
		await expect(graphWebview.locator('.review-panel')).not.toBeVisible({ timeout: MaxTimeout });

		// WIP details should be back
		const wipDetails = graphWebview.locator('gl-details-wip-panel');
		await expect(wipDetails).toBeVisible({ timeout: MaxTimeout });

		// Header tint should be gone
		await expect(
			graphWebview.locator('gl-details-wip-header gl-details-header .mode-header--active'),
		).not.toBeVisible();
	});

	test('clicking compose chip enters compose mode with idle state', async () => {
		const composeChip = graphWebview.locator('gl-action-chip[icon="wand"]');
		await composeChip.click();

		const composePanel = graphWebview.locator('.compose-panel');
		await expect(composePanel).toBeVisible({ timeout: MaxTimeout });

		// While a mode is active the mode-toggle chips are removed, so the compose chip is gone.
		await expect(
			graphWebview.locator('gl-details-wip-header gl-details-header gl-action-chip[icon="wand"]'),
		).not.toBeVisible();

		// Header should have purple tint
		await expect(
			graphWebview.locator('gl-details-wip-header gl-details-header .mode-header--active'),
		).toBeVisible();
	});

	test('compose idle shows explain input with "Compose" button', async () => {
		const composeChip = graphWebview.locator('gl-action-chip[icon="wand"]');
		await composeChip.click();

		const explainInput = graphWebview.locator('gl-ai-input[button-label="Compose"]');
		await expect(explainInput).toBeVisible({ timeout: MaxTimeout });
	});

	test('switching from review to compose replaces the panel body', async () => {
		// Enter review
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();
		await expect(graphWebview.locator('.review-panel')).toBeVisible({ timeout: MaxTimeout });

		// The mode-toggle chips are hidden while a mode is active, so switching means exiting the
		// current mode (close chip) first, then entering the other one.
		await graphWebview.locator('gl-action-chip.mode-close').first().click();
		await expect(graphWebview.locator('.review-panel')).not.toBeVisible({ timeout: MaxTimeout });

		const composeChip = graphWebview.locator('gl-action-chip[icon="wand"]');
		await composeChip.click();

		// Compose should be visible, review should be gone
		await expect(graphWebview.locator('.compose-panel')).toBeVisible({ timeout: MaxTimeout });
		await expect(graphWebview.locator('.review-panel')).not.toBeVisible();
	});

	test('can enter and exit modes 3 times consecutively', async () => {
		for (let i = 0; i < 3; i++) {
			await graphWebview.locator('gl-action-chip[icon="checklist"]').click();
			await expect(graphWebview.locator('.review-panel')).toBeVisible({ timeout: MaxTimeout });

			await graphWebview.locator('gl-action-chip.mode-close').first().click();
			await expect(graphWebview.locator('.review-panel')).not.toBeVisible({ timeout: MaxTimeout });
		}
	});

	test('header always stays visible in review mode', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();

		// Header should remain visible
		const header = graphWebview.locator('gl-details-wip-header gl-details-header');
		await expect(header).toBeVisible();

		// Branch row should remain visible
		const branchRow = header.locator('.graph-details-header__branch-row');
		await expect(branchRow).toBeVisible();
	});

	test('sync actions are in the branch row, not the identity row', async () => {
		const branchRow = graphWebview.locator('.graph-details-header__branch-row');
		await expect(branchRow).toBeVisible({ timeout: 30000 });

		// Create branch icon should be in branch row
		const createBranchChip = branchRow.locator('gl-action-chip[icon="custom-start-work"]');
		await expect(createBranchChip).toBeVisible();

		// Review/compose chips should NOT be in branch row
		const reviewInBranch = branchRow.locator('gl-action-chip[icon="checklist"]');
		await expect(reviewInBranch).not.toBeVisible();
	});
});
