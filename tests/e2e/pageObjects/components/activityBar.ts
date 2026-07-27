import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../baseTest.js';
import type { VSCodePage } from '../vscodePage.js';

/**
 * Component for VS Code Activity Bar interactions.
 * The activity bar contains icons for Explorer, Search, Git, Extensions, and custom views.
 */
export class ActivityBar {
	private readonly container: Locator;

	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {
		this.container = page.locator('[id="workbench.parts.activitybar"]');
	}

	/**
	 * Get the activity bar container
	 */
	get locator(): Locator {
		return this.container;
	}

	/**
	 * Get a tab by its accessible name.
	 *
	 * The name normally resolves on the `role="tab"` element itself. On some VS Code forks (Positron)
	 * that element renders with an empty `aria-label` and the accessible name lives only on its inner
	 * `.action-label` anchor, so a plain `getByRole('tab', { name })` matches nothing there. Fall back to
	 * the tab that *contains* a descendant carrying that name (the inner anchor exists on VS Code too, so
	 * this resolves on every editor); `.first()` keeps a single element for `.click()`/`getAttribute`.
	 */
	getTab(name: string | RegExp, exact = true): Locator {
		return this.container
			.getByRole('tab', { name: name, exact: exact })
			.or(this.container.getByRole('tab').filter({ has: this.page.getByLabel(name, { exact: exact }) }))
			.first();
	}

	/**
	 * Get all tabs matching a pattern
	 */
	getTabs(name: string | RegExp): Locator {
		return this.container.getByRole('tab', { name: name });
	}

	/**
	 * Click a tab to activate its view
	 */
	async clickTab(name: string | RegExp, exact = true): Promise<void> {
		await this.getTab(name, exact).click();
	}

	/**
	 * Open a tab's view, only clicking if not already active.
	 * This prevents accidentally closing an already-open sidebar.
	 */
	async openTab(name: string | RegExp, exact = true): Promise<void> {
		const tab = this.getTab(name, exact);
		const isActive = await tab.getAttribute('aria-checked');
		if (isActive !== 'true') {
			await tab.click();
		}
	}

	/**
	 * Check if a tab is visible
	 */
	async isTabVisible(name: string | RegExp, exact = true): Promise<boolean> {
		return this.getTab(name, exact).isVisible();
	}

	/**
	 * Wait for a tab to appear
	 */
	async waitForTab(name: string | RegExp, exact = true, timeout = MaxTimeout): Promise<void> {
		await this.getTab(name, exact).waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Count tabs matching a pattern
	 */
	async countTabs(name: string | RegExp): Promise<number> {
		return this.getTabs(name).count();
	}

	// Common VS Code activity bar tabs
	get explorerTab(): Locator {
		return this.getTab(/Explorer/);
	}

	get searchTab(): Locator {
		return this.getTab(/Search/);
	}

	get sourceControlTab(): Locator {
		return this.getTab(/Source Control/);
	}

	get runAndDebugTab(): Locator {
		return this.getTab(/Run and Debug/);
	}

	get extensionsTab(): Locator {
		return this.getTab(/Extensions/);
	}
}
