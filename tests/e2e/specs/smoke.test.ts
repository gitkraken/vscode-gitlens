/**
 * GitLens Smoke Tests
 *
 * Uses page objects provided by baseTest for cleaner, more maintainable E2E tests.
 */
import { expect, MaxTimeout, test } from '../baseTest';

test.describe('GitLens Smoke Test', () => {
	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should contain GitLens & GitLens Inspect icons in activity bar', async ({ vscode }) => {
		const tabCount = await vscode.gitlens.getActivityBarTabCount();
		expect(tabCount).toBeGreaterThanOrEqual(1);
	});

	test('should show GitLens views', async ({ vscode }) => {
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
			await expect(vscode.gitlens.sidebar.getTreeItem(/^Commits/i)).toBeVisible({ timeout: MaxTimeout });

			await vscode.gitlens.showWorktreesView();
			// Worktrees view might show a welcome view if no worktrees exist, or the tree item if they do
			const worktreesTreeItem = vscode.gitlens.sidebar.getTreeItem(/^Worktrees/i);
			const worktreesWelcome = vscode.page.getByRole('button', { name: /Create Worktree/i });
			await expect(worktreesTreeItem.or(worktreesWelcome).first()).toBeVisible({ timeout: MaxTimeout });

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

	test('should show GitLens Inspect views when clicking GitLens Inspect icon', async ({ vscode }) => {
		// open a file (package.json)
		await vscode.gitlens.openFile('package.json');

		// open inspect
		await vscode.gitlens.openGitLensInspect();

		await expect(vscode.gitlens.inspectViewSection).toBeVisible({ timeout: MaxTimeout });

		const inspectWebview = await vscode.gitlens.inspectViewWebview;
		expect(inspectWebview).not.toBeNull();
		// Verify the Inspect webview has loaded with the commit details app
		await expect(inspectWebview!.locator('gl-commit-details-app')).toBeVisible({ timeout: MaxTimeout });

		// open the file history view
		await vscode.gitlens.showFileHistoryView();
		await expect(vscode.gitlens.fileHistoryViewSection).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.fileHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.fileHistoryViewTreeView.getByRole('treeitem').first()).toBeVisible({
			timeout: MaxTimeout,
		});

		// open the line history view
		await vscode.gitlens.showLineHistoryView();
		await expect(vscode.gitlens.lineHistoryViewSection).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.lineHistoryViewTreeView).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.lineHistoryViewTreeView.getByRole('treeitem').first()).toBeVisible({
			timeout: MaxTimeout,
		});

		// open the visual file history view
		await vscode.gitlens.showVisualFileHistoryView();
		await expect(vscode.gitlens.visualHistoryViewSection).toBeVisible({ timeout: MaxTimeout });
		const visualHistoryWebview = await vscode.gitlens.visualHistoryViewWebview;
		expect(visualHistoryWebview).not.toBeNull();
		// Verify the Visual File History webview has loaded with the timeline app
		await expect(visualHistoryWebview!.locator('gl-timeline-app')).toBeVisible({ timeout: MaxTimeout });

		// open the search & compare view
		await vscode.gitlens.showSearchAndCompareView();
		await expect(vscode.page.getByRole('button', { name: 'Search Commits...' })).toBeVisible({
			timeout: MaxTimeout,
		});
		await expect(vscode.page.getByRole('button', { name: 'Compare References...' })).toBeVisible({
			timeout: MaxTimeout,
		});
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
		await expect(homeWebview!.getByText(/main/).first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should open commit graph with the command', async ({ vscode }) => {
		await vscode.gitlens.showCommitGraphView();

		await expect(vscode.gitlens.commitGraphViewSection).toBeVisible({ timeout: MaxTimeout });

		// Verify the Commit Graph webview has actual content
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		// Graph may take longer to load and render
		await expect(graphWebview!.getByText('BRANCH / TAG').first()).toBeVisible({ timeout: 30000 });
		await expect(graphWebview!.getByText('COMMIT MESSAGE').first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show GitLens status bar items', async ({ vscode }) => {
		await expect(vscode.gitlens.statusBar.locator).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.commitGraphStatusBarItem).toBeVisible({ timeout: MaxTimeout });
		await expect(vscode.gitlens.launchpadStatusBarItem).toBeVisible({ timeout: MaxTimeout });
	});
});
