import type { FrameLocator, Locator } from '@playwright/test';
import { MaxTimeout } from '../specs/baseTest';
import { VSCodePage } from './vscodePage';

/**
 * Page object for GitLens-specific UI interactions.
 * Extends VSCodePage with GitLens views, commands, and components.
 */
export class GitLensPage extends VSCodePage {
	// ============================================================================
	// GitLens Activity Bar
	// ============================================================================

	/** The GitLens activity bar tab */
	get gitlensTab(): Locator {
		return this.activityBar.getTab('GitLens', true);
	}

	/** The GitLens Inspect activity bar tab */
	get gitlensInspectTab(): Locator {
		return this.activityBar.getTab('GitLens Inspect', true);
	}

	/**
	 * Wait for GitLens extension to fully activate
	 * This is indicated by the GitLens activity bar icon becoming visible
	 */
	async waitForActivation(timeout = MaxTimeout): Promise<void> {
		await this.gitlensTab.waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Open the GitLens sidebar and ensure it's visible.
	 * Handles the case where the sidebar may be hidden.
	 * Only clicks the tab if it's not already active (to avoid closing it).
	 */
	async openGitLensSidebar(): Promise<void> {
		await this.sidebar.ensureVisible();
		await this.activityBar.openTab('GitLens', true);
	}

	/**
	 * Open the GitLens Inspect sidebar.
	 * Only clicks the tab if it's not already active (to avoid closing it).
	 */
	async openGitLensInspect(): Promise<void> {
		await this.sidebar.ensureVisible();
		await this.activityBar.openTab('GitLens Inspect', true);
	}

	// ============================================================================
	// GitLens Sidebar Views
	// ============================================================================

	/**
	 * Home section in GitLens sidebar
	 * Note: We search the entire page because the section may appear in
	 * different sidebar containers depending on VS Code's layout state
	 */
	get homeSection(): Locator {
		return this.page.getByRole('button', { name: /Home Section/i });
	}

	/** Launchpad section in GitLens sidebar */
	get launchpadSection(): Locator {
		return this.sidebar.getSection(/Launchpad.*Section/i);
	}

	/** Cloud Patches section in GitLens sidebar */
	get cloudPatchesSection(): Locator {
		return this.sidebar.getSection(/Cloud Patches.*Section/i);
	}

	// ============================================================================
	// GitLens Inspect Views
	// ============================================================================

	/** Inspect section in GitLens Inspect sidebar */
	get inspectSection(): Locator {
		return this.sidebar.getSectionExact('Inspect Section');
	}

	/** Line History section in GitLens Inspect sidebar */
	get lineHistorySection(): Locator {
		return this.sidebar.getSection(/Line History Section/i);
	}

	/** File History section in GitLens Inspect sidebar */
	get fileHistorySection(): Locator {
		return this.sidebar.getSection(/File History Section/i);
	}

	/** Visual File History section in GitLens Inspect sidebar */
	get visualFileHistorySection(): Locator {
		return this.sidebar.getSection(/Visual File History.*Section/i);
	}

	/** Search & Compare section in GitLens Inspect sidebar */
	get searchCompareSection(): Locator {
		return this.sidebar.getSection(/Search & Compare Section/i);
	}

	// ============================================================================
	// GitLens Panel Views (Bottom Panel)
	// ============================================================================

	/**
	 * Get the Commit Graph section button in the panel
	 * Uses anchored regex to avoid matching "Commit Graph Inspect Section"
	 */
	get commitGraphSection(): Locator {
		return this.panel.getSection(/^Commit Graph:.*Section$/i);
	}

	/** Commit Graph Inspect section in the panel */
	get commitGraphInspectSection(): Locator {
		return this.panel.getSection(/Commit Graph Inspect.*Section/i);
	}

	/** GitLens tab in the bottom panel */
	get gitlensPanel(): Locator {
		return this.panel.getTab('GitLens', true);
	}

	// ============================================================================
	// GitLens Status Bar Items
	// ============================================================================

	/** The "Show Commit Graph" status bar button */
	get commitGraphStatusBarItem(): Locator {
		return this.statusBar.getItem(/Show the GitLens Commit Graph/i);
	}

	/** The Launchpad status bar item */
	get launchpadStatusBarItem(): Locator {
		return this.statusBar.getItem(/GitLens Launchpad/i);
	}

	// ============================================================================
	// GitLens Commands
	// ============================================================================

	/**
	 * Open the GitLens Home view via command palette
	 */
	async showHomeView(): Promise<void> {
		await this.executeCommand('GitLens: Show Home View');
	}

	/**
	 * Open the Commit Graph via command palette
	 */
	async showCommitGraphView(): Promise<void> {
		await this.executeCommand('GitLens: Show Commit Graph');
	}

	/**
	 * Open the Visual File History via command palette
	 */
	async showVisualFileHistoryView(): Promise<void> {
		await this.executeCommand('GitLens: Show Visual File History View');
	}

	/**
	 * Open the Commits view via command palette
	 */
	async showCommitsView(): Promise<void> {
		await this.executeCommand('GitLens: Show Commits View');
	}

	/**
	 * Open the Branches view via command palette
	 */
	async showBranchesView(): Promise<void> {
		await this.executeCommand('GitLens: Show Branches View');
	}

	/**
	 * Open the Stashes view via command palette
	 */
	async showStashesView(): Promise<void> {
		await this.executeCommand('GitLens: Show Stashes View');
	}

	/**
	 * Open the Tags view via command palette
	 */
	async showTagsView(): Promise<void> {
		await this.executeCommand('GitLens: Show Tags View');
	}

	/**
	 * Open the Worktrees view via command palette
	 */
	async showWorktreesView(): Promise<void> {
		await this.executeCommand('GitLens: Show Worktrees View');
	}

	/**
	 * Open the Contributors view via command palette
	 */
	async showContributorsView(): Promise<void> {
		await this.executeCommand('GitLens: Show Contributors View');
	}

	/**
	 * Open the Search & Compare view via command palette
	 */
	async showSearchAndCompareView(): Promise<void> {
		await this.executeCommand('GitLens: Show Search & Compare View');
	}

	// ============================================================================
	// GitLens Webview Helpers
	// ============================================================================

	/**
	 * Get a GitLens webview frame locator by index.
	 *
	 * VS Code webviews use nested iframes:
	 * - Outer iframe: The webview container
	 * - Inner iframe#active-frame: The actual webview content
	 * - Inner iframe#pending-frame: Used during webview transitions (ignored)
	 *
	 * WARNING: Index-based access is fragile - prefer content-based methods like
	 * `getWebviewByContent()` when possible.
	 *
	 * @param index - The 0-based index of the webview iframe
	 * @returns A FrameLocator for the webview content
	 * @deprecated Prefer getWebviewByContent() for more reliable webview access
	 */
	getWebviewFrame(index = 0): FrameLocator {
		const outerFrame = this.page.locator('iframe').nth(index).contentFrame();
		return outerFrame.locator('iframe#active-frame').contentFrame();
	}

	/**
	 * Find a webview by looking for specific content inside it.
	 * This is more reliable than index-based access since it doesn't depend on DOM order.
	 *
	 * @param contentText - Text that uniquely identifies the webview content
	 * @param timeout - Timeout in ms for checking each iframe (default: 5000)
	 * @returns A FrameLocator for the matching webview, or null if not found
	 *
	 * @example
	 * // Find the Home webview by its welcome heading
	 * const home = await gitlens.getWebviewByContent('Welcome to the GitLens Home');
	 *
	 * // Find the Commit Graph by its column headers
	 * const graph = await gitlens.getWebviewByContent('BRANCH / TAG');
	 */
	async getWebviewByContent(contentText: string, timeout = 5000): Promise<FrameLocator | null> {
		const iframes = this.page.locator('iframe');
		const count = await iframes.count();

		for (let i = 0; i < count; i++) {
			try {
				const outerFrame = iframes.nth(i).contentFrame();
				const innerFrame = outerFrame.locator('iframe#active-frame').contentFrame();

				// Check if this webview contains the content we're looking for
				const hasContent = await innerFrame.getByText(contentText).first().isVisible({ timeout: timeout });
				if (hasContent) {
					return innerFrame;
				}
			} catch {
				// This iframe might not be a webview or might not be ready, skip it
				continue;
			}
		}
		return null;
	}

	/**
	 * Get the Home webview by finding the one with the welcome heading.
	 */
	async getHomeWebview(): Promise<FrameLocator | null> {
		return this.getWebviewByContent('Welcome to the GitLens Home');
	}

	/**
	 * Get the Commit Graph webview by finding the one with graph column headers.
	 */
	async getCommitGraphWebview(): Promise<FrameLocator | null> {
		return this.getWebviewByContent('BRANCH / TAG');
	}

	// ============================================================================
	// Assertion Helpers
	// ============================================================================

	/**
	 * Check if GitLens is activated (activity bar icon visible)
	 */
	async isActivated(): Promise<boolean> {
		return this.gitlensTab.isVisible();
	}

	/**
	 * Get the count of GitLens-related tabs in the activity bar
	 * Should be 2: GitLens and GitLens Inspect
	 */
	async getActivityBarTabCount(): Promise<number> {
		return this.activityBar.countTabs(/GitLens/);
	}
}
