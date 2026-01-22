import type { FrameLocator, Locator } from '@playwright/test';
import type { SimulationState } from '../../../src/plus/gk/__debug__accountDebug.js';
import { MaxTimeout, ShortTimeout } from '../baseTest.js';
import { VSCodePage } from './vscodePage.js';

/**
 * Page object for GitLens-specific UI interactions.
 * Extends VSCodePage with GitLens views, commands, and components.
 */
export class GitLensPage extends VSCodePage {
	async isActivated(): Promise<boolean> {
		return this.gitlensTab.isVisible();
	}

	/**
	 * Simulate a subscription state for testing Pro features.
	 * This allows tests to access Pro-gated features like worktrees.
	 *
	 * The debug module is loaded asynchronously after extension activation,
	 * so we retry the command until it succeeds.
	 *
	 * @param state - Subscription state
	 */
	async startSubscriptionSimulation(
		state: SimulationState = { state: 6 /*SubscriptionState.Paid*/, planId: 'pro' },
	): Promise<{ success: boolean } & Disposable> {
		if (!(await this.waitForCommand('gitlens.plus.simulateSubscription'))) {
			throw new Error('gitlens.plus.simulateSubscription command not found');
		}

		const success = await this.executeCommand<boolean>('gitlens.plus.simulateSubscription', state);
		// Wait for the subscription change event to propagate through the system
		await this.page.waitForTimeout(ShortTimeout);
		return {
			success: success,
			[Symbol.dispose]: async () => {
				await this.stopSubscriptionSimulation();
			},
		};
	}

	async stopSubscriptionSimulation(): Promise<void> {
		await this.executeCommand('gitlens.plus.simulateSubscription', { state: null });
	}

	/**
	 * Get the count of GitLens-related tabs in the activity bar
	 * Should be 2: GitLens and GitLens Inspect
	 */
	async getActivityBarTabCount(): Promise<number> {
		return this.activityBar.countTabs(/GitLens/);
	}

	/**
	 * Wait for GitLens extension to fully activate
	 * This is indicated by the GitLens activity bar icon becoming visible
	 */
	async waitForActivation(timeout = MaxTimeout): Promise<void> {
		await this.gitlensTab.waitFor({ state: 'visible', timeout: timeout });
	}

	/** The GitLens activity bar tab */
	get gitlensTab(): Locator {
		return this.activityBar.getTab('GitLens', true);
	}

	/** The GitLens Inspect activity bar tab */
	get gitlensInspectTab(): Locator {
		return this.activityBar.getTab('GitLens Inspect', true);
	}

	/**
	 * Open the GitLens sidebar and ensure it's visible.
	 * Handles the case where the sidebar may be hidden.
	 * Only clicks the tab if it's not already active (to avoid closing it).
	 */
	async openGitLensSidebar(): Promise<void> {
		await this.sidebar.open();
		await this.activityBar.openTab('GitLens', true);
	}

	/**
	 * Open the GitLens Inspect sidebar.
	 * Only clicks the tab if it's not already active (to avoid closing it).
	 */
	async openGitLensInspect(): Promise<void> {
		await this.sidebar.open();
		await this.activityBar.openTab('GitLens Inspect', true);
	}

	// ============================================================================
	// GitLens Sidebar Views
	// ============================================================================

	/** Home section in GitLens sidebar */
	get homeViewSection(): Locator {
		return this.sidebar.getSection(/Home Section/i);
	}

	/** Home webview in GitLens sidebar */
	get homeViewWebview(): Promise<FrameLocator | null> {
		return this.getGitLensWebview('Home', 'webviewView');
	}

	async showHomeView(): Promise<void> {
		await this.executeCommand('gitlens.showHomeView');
	}

	/** Launchpad section in GitLens sidebar */
	get launchpadViewSection(): Locator {
		return this.sidebar.getSection(/Launchpad.*Section/i);
	}

	/** Launchpad tree in GitLens sidebar */
	get launchpadViewTreeView(): Locator {
		return this.sidebar.getTree(/^Launchpad/i);
	}

	async showLaunchpadView(): Promise<void> {
		await this.executeCommand('gitlens.showLaunchpad');
	}

	// ============================================================================
	// GitLens Inspect Views
	// ============================================================================

	/** Inspect section in GitLens Inspect sidebar */
	get inspectViewSection(): Locator {
		return this.sidebar.getSection(/^Inspect/);
	}

	/** Inspect webview in GitLens Inspect sidebar */
	get inspectViewWebview(): Promise<FrameLocator | null> {
		return this.getGitLensWebview('Inspect', 'webviewView');
	}

	/** Line History section in GitLens Inspect sidebar */
	get lineHistoryViewSection(): Locator {
		return this.sidebar.getSection(/^Line History/i);
	}

	/** Line History tree in GitLens Inspect sidebar */
	get lineHistoryViewTreeView(): Locator {
		return this.sidebar.getTree(/^Line History/i);
	}

	async showLineHistoryView(): Promise<void> {
		await this.executeCommand('gitlens.showLineHistoryView');
	}

	/** File History section in GitLens Inspect sidebar */
	get fileHistoryViewSection(): Locator {
		return this.sidebar.getSection(/^File History/i);
	}

	/** File History tree in GitLens Inspect sidebar */
	get fileHistoryViewTreeView(): Locator {
		return this.sidebar.getTree(/^File History/i);
	}

	async showFileHistoryView(): Promise<void> {
		await this.executeCommand('gitlens.showFileHistoryView');
	}

	/** Visual History section in GitLens Inspect sidebar */
	get visualHistoryViewSection(): Locator {
		return this.sidebar.getSection(/^Visual File History/i);
	}

	/** Visual History webview in GitLens Inspect sidebar */
	get visualHistoryViewWebview(): Promise<FrameLocator | null> {
		return this.getGitLensWebview('Visual File History', 'webviewView');
	}

	async showVisualFileHistoryView(): Promise<void> {
		await this.executeCommand('gitlens.showTimelineView');
	}

	/** Search & Compare section in GitLens Inspect sidebar */
	get searchCompareViewSection(): Locator {
		return this.sidebar.getSection(/^Search & Compare/i);
	}

	/** Search & Compare tree in GitLens Inspect sidebar */
	get searchCompareViewTreeView(): Locator {
		return this.sidebar.getTree(/^Search & Compare/i);
	}

	async showSearchAndCompareView(): Promise<void> {
		await this.executeCommand('gitlens.showSearchAndCompareView');
	}

	// ============================================================================
	// GitLens Panel Views (Bottom Panel)
	// ============================================================================

	/** GitLens tab in the bottom panel */
	get gitlensPanel(): Locator {
		return this.panel.getTab('GitLens', true);
	}

	/** Commit Graph tab in the panel */
	get commitGraphViewSection(): Locator {
		// The Graph view shows as a tab in the panel with text content "Graph"
		return this.panel.locator.locator('text=Graph').first();
	}

	/** Commit Graph webview in the panel */
	get commitGraphViewWebview(): Promise<FrameLocator | null> {
		// Find the GitLens webview with title "Graph"
		return this.getGitLensWebview('Graph', 'webviewView');
	}

	async showCommitGraphView(): Promise<void> {
		await this.executeCommand('gitlens.showGraphView');
	}

	/** Commit Graph Details tab in the panel */
	get commitGraphDetailsViewSection(): Locator {
		return this.panel.getTab(/^Graph Details$/i, false);
	}

	/** Commit Graph Details webview in the panel */
	get commitGraphDetailsViewWebview(): Promise<FrameLocator | null> {
		// Find the GitLens webview with title "Graph Details"
		return this.getGitLensWebview('Graph Details', 'webviewView');
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
	// GitLens View/WebviewView Commands
	// ============================================================================

	async showGitLensView(): Promise<void> {
		await this.executeCommand('gitlens.views.scm.grouped.focus');
	}

	get gitlensViewSection(): Locator {
		return this.sidebar.getSection(/GitLens/i);
	}

	get gitlensViewTreeView(): Locator {
		return this.sidebar.getTree(/GitLens/i);
	}

	async showCommitsView(): Promise<void> {
		await this.executeCommand('gitlens.showCommitsView');
	}

	async showBranchesView(): Promise<void> {
		await this.executeCommand('gitlens.showBranchesView');
	}

	async showRemotesView(): Promise<void> {
		await this.executeCommand('gitlens.showRemotesView');
	}

	async showStashesView(): Promise<void> {
		await this.executeCommand('gitlens.showStashesView');
	}

	async showTagsView(): Promise<void> {
		await this.executeCommand('gitlens.showTagsView');
	}

	async showWorktreesView(): Promise<void> {
		await this.executeCommand('gitlens.showWorktreesView');
	}

	async showContributorsView(): Promise<void> {
		await this.executeCommand('gitlens.showContributorsView');
	}

	// ============================================================================
	// GitLens Webviews
	// ============================================================================

	async getRebaseWebview(): Promise<FrameLocator | null> {
		return this.getGitLensWebview('Interactive Rebase', 'customEditor');
	}

	/**
	 * Get a webview frame locator within a specific parent.
	 * This avoids needing to know specific content inside the webview.
	 *
	 * @param parent - The parent locator to search within
	 * @param timeout - Timeout in ms
	 * @returns A FrameLocator for the webview content, or null if not found
	 */
	async getWebview(parent: Locator, timeout = MaxTimeout / 2): Promise<FrameLocator | null> {
		const startTime = Date.now();
		while (Date.now() - startTime < timeout) {
			const iframes = parent.locator('iframe');
			const count = await iframes.count();

			for (let i = 0; i < count; i++) {
				try {
					const outerFrame = iframes.nth(i).contentFrame();
					const activeFrame = outerFrame.locator('iframe#active-frame');
					if ((await activeFrame.count()) > 0) {
						return activeFrame.contentFrame();
					}
				} catch {
					continue;
				}
			}
			await this.page.waitForTimeout(ShortTimeout);
		}
		return null;
	}

	/**
	 * Find a GitLens webview by its title.
	 * VS Code renders webviews outside their logical containers, so we search all webviews
	 * and identify the correct one by:
	 * 1. The outer iframe src containing extensionId=eamodio.gitlens and purpose=webviewView/webviewPanel
	 * 2. The inner iframe#active-frame having the specified title attribute
	 *
	 * @param title - The title of the webview (e.g., "Graph", "Graph Details", "Home")
	 * @param purpose - The purpose of the webview (e.g., "webviewView", "webviewPanel")
	 * @param timeout - Timeout in ms
	 * @returns A FrameLocator for the matching webview content, or null if not found
	 */
	async getGitLensWebview(
		title: string,
		purpose: 'webviewView' | 'webviewPanel' | 'customEditor',
		timeout = MaxTimeout / 2,
	): Promise<FrameLocator | null> {
		let iterations = 0;
		let usePurpose = true;

		const startTime = Date.now();
		while (Date.now() - startTime < timeout) {
			// Find GitLens webview iframes
			const iframes = this.page.locator(
				usePurpose && purpose === 'webviewView'
					? `iframe.webview[src*="extensionId=eamodio.gitlens"][src*="purpose=${purpose}"]`
					: `iframe.webview[src*="extensionId=eamodio.gitlens"]`,
			);

			iterations++;
			const count = await iframes.count();
			if (count !== 0) {
				for (let i = 0; i < count; i++) {
					try {
						const outerFrame = iframes.nth(i).contentFrame();
						// Use partial match for title to handle cases where branch name is appended (e.g. "Interactive Rebase (main)")
						const activeFrame = outerFrame.locator(`iframe#active-frame[title*="${title}"]`);
						if ((await activeFrame.count()) > 0) {
							return activeFrame.contentFrame();
						}
					} catch {
						continue;
					}
				}
			} else if (purpose === 'webviewView') {
				// There is a VS Code issue where sometimes WebviewViews don't always get their purpose set (seems to happen after hiding and re-showing)
				// So alternate using purpose filter every other iteration (use it on odd iterations: 1, 3, 5...)
				usePurpose = iterations % 2 === 1;
				continue;
			}
			await this.page.waitForTimeout(ShortTimeout);
		}
		return null;
	}
}
