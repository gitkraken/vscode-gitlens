import type { Locator, Page } from '@playwright/test';
import type { Uri } from 'vscode';
import { MaxTimeout, ShortTimeout } from '../baseTest.js';
import type { VSCodeEvaluator } from '../fixtures/vscodeEvaluator.js';
import { ActivityBar } from './components/activityBar.js';
import { Panel } from './components/panel.js';
import { QuickPick } from './components/quickPick.js';
import { SecondarySidebar } from './components/secondarySidebar.js';
import { Sidebar } from './components/sidebar.js';
import { StatusBar } from './components/statusBar.js';

/**
 * Base page object for VS Code UI interactions.
 * Provides component-based access to VS Code UI elements.
 */
export class VSCodePage {
	/** Activity bar component (left sidebar icons) */
	readonly activityBar: ActivityBar;
	/** Bottom panel component (terminal, output, problems, etc.) */
	readonly panel: Panel;
	/** Quick pick / command palette component */
	readonly quickPick: QuickPick;
	/** Secondary sidebar component */
	readonly secondarySidebar: SecondarySidebar;
	/** Primary sidebar component */
	readonly sidebar: Sidebar;
	/** Status bar component */
	readonly statusBar: StatusBar;

	constructor(
		protected readonly page: Page,
		private readonly evaluate: VSCodeEvaluator['evaluate'],
	) {
		this.activityBar = new ActivityBar(this, page);
		this.panel = new Panel(this, page);
		this.quickPick = new QuickPick(this, page);
		this.secondarySidebar = new SecondarySidebar(this, page);
		this.sidebar = new Sidebar(this, page);
		this.statusBar = new StatusBar(this, page);
	}

	/** The editor area */
	get editorArea(): Locator {
		return this.page.locator('[id="workbench.parts.editor"]');
	}

	/** Close all open editors */
	async closeAllEditors(): Promise<void> {
		// await this.page.keyboard.press('Control+K');
		// await this.page.keyboard.press('Control+W');

		await this.executeCommand('workbench.action.closeAllEditors');
	}

	/** Execute a command via the VS Code API */
	async executeCommand<T>(command: string, ...args: any[]): Promise<T> {
		return this.evaluate(
			(vscode, cmd, ...cmdArgs) => Promise.resolve(vscode.commands.executeCommand(cmd, ...cmdArgs)),
			command,
			...args,
		) as Promise<T>;
	}

	/** Check if a command is registered */
	async hasCommand(command: string): Promise<boolean> {
		return this.evaluate(async (vscode, command) => {
			const commands = await vscode.commands.getCommands();
			return commands.includes(command);
		}, command);
	}

	/** Wait for a VS Code command to be registered */
	async waitForCommand(command: string, maxWaitMs = MaxTimeout / 2): Promise<boolean> {
		const found = await this.evaluate(
			async (vscode, command, maxWaitMs) => {
				const startTime = Date.now();

				while (Date.now() - startTime < maxWaitMs) {
					const commands = await vscode.commands.getCommands();
					if (commands.includes(command)) return true;
				}
				return false;
			},
			command,
			maxWaitMs,
		);
		return found;
	}

	/** Open a file via the VS Code API */
	async openFile(filename: string, exact = false): Promise<void> {
		// await this.commandPalette.openFile(filename);

		await this.evaluate(
			async (vscode, file, exact) => {
				let uri: Uri;
				if (exact) {
					uri = vscode.Uri.file(file);
					vscode.commands.executeCommand('vscode.open', uri);
				} else {
					// Find the file in the workspace
					const files = await vscode.workspace.findFiles(`**/${file}`, null, 1);
					if (!files.length) throw new Error(`File not found: ${file}`);
					uri = files[0];
				}

				vscode.commands.executeCommand('vscode.open', uri);
			},
			filename,
			exact,
		);
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
		await this.page.waitForTimeout(ShortTimeout);
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
