import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../../baseTest';
import type { VSCodePage } from '../vscodePage';

/** Component for VS Code Secondary Sidebar interactions */
export class SecondarySidebar {
	private readonly container: Locator;
	private readonly toggle: Locator;

	constructor(
		private readonly vscode: VSCodePage,
		private readonly page: Page,
	) {
		this.container = page.locator('[id="workbench.parts.auxiliarybar"]');
		this.toggle = page.getByRole('checkbox', { name: /Toggle Secondary Side Bar/i });
	}

	get locator(): Locator {
		return this.container;
	}

	async isVisible(): Promise<boolean> {
		return this.container.isVisible();
	}

	async close(): Promise<void> {
		await this.vscode.executeCommand('workbench.action.closeAuxiliaryBar', 'View: Close Secondary Side Bar');

		// if (!(await this.isVisible())) return;

		// await this.toggle.click();
		// await this.container.waitFor({ state: 'hidden', timeout: MaxTimeout });
	}

	async open(): Promise<void> {
		await this.vscode.executeCommand('workbench.action.focusAuxiliaryBar', 'View: Focus into Secondary Side Bar');

		// if (await this.isVisible()) return;

		// await this.toggle.click();
		// await this.container.waitFor({ state: 'visible', timeout: MaxTimeout });
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
