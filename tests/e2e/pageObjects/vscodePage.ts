import type { Locator, Page } from '@playwright/test';
import { MaxTimeout } from '../specs/baseTest';
import { ActivityBar } from './components/activityBar';
import { CommandPalette } from './components/commandPalette';
import { Panel } from './components/panel';
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
	/** Bottom panel component (terminal, output, problems, etc.) */
	readonly panel: Panel;
	/** Status bar component */
	readonly statusBar: StatusBar;
	/** Command palette component */
	readonly commandPalette: CommandPalette;

	constructor(protected readonly page: Page) {
		this.activityBar = new ActivityBar(page);
		this.sidebar = new Sidebar(page);
		this.panel = new Panel(page);
		this.statusBar = new StatusBar(page);
		this.commandPalette = new CommandPalette(page);
	}

	/** The editor area */
	get editorArea(): Locator {
		return this.page.locator('[id="workbench.parts.editor"]');
	}

	// ============================================================================
	// Command Palette
	// ============================================================================

	/**
	 * Execute a command via the command palette with retry logic.
	 * Convenience method that delegates to commandPalette.execute()
	 */
	async executeCommand(command: string, maxRetries = 3): Promise<void> {
		await this.commandPalette.execute(command, maxRetries);
	}

	// ============================================================================
	// Wait Helpers
	// ============================================================================

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
