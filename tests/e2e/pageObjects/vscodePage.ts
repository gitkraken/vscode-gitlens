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

	/**
	 * Write a setting at the user (Global) scope, as the Settings UI would — for specs that have to
	 * exercise BOTH values of a setting in one worker, where the fixture's static `userSettings` can
	 * only pin one. Settings written this way land in the worker's own temp user-data dir, so they
	 * don't leak across workers; a spec that changes one still has to restore it for the specs after it.
	 */
	async updateSetting(section: string, value: unknown): Promise<void> {
		await this.evaluate(
			async (vscode, section, value) => {
				// 1 = ConfigurationTarget.Global — the enum isn't reachable through the evaluator's
				// serialized boundary, and no workspace is guaranteed to be open.
				await vscode.workspace.getConfiguration().update(section, value, 1);
			},
			section,
			value,
		);
	}

	/**
	 * What the active editor tab shows: a diff (with its modified side's file name), a text file (with its name and
	 * the cursor's 0-based line), or something else. Tab inputs are told apart by shape — a diff has `original`/`modified`, a text file a `uri` —
	 * since classes from the API don't survive the evaluator's serialized boundary either.
	 */
	async getActiveEditorState(): Promise<{ kind: 'diff' | 'text' | 'other' | 'none'; file?: string; line?: number }> {
		return this.evaluate(vscode => {
			const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
				| { original?: Uri; modified?: Uri; uri?: Uri }
				| undefined;
			if (input == null) return { kind: 'none' as const };
			if (input.original != null && input.modified != null) {
				return { kind: 'diff' as const, file: input.modified.path.split('/').pop() };
			}

			// Custom and notebook tabs carry a `uri` too — only a matching text editor makes the tab a text one
			const editor = vscode.window.activeTextEditor;
			if (input.uri == null || editor?.document.uri.toString() !== input.uri.toString()) {
				return { kind: 'other' as const };
			}

			return {
				kind: 'text' as const,
				file: input.uri.path.split('/').pop(),
				line: editor.selection.active.line,
			};
		});
	}

	/** The host editor's URI scheme (e.g. `vscode`, `cursor`, `windsurf`, `kiro`) */
	async getUriScheme(): Promise<string> {
		return this.evaluate(vscode => vscode.env.uriScheme);
	}

	/** The editor's resolved display language — what GitLens' own l10n catalog selection keys off. */
	async getLanguage(): Promise<string> {
		return this.evaluate(vscode => vscode.env.language);
	}

	/**
	 * Whether the editor renders a standard VS Code activity bar. Some forks replace it with a
	 * bespoke UI (e.g. Cursor's unified sidebar), which activity-bar-driven tests can't target.
	 */
	async hasActivityBar(): Promise<boolean> {
		return (await this.page.locator('[id="workbench.parts.activitybar"]').count()) > 0;
	}

	/**
	 * Execute a command only if it is registered. No-ops on editors that don't provide it
	 * (some VS Code forks omit or rename built-in commands, e.g. Cursor lacks
	 * `workbench.action.closeAuxiliaryBar`).
	 */
	async executeCommandIfAvailable<T>(command: string, ...args: any[]): Promise<T | undefined> {
		if (!(await this.hasCommand(command))) return undefined;
		return this.executeCommand<T>(command, ...args);
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
	 * Closes all editors, dismisses notifications, and closes the panel and sidebars
	 */
	async resetUI(): Promise<void> {
		await this.closeAllEditors();
		await this.executeCommand('notifications.clearAll').catch(() => {});
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
