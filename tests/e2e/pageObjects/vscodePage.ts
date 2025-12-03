import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../baseTest';
import { ActivityBar } from './components/activityBar';
import { CommandPalette } from './components/commandPalette';
import { Panel } from './components/panel';
import { SecondarySidebar } from './components/secondarySidebar';
import { Sidebar } from './components/sidebar';
import { StatusBar } from './components/statusBar';

/**
 * Base page object for VS Code UI interactions.
 * Provides component-based access to VS Code UI elements.
 */
export class VSCodePage {
	/** Activity bar component (left sidebar icons) */
	readonly activityBar: ActivityBar;
	/** Primary sidebar component */
	readonly sidebar: Sidebar;
	/** Secondary sidebar component */
	readonly secondarySidebar: SecondarySidebar;
	/** Bottom panel component (terminal, output, problems, etc.) */
	readonly panel: Panel;
	/** Status bar component */
	readonly statusBar: StatusBar;
	/** Command palette component */
	readonly commandPalette: CommandPalette;

	constructor(protected readonly page: Page) {
		this.activityBar = new ActivityBar(this, page);
		this.sidebar = new Sidebar(this, page);
		this.secondarySidebar = new SecondarySidebar(this, page);
		this.panel = new Panel(this, page);
		this.statusBar = new StatusBar(this, page);
		this.commandPalette = new CommandPalette(this, page);
	}

	/** The editor area */
	get editorArea(): Locator {
		return this.page.locator('[id="workbench.parts.editor"]');
	}

	/** Close all open editors */
	async closeAllEditors(): Promise<void> {
		await this.page.keyboard.press('Control+K');
		await this.page.keyboard.press('Control+W');
		// await this.executeCommand('View: Close All Editors');
	}

	/** Execute a command via the command palette with retry logic */
	async executeCommand(command: string, maxRetries = 3): Promise<void> {
		await this.commandPalette.execute(command, maxRetries);
	}

	/** Open a file via the command palette */
	async openFile(filename: string): Promise<void> {
		await this.commandPalette.openFile(filename);
	}

	/**
	 * Reset the UI to a clean state
	 * Closes all editors, the panel, and sidebars
	 */
	async resetUI(): Promise<void> {
		await this.closeAllEditors();
		await this.panel.close();
		await this.sidebar.close();
		await this.secondarySidebar.close();
		await this.page.waitForTimeout(500);
	}

	/**
	 * Wait for an element to be visible
	 */
	async waitForVisible(locator: Locator, timeout = MaxTimeout): Promise<void> {
		await locator.waitFor({ state: 'visible', timeout: timeout });
	}

	/**
	 * Wait for an element to be hidden
	 */
	async waitForHidden(locator: Locator, timeout = MaxTimeout): Promise<void> {
		await locator.waitFor({ state: 'hidden', timeout: timeout });
	}
}
