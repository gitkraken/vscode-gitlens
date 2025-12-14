import type { Locator, Page } from '@playwright/test';
import type { VSCodePage } from '../vscodePage';

/**
 * Component for VS Code Status Bar interactions.
 * The status bar is at the bottom and shows git info, language, encoding, etc.
 */
export class StatusBar {
	private readonly container: Locator;

	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {
		this.container = page.locator('footer[role="status"]');
	}

	/**
	 * Get the status bar container
	 */
	get locator(): Locator {
		return this.container;
	}

	/**
	 * Get a status bar item by name pattern
	 */
	getItem(name: string | RegExp): Locator {
		return this.container.getByRole('button', { name: name });
	}

	/**
	 * Click a status bar item
	 */
	async clickItem(name: string | RegExp): Promise<void> {
		await this.getItem(name).click();
	}

	/**
	 * Check if an item is visible
	 */
	async isItemVisible(name: string | RegExp): Promise<boolean> {
		return this.getItem(name).isVisible();
	}

	/**
	 * Get the left side of the status bar (git branch, problems, etc.)
	 */
	get leftSide(): Locator {
		return this.container.locator('.statusbar-left, [class*="left"]').first();
	}

	/**
	 * Get the right side of the status bar (language, encoding, etc.)
	 */
	get rightSide(): Locator {
		return this.container.locator('.statusbar-right, [class*="right"]').first();
	}

	// Common status bar items
	get branchItem(): Locator {
		return this.getItem(/Checkout Branch/);
	}

	get problemsItem(): Locator {
		return this.getItem(/Problems|No Problems/);
	}

	get notificationsItem(): Locator {
		return this.getItem(/Notifications/);
	}
}
