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

	test.beforeAll(async ({ vscode }) => {
		await vscode.gitlens.showCommitGraphView();
		await vscode.gitlens.panel.open();

		const wv = await vscode.gitlens.getGitLensWebview('Graph', 'webviewView', 60000);
		expect(wv).not.toBeNull();
		graphWebview = wv!;

		await expect(graphWebview.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: 30000 });
		await expect(graphWebview.locator('.details-content').first()).toBeVisible({ timeout: 30000 });
	});

	test.afterAll(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	// Exit any active mode after each test
	test.afterEach(async () => {
		const activeChip = graphWebview.locator('gl-action-chip.mode-toggle--active');
		if (await activeChip.isVisible().catch(() => false)) {
			await activeChip.click();
		}
	});

	test('WIP header shows review (checklist) and compose (wand) toggle chips', async () => {
		const header = graphWebview.locator('.graph-details-header');
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
		const header = graphWebview.locator('.graph-details-header--mode-active');
		await expect(header).toBeVisible();

		// Review chip should be active
		const activeChip = graphWebview.locator('gl-action-chip.mode-toggle--active[icon="checklist"]');
		await expect(activeChip).toBeVisible();

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

	test('clicking review chip again exits review mode', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();
		await expect(graphWebview.locator('.review-panel')).toBeVisible({ timeout: MaxTimeout });

		// Click again to toggle off
		await reviewChip.click();

		// Review panel should be gone
		await expect(graphWebview.locator('.review-panel')).not.toBeVisible({ timeout: MaxTimeout });

		// WIP details should be back
		const wipDetails = graphWebview.locator('gl-details-wip-panel');
		await expect(wipDetails).toBeVisible({ timeout: MaxTimeout });

		// Header tint should be gone
		await expect(graphWebview.locator('.graph-details-header--mode-active')).not.toBeVisible();
	});

	test('clicking compose chip enters compose mode with idle state', async () => {
		const composeChip = graphWebview.locator('gl-action-chip[icon="wand"]');
		await composeChip.click();

		const composePanel = graphWebview.locator('.compose-panel');
		await expect(composePanel).toBeVisible({ timeout: MaxTimeout });

		// Compose chip should be active
		const activeChip = graphWebview.locator('gl-action-chip.mode-toggle--active[icon="wand"]');
		await expect(activeChip).toBeVisible();

		// Header should have purple tint
		await expect(graphWebview.locator('.graph-details-header--mode-active')).toBeVisible();
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

		// Switch to compose
		const composeChip = graphWebview.locator('gl-action-chip[icon="wand"]');
		await composeChip.click();

		// Compose should be visible, review should be gone
		await expect(graphWebview.locator('.compose-panel')).toBeVisible({ timeout: MaxTimeout });
		await expect(graphWebview.locator('.review-panel')).not.toBeVisible();

		// Compose chip active, review chip not
		await expect(graphWebview.locator('gl-action-chip.mode-toggle--active[icon="wand"]')).toBeVisible();
		await expect(graphWebview.locator('gl-action-chip.mode-toggle--active[icon="checklist"]')).not.toBeVisible();
	});

	test('can enter and exit modes 3 times consecutively', async () => {
		for (let i = 0; i < 3; i++) {
			const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
			await reviewChip.click();
			await expect(graphWebview.locator('.review-panel')).toBeVisible({ timeout: MaxTimeout });

			await reviewChip.click();
			await expect(graphWebview.locator('.review-panel')).not.toBeVisible({ timeout: MaxTimeout });
		}
	});

	test('header always stays visible in review mode', async () => {
		const reviewChip = graphWebview.locator('gl-action-chip[icon="checklist"]');
		await reviewChip.click();

		// Header should remain visible
		const header = graphWebview.locator('.graph-details-header');
		await expect(header).toBeVisible();

		// Branch row should remain visible
		const branchRow = header.locator('.graph-details-header__branch-row');
		await expect(branchRow).toBeVisible();
	});

	test('sync actions are in the branch row, not the identity row', async () => {
		const branchRow = graphWebview.locator('.graph-details-header__branch-row');
		await expect(branchRow).toBeVisible({ timeout: 30000 });

		// Create branch icon should be in branch row
		const createBranchChip = branchRow.locator('gl-action-chip[icon="git-branch-create"]');
		await expect(createBranchChip).toBeVisible();

		// Review/compose chips should NOT be in branch row
		const reviewInBranch = branchRow.locator('gl-action-chip[icon="checklist"]');
		await expect(reviewInBranch).not.toBeVisible();
	});
});
