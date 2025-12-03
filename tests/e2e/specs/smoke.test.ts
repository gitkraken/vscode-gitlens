/**
 * GitLens Smoke Tests
 *
 * Uses page objects provided by baseTest for cleaner, more maintainable E2E tests.
 */
import type { VSCodeInstance } from './baseTest';
import { expect, launchVSCode, MaxTimeout, test } from './baseTest';

test.describe('GitLens Smoke Test', () => {
	let instance: VSCodeInstance;

	test.beforeAll(async () => {
		instance = await launchVSCode();

		// Wait for GitLens to fully activate
		await instance.gitlens.waitForActivation();
	});

	test.afterAll(async () => {
		await instance.electronApp.close();
	});

	test('should contain GitLens & GitLens Inspect icons in activity bar', async () => {
		// Use the page object to count GitLens-related tabs
		const tabCount = await instance.gitlens.getActivityBarTabCount();
		expect(tabCount).toBe(2);
	});

	test('should open home with the command', async () => {
		// Use the command helper method
		await instance.gitlens.showHomeView();

		// Assert the home section is visible
		await expect(instance.gitlens.homeSection).toBeVisible({ timeout: MaxTimeout });

		// Verify Home webview has actual content by checking for key elements
		// Use content-based lookup instead of fragile index
		const homeWebview = await instance.gitlens.getHomeWebview();
		expect(homeWebview).not.toBeNull();
		// Look for the welcome heading (use first() since there may be multiple headings)
		await expect(homeWebview!.getByRole('heading', { name: /Welcome to the GitLens Home/i })).toBeVisible({
			timeout: MaxTimeout,
		});
		// Should show the current branch (main)
		await expect(homeWebview!.getByText(/main/).first()).toBeVisible({ timeout: MaxTimeout });
	});

	test('should open commit graph with the command', async () => {
		// Use the command helper method
		await instance.gitlens.showCommitGraphView();

		// Assert using the named locator from the page object
		await expect(instance.gitlens.commitGraphSection).toBeVisible({ timeout: MaxTimeout });

		// Verify the Commit Graph webview has actual content
		// Use content-based lookup instead of fragile index
		const graphWebview = await instance.gitlens.getCommitGraphWebview();
		expect(graphWebview).not.toBeNull();
		// The graph should have column headers
		await expect(graphWebview!.getByText('BRANCH / TAG')).toBeVisible({ timeout: MaxTimeout });
		await expect(graphWebview!.getByText('COMMIT MESSAGE')).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show GitLens status bar items', async () => {
		// Check the status bar is visible
		await expect(instance.gitlens.statusBar.locator).toBeVisible({ timeout: MaxTimeout });

		// Check for GitLens-specific status bar item
		await expect(instance.gitlens.commitGraphStatusBarItem).toBeVisible({ timeout: MaxTimeout });
	});

	test('should show GitLens Inspect views when clicking GitLens Inspect icon', async () => {
		// Use the helper method to open GitLens Inspect
		await instance.gitlens.openGitLensInspect();

		// Verify key inspect sections using page object locators
		await expect(instance.gitlens.inspectSection).toBeVisible({ timeout: MaxTimeout });
		await expect(instance.gitlens.visualFileHistorySection).toBeVisible({ timeout: MaxTimeout });

		// Verify Inspect sections show expected content
		// The Search & Compare section should have search and compare buttons
		await expect(instance.page.getByRole('button', { name: 'Search Commits...' })).toBeVisible({
			timeout: MaxTimeout,
		});
		await expect(instance.page.getByRole('button', { name: 'Compare References...' })).toBeVisible({
			timeout: MaxTimeout,
		});
	});
});
