import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../baseTest';
import type { VSCodePage } from '../vscodePage';

/** Component for VS Code Bottom Panel interactions */
export class Panel {
	private readonly container: Locator;
	private readonly toggle: Locator;

	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {
		this.container = page.locator('[id="workbench.parts.panel"]');
		this.toggle = page.getByRole('checkbox', { name: /Toggle Panel/i });
	}

	get locator(): Locator {
		return this.container;
	}

	async isVisible(): Promise<boolean> {
		return this.container.isVisible();
	}

	async close(): Promise<void> {
		await this.vscode.executeCommand('workbench.action.closePanel', 'View: Hide Panel');

		// if (!(await this.isVisible())) return;

		// await this.toggle.click();
		// await this.container.waitFor({ state: 'hidden', timeout: MaxTimeout });
	}

	async open(): Promise<void> {
		await this.vscode.executeCommand('workbench.action.focusPanel', 'View: Focus into Panel');

		// if (await this.isVisible()) return;

		// await this.toggle.click();
		// await this.container.waitFor({ state: 'visible', timeout: MaxTimeout });
	}

	/**
	 * Get the tablist in the panel
	 */
	get tablist(): Locator {
		return this.container.getByRole('tablist', { name: 'Active View Switcher' });
	}

	/**
	 * Get a panel tab by name
	 */
	getTab(name: string | RegExp, exact = true): Locator {
		return this.container.getByRole('tab', { name: name, exact: exact });
	}

	/**
	 * Click a panel tab
	 */
	async clickTab(name: string | RegExp, exact = true): Promise<void> {
		await this.getTab(name, exact).click();
	}

	/**
	 * Check if a tab is selected
	 */
	async isTabSelected(name: string | RegExp, exact = true): Promise<boolean> {
		const tab = this.getTab(name, exact);
		const expanded = await tab.getAttribute('aria-expanded');
		const selected = await tab.getAttribute('aria-selected');
		return expanded === 'true' || selected === 'true';
	}

	/**
	 * Wait for a tab to appear
	 */
	async waitForTab(name: string | RegExp, exact = true, timeout = MaxTimeout): Promise<void> {
		await this.getTab(name, exact).waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Get a section button in the panel content area
	 */
	getSection(name: string | RegExp): Locator {
		return this.container.getByRole('button', { name: name });
	}

	/**
	 * Get the body of a section by name pattern
	 */
	getSectionBody(name: string | RegExp): Locator {
		return this.getSection(name).locator('xpath=ancestor::div[contains(@class, "pane")]');
	}

	/**
	 * Get the content area of a panel tab (for webview views)
	 * This returns the pane container that holds the webview iframe
	 */
	getTabContent(name: string | RegExp, exact = false): Locator {
		return this.getTab(name, exact).locator(
			'xpath=ancestor::div[contains(@class, "composite")]//div[contains(@class, "pane-body")]',
		);
	}

	/**
	 * Wait for a section to appear
	 */
	async waitForSection(name: string | RegExp, timeout = MaxTimeout): Promise<void> {
		await this.getSection(name).waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Check if a section is visible
	 */
	async isSectionVisible(name: string | RegExp): Promise<boolean> {
		return this.getSection(name).isVisible();
	}

	// Common VS Code panel tabs
	get problemsTab(): Locator {
		return this.getTab(/Problems/);
	}

	get outputTab(): Locator {
		return this.getTab(/Output/);
	}

	get debugConsoleTab(): Locator {
		return this.getTab(/Debug Console/);
	}

	get terminalTab(): Locator {
		return this.getTab(/Terminal/);
	}
}
