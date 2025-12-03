import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../specs/baseTest';

/**
 * Component for VS Code Bottom Panel interactions.
 * The panel contains Problems, Output, Debug Console, Terminal, and custom views.
 */
export class Panel {
	private readonly container: Locator;

	constructor(private readonly page: Page) {
		this.container = page.locator('[id="workbench.parts.panel"]');
	}

	/**
	 * Get the panel container
	 */
	get locator(): Locator {
		return this.container;
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

	/**
	 * Open the panel if it's hidden
	 */
	async open(): Promise<void> {
		const isVisible = await this.container.isVisible();
		if (!isVisible) {
			await this.page.keyboard.press('Control+J');
			await this.container.waitFor({ state: 'visible', timeout: MaxTimeout });
		}
	}

	/**
	 * Close the panel
	 */
	async close(): Promise<void> {
		const isVisible = await this.container.isVisible();
		if (isVisible) {
			await this.page.keyboard.press('Control+J');
			await this.container.waitFor({ state: 'hidden', timeout: MaxTimeout });
		}
	}
}
