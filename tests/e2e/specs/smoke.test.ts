/**
 * GitLens Smoke Tests
 *
 * Uses page objects provided by baseTest for cleaner, more maintainable E2E tests.
 * Uses a purpose-built test repository for consistent, self-contained tests.
 */
import * as process from 'node:process';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

// Configure vscodeOptions with setup callback to create a purpose-built test repository
const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				// Create a file with multiple commits for file/line history testing
				await git.commit('Add test file', 'test-file.txt', 'Initial content\nLine 2\nLine 3');
				await git.commit(
					'Update test file',
					'test-file.txt',
					'Updated content\nLine 2 modified\nLine 3\nLine 4',
				);
				await git.commit(
					'Add more content',
					'test-file.txt',
					'Updated content\nLine 2 modified\nLine 3\nLine 4\nLine 5',
				);

				// Create a feature branch
				await git.branch('feature-branch');

				// Create a tag
				await git.tag('v1.0.0', { message: 'Version 1.0.0' });

				// Create some uncommitted changes to stash
				await git.createFile('stash-test.txt', 'stash content');
				await git.stage('stash-test.txt');
				await git.stash('Test stash');

				// Add a remote (fake URL, just for UI testing)
				await git.addRemote('origin', 'https://github.com/test/test-repo.git');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Smoke Tests — Core', () => {
	test.describe.configure({ mode: 'serial' });
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should contain GitLens & GitLens Inspect icons in activity bar', async ({ vscode }) => {
		const tabCount = await vscode.gitlens.getActivityBarTabCount();
		expect(tabCount).toBeGreaterThanOrEqual(1);
	});

	test('should show GitLens status bar items', async ({ vscode }) => {
		await expect(vscode.gitlens.statusBar.locator).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.commitGraphStatusBarItem).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.launchpadStatusBarItem).toBeVisible({ timeout: MaxTimeout });
	});
});

test.describe('Smoke Tests — GitLens views', () => {
	test.describe.configure({ mode: 'serial' });
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should show GitLens views (Community - without Pro subscription)', async ({ vscode }) => {
		await vscode.gitlens.showGitLensView();

		// Click continue if present (it might be the welcome view)
		const continueButton = vscode.page.getByRole('button', { name: 'Continue' });
		if (await continueButton.isVisible()) {
			await continueButton.click();
		}

		// Check if GitLens section is visible (grouped view)
		const gitlensSection = vscode.gitlens.sidebar.getSection(/^GitLens/);
		if (await gitlensSection.isVisible()) {
			await expect(gitlensSection).toBeVisible({ timeout: MaxTimeout });

			if ((await gitlensSection.getAttribute('aria-expanded')) === 'false') {
				await gitlensSection.click();
			}

			// In grouped mode, views are tree items
			await vscode.gitlens.showCommitsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Commits/i)).toBeVisible({ timeout: MaxTimeout });

			// Worktrees view should show Pro gate for Community users (private repos)
			await vscode.gitlens.showWorktreesView();
			// For Community users, expect the Pro trial prompt or unlock message
			const proTrialButton = vscode.page.getByRole('button', { name: /Try GitLens Pro/i });
			const unlockMessage = vscode.page.getByText(/Unlock this feature/i);
			await expect(proTrialButton.or(unlockMessage).first()).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showBranchesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Branches/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showRemotesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Remotes/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showStashesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Stashes/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showTagsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Tags/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showContributorsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Contributors/i)).toBeVisible({ timeout: MaxTimeout });
		}
	});

	test('should show GitLens views (Pro - with simulated Pro subscription)', async ({ vscode }) => {
		// Simulate a Pro subscription for this test
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showGitLensView();

		// Click continue if present (it might be the welcome view)
		const continueButton = vscode.page.getByRole('button', { name: 'Continue' });
		if (await continueButton.isVisible()) {
			await continueButton.click();
		}

		// Check if GitLens section is visible (grouped view)
		const gitlensSection = vscode.gitlens.sidebar.getSection(/^GitLens/);
		if (await gitlensSection.isVisible()) {
			await expect(gitlensSection).toBeVisible({ timeout: MaxTimeout });

			if ((await gitlensSection.getAttribute('aria-expanded')) === 'false') {
				await gitlensSection.click();
			}

			// In grouped mode, views are tree items
			await vscode.gitlens.showCommitsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Commits/i)).toBeVisible({ timeout: MaxTimeout });

			// Worktrees view should show content for Pro users (no gate)
			await vscode.gitlens.showWorktreesView();
			// For Pro users, expect the worktrees tree item or "Create Worktree" welcome button
			const worktreesTreeItem = vscode.gitlens.sidebar.getTreeItem(/^Worktrees/i);
			const worktreesWelcome = vscode.page.getByRole('button', { name: /Create Worktree/i });
			await expect(worktreesTreeItem.or(worktreesWelcome).first()).toBeVisible({ timeout: MaxTimeout });

			// Verify that the Pro gate is NOT shown
			const proTrialButton = vscode.page.getByRole('button', { name: /Try GitLens Pro/i });
			await expect(proTrialButton).not.toBeVisible();

			await vscode.gitlens.showBranchesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Branches/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showRemotesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Remotes/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showStashesView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Stashes/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showTagsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Tags/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showContributorsView();
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Contributors/i)).toBeVisible({ timeout: MaxTimeout });
		}
	});
});

test.describe('Smoke Tests — GitLens Inspect views', () => {
	test.describe.configure({ mode: 'serial' });
	test.beforeEach(async ({ vscode }) => {
		// open the test file (created in setup)
		await vscode.gitlens.openFile('test-file.txt');
	});
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should show GitLens Inspect views when clicking GitLens Inspect icon', async ({ vscode }) => {
		// open inspect
		await vscode.gitlens.openGitLensInspect();
		await expect(vscode.gitlens.inspectViewSection).toBeVisible({ timeout: MaxTimeout });

		const inspectWebview = await vscode.gitlens.inspectViewWebview;
		expect(inspectWebview).not.toBeNull();
		// Verify the Inspect webview has loaded with the commit details app
		await expect(inspectWebview!.locator('gl-commit-details-app')).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show File History view', async ({ vscode }) => {
		// open the file history view
		await vscode.gitlens.showFileHistoryView();
		await expect(vscode.gitlens.fileHistoryViewSection).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.fileHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.fileHistoryViewTreeView.getByRole('treeitem').first()).toBeVisible({
			timeout: MaxTimeout,
		});
	});

	test('should show Line History view', async ({ vscode }) => {
		// open the line history view
		await vscode.gitlens.showLineHistoryView();
		await expect(vscode.gitlens.lineHistoryViewSection).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.lineHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.lineHistoryViewTreeView.getByRole('treeitem').first()).toBeVisible({
			timeout: MaxTimeout,
		});
	});

	test('should show Visual File History view  (Community - without Pro subscription)', async ({ vscode }) => {
		// open the visual file history view
		await vscode.gitlens.showVisualFileHistoryView();
		await expect(vscode.gitlens.visualHistoryViewSection).toBeVisible({ timeout: MaxTimeout });

		const visualHistoryWebview = await vscode.gitlens.visualHistoryViewWebview;
		expect(visualHistoryWebview).not.toBeNull();

		// For Community users, expect the Pro gate (feature-gate component with Try GitLens Pro)
		const featureGate = visualHistoryWebview!.locator('gl-feature-gate');
		const tryProButton = visualHistoryWebview!.getByRole('button', { name: /Try GitLens Pro/i });
		// Could be "Try GitLens Pro" for Community, or the feature gate
		await expect(featureGate.or(tryProButton).first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show Visual File History view (Pro - with simulated Pro subscription)', async ({ vscode }) => {
		// Simulate a Pro subscription for this test
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		// open the visual file history view
		await vscode.gitlens.showVisualFileHistoryView();
		await expect(vscode.gitlens.visualHistoryViewSection).toBeVisible({ timeout: MaxTimeout });

		const visualHistoryWebview = await vscode.gitlens.visualHistoryViewWebview;
		expect(visualHistoryWebview).not.toBeNull();
		// Verify the Visual File History webview has loaded with the timeline app
		await expect(visualHistoryWebview!.locator('gl-timeline-app')).toBeVisible({ timeout: MaxTimeout });

		// Verify that the Pro gate is NOT visible
		const featureGate = visualHistoryWebview!.locator('gl-feature-gate:not([hidden])');
		await expect(featureGate).not.toBeVisible();
	});

	test('should show Search & Compare view', async ({ vscode }) => {
		// open the search & compare view
		await vscode.gitlens.showSearchAndCompareView();
		await expect(vscode.page.getByRole('button', { name: 'Search Commits...' })).toBeVisible({
			timeout: MaxTimeout,
		});
		await expect(vscode.page.getByRole('button', { name: 'Compare References...' })).toBeVisible({
			timeout: MaxTimeout,
		});
	});
});

test.describe('Smoke Tests — Home view', () => {
	test.describe.configure({ mode: 'serial' });
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should open home with the command', async ({ vscode }) => {
		await vscode.gitlens.showHomeView();

		await expect(vscode.gitlens.homeViewSection).toBeVisible({ timeout: MaxTimeout });

		// Verify Home webview has actual content
		const homeWebview = await vscode.gitlens.homeViewWebview;
		expect(homeWebview).not.toBeNull();
		await expect(homeWebview!.getByRole('heading', { name: /Welcome to the GitLens Home/i })).toBeVisible({
			timeout: MaxTimeout,
		});
		// The test repo is on the main branch (default from git init)
		await expect(homeWebview!.getByText(/main/).first()).toBeVisible({ timeout: MaxTimeout });
	});
});

test.describe('Smoke Tests — Commit Graph view', () => {
	test.describe.configure({ mode: 'serial' });
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should show commit graph gate (Community - without Pro subscription)', async ({ vscode }) => {
		await vscode.gitlens.showCommitGraphView();

		await expect(vscode.gitlens.commitGraphViewSection).toBeVisible({ timeout: MaxTimeout });

		// Verify the Commit Graph webview shows the gate for Community users
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();

		// For Community users, expect the Pro gate (feature-gate component with Try GitLens Pro)
		const featureGate = graphWebview!.locator('gl-feature-gate');
		const tryProButton = graphWebview!.getByRole('button', { name: /Try GitLens Pro/i });
		const continueButton = graphWebview!.getByRole('button', { name: /Continue/i });
		// Could be "Try GitLens Pro" for Community, or "Continue" for feature preview
		await expect(featureGate.or(tryProButton).or(continueButton).first()).toBeVisible({ timeout: 30000 });
	});

	test('should show commit graph content (Pro - with simulated Pro subscription)', async ({ vscode }) => {
		// Simulate a Pro subscription for this test
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();

		await expect(vscode.gitlens.commitGraphViewSection).toBeVisible({ timeout: MaxTimeout });

		// Verify the Commit Graph webview has actual content for Pro users
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		// Graph may take longer to load and render
		await expect(graphWebview!.getByText('BRANCH / TAG').first()).toBeVisible({ timeout: 30000 });
		await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: MaxTimeout });

		// Verify that the Pro gate is NOT visible
		const featureGate = graphWebview!.locator('gl-feature-gate:not([hidden])');
		await expect(featureGate).not.toBeVisible();
	});
});
