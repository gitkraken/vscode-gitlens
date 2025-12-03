import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../specs/baseTest';

/**
 * Component for VS Code Sidebar interactions.
 * The sidebar shows the content of the selected activity bar item.
 */
export class Sidebar {
	private readonly container: Locator;
	private readonly toggle: Locator;

	constructor(private readonly page: Page) {
		this.container = page.locator('[id="workbench.parts.sidebar"]');
		this.toggle = page.getByRole('checkbox', { name: /Toggle Primary Side Bar/i });
	}

	/**
	 * Get the sidebar container
	 */
	get locator(): Locator {
		return this.container;
	}

	/**
	 * Check if the sidebar is visible.
	 * Uses the toggle checkbox state which is more reliable than element visibility.
	 */
	async isVisible(): Promise<boolean> {
		return this.toggle.isChecked();
	}

	/**
	 * Ensure the sidebar is visible.
	 * Shows it if currently hidden.
	 */
	async ensureVisible(): Promise<void> {
		const isVisible = await this.toggle.isChecked();
		if (!isVisible) {
			await this.toggle.click();
			await this.page.waitForTimeout(500);
		}
	}

	/**
	 * Get the sidebar heading (shows which view is active)
	 */
	get heading(): Locator {
		return this.container.getByRole('heading', { level: 2 });
	}

	/**
	 * Get the heading text
	 */
	async getHeadingText(): Promise<string | null> {
		return this.heading.textContent();
	}

	/**
	 * Get a section button by name pattern
	 * Sections are collapsible areas in the sidebar
	 */
	getSection(name: string | RegExp): Locator {
		return this.container.getByRole('button', { name: name });
	}

	/**
	 * Get a section by exact name
	 */
	getSectionExact(name: string): Locator {
		return this.container.getByRole('button', { name: name, exact: true });
	}

	/**
	 * Click a section to expand/collapse it
	 */
	async clickSection(name: string | RegExp): Promise<void> {
		await this.getSection(name).click();
	}

	/**
	 * Check if a section is visible
	 */
	async isSectionVisible(name: string | RegExp): Promise<boolean> {
		return this.getSection(name).isVisible();
	}

	/**
	 * Wait for a section to appear
	 */
	async waitForSection(name: string | RegExp, timeout = MaxTimeout): Promise<void> {
		await this.getSection(name).waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Get a tree view within the sidebar
	 */
	getTree(name?: string): Locator {
		if (name) {
			return this.container.getByRole('tree', { name: name });
		}
		return this.container.getByRole('tree').first();
	}

	/**
	 * Get tree items in the sidebar
	 */
	getTreeItems(): Locator {
		return this.container.getByRole('treeitem');
	}

	/**
	 * Get a specific tree item by name
	 */
	getTreeItem(name: string | RegExp): Locator {
		return this.container.getByRole('treeitem', { name: name });
	}
}
