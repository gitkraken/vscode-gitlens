import type { Locator, Page } from '@playwright/test';
import type { CodeLens, DocumentSymbol, Hover, MarkdownString, SymbolKind, Uri } from 'vscode';
import { MaxTimeout, ShortTimeout } from '../baseTest.js';
import type { VSCodeEvaluator } from '../fixtures/vscodeEvaluator.js';
import { ActivityBar } from './components/activityBar.js';
import { Panel } from './components/panel.js';
import { QuickPick } from './components/quickPick.js';
import { SecondarySidebar } from './components/secondarySidebar.js';
import { Sidebar } from './components/sidebar.js';
import { StatusBar } from './components/statusBar.js';

export type EditorHoverContent = { value: string; trustedCommands: readonly string[] | boolean };

type GitExtensionExports = {
	getAPI(version: 1): { getRepository(uri: Uri): { inputBox: { value: string } } | null };
};

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

	async isSettingSet(section: string): Promise<boolean> {
		return this.evaluate((vscode, section) => {
			const inspected = vscode.workspace.getConfiguration().inspect(section);
			return inspected?.globalValue !== undefined || inspected?.workspaceValue !== undefined;
		}, section);
	}

	async getSetting<T>(section: string): Promise<T | undefined> {
		return this.evaluate((vscode, section) => vscode.workspace.getConfiguration().get<T>(section), section);
	}

	async updateSetting(section: string, value: unknown): Promise<void> {
		await this.evaluate(
			async (vscode, section, value, remove) => {
				// KEEP: numeric target (1 = Global) — the enum can't cross the evaluator's JSON boundary
				// KEEP: `remove` flag — JSON turns `undefined` into `null`, which VS Code stores instead of removing
				await vscode.workspace.getConfiguration().update(section, remove ? undefined : value, 1);
			},
			section,
			value,
			value === undefined,
		);
	}

	/**
	 * What the active editor tab shows: a diff (with its modified side's file name), a text file (with its name and
	 * the cursor's 0-based line), or something else. Tab inputs are told apart by shape — a diff has `original`/`modified`, a text file a `uri` —
	 * since classes from the API don't survive the evaluator's serialized boundary either.
	 */
	async getActiveEditorState(): Promise<{
		kind: 'diff' | 'text' | 'other' | 'none';
		file?: string;
		original?: string;
		line?: number;
	}> {
		return this.evaluate(vscode => {
			const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as
				| { original?: Uri; modified?: Uri; uri?: Uri }
				| undefined;
			if (input == null) return { kind: 'none' as const };
			if (input.original != null && input.modified != null) {
				return {
					kind: 'diff' as const,
					file: input.modified.path.split('/').pop(),
					original: input.original.path.split('/').pop(),
				};
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

	async moveCursorAndGetHovers(
		file: string,
		line: number,
		character: number | 'end',
		cursorLine: number = line,
	): Promise<EditorHoverContent[][]> {
		return this.evaluate(
			async (vscode, file, line, character, cursorLine) => {
				const folder = vscode.workspace.workspaceFolders?.[0];
				if (folder == null) throw new Error('No workspace folder is open');

				const uri = vscode.Uri.joinPath(folder.uri, file);

				const editor = await vscode.window.showTextDocument(uri);
				if (editor.selection.active.line !== cursorLine || !editor.selection.isEmpty) {
					editor.selection = new vscode.Selection(cursorLine, 0, cursorLine, 0);
				}
				editor.revealRange(new vscode.Range(cursorLine, 0, cursorLine, 0));

				const position = new vscode.Position(
					line,
					character === 'end' ? editor.document.lineAt(line).text.length : character,
				);
				const hovers = await vscode.commands.executeCommand<Hover[]>(
					'vscode.executeHoverProvider',
					uri,
					position,
				);
				return hovers.map(h =>
					h.contents.map(c => {
						if (typeof c === 'string') return { value: c, trustedCommands: false };

						const markdown = c as MarkdownString;
						const trusted = markdown.isTrusted;
						return {
							value: markdown.value,
							trustedCommands: typeof trusted === 'object' ? trusted.enabledCommands : Boolean(trusted),
						};
					}),
				);
			},
			file,
			line,
			character,
			cursorLine,
		);
	}

	async insertText(file: string, line: number, character: number, text: string): Promise<void> {
		await this.evaluate(
			async (vscode, file, line, character, text) => {
				const [uri] = await vscode.workspace.findFiles(`**/${file}`, null, 1);
				if (uri == null) throw new Error(`File not found: ${file}`);

				const editor = await vscode.window.showTextDocument(uri);
				await editor.edit(edit => edit.insert(new vscode.Position(line, character), text));
			},
			file,
			line,
			character,
			text,
		);
	}

	async getActiveTabLabel(): Promise<string | undefined> {
		return this.evaluate(vscode => vscode.window.tabGroups.activeTabGroup.activeTab?.label);
	}

	async getActiveEditorText(): Promise<string | undefined> {
		return this.evaluate(vscode => vscode.window.activeTextEditor?.document.getText());
	}

	async getScmInputBoxValue(repoPath: string): Promise<string | undefined> {
		return this.evaluate(async (vscode, repoPath) => {
			const git = (await vscode.extensions.getExtension<GitExtensionExports>('vscode.git')?.activate())?.getAPI(
				1,
			);
			return git?.getRepository(vscode.Uri.file(repoPath))?.inputBox.value;
		}, repoPath);
	}

	async setScmInputBoxValue(repoPath: string, value: string): Promise<void> {
		await this.evaluate(
			async (vscode, repoPath, value) => {
				const git = (
					await vscode.extensions.getExtension<GitExtensionExports>('vscode.git')?.activate()
				)?.getAPI(1);
				const repo = git?.getRepository(vscode.Uri.file(repoPath));
				if (repo == null) throw new Error(`No Git repository open at ${repoPath}`);

				repo.inputBox.value = value;
			},
			repoPath,
			value,
		);
	}

	async getDocumentsInTabs(scheme: string): Promise<{ viewType?: string; text: string }[]> {
		return this.evaluate(async (vscode, scheme) => {
			const documents: { viewType?: string; text: string }[] = [];
			for (const group of vscode.window.tabGroups.all) {
				for (const tab of group.tabs) {
					const input = tab.input as { uri?: Uri; viewType?: string } | undefined;
					if (input?.uri?.scheme !== scheme) continue;

					const document = await vscode.workspace.openTextDocument(input.uri);
					documents.push({ viewType: input.viewType, text: document.getText() });
				}
			}
			return documents;
		}, scheme);
	}

	get editorHover(): Locator {
		return this.page.locator('.monaco-hover:not(.hidden)');
	}

	async showEditorHover(): Promise<void> {
		await this.executeCommand('workbench.action.focusActiveEditorGroup');
		await this.executeCommand('editor.action.showHover');
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

	async getCodeLenses(fileName: string): Promise<EditorCodeLens[]> {
		return this.evaluate(async (vscode, fileName) => {
			const doc = vscode.workspace.textDocuments.find(
				d => d.uri.scheme === 'file' && d.uri.path.endsWith(`/${fileName}`),
			);
			if (doc == null) throw new Error(`Document not open: ${fileName}`);

			const lenses =
				(await vscode.commands.executeCommand<CodeLens[] | undefined>(
					'vscode.executeCodeLensProvider',
					doc.uri,
					// KEEP: resolve count — GitLens sets titles and commands only on resolve
					100,
				)) ?? [];
			return lenses
				.map(l => ({
					line: l.range.start.line,
					title: l.command?.title,
					command: l.command?.command || undefined,
				}))
				.sort((a, b) => a.line - b.line);
		}, fileName);
	}

	async getDocumentSymbolLines(fileName: string): Promise<number[]> {
		return this.evaluate(async (vscode, fileName) => {
			const doc = vscode.workspace.textDocuments.find(
				d => d.uri.scheme === 'file' && d.uri.path.endsWith(`/${fileName}`),
			);
			if (doc == null) throw new Error(`Document not open: ${fileName}`);

			const symbols =
				(await vscode.commands.executeCommand<DocumentSymbol[] | undefined>(
					'vscode.executeDocumentSymbolProvider',
					doc.uri,
				)) ?? [];
			const lines: number[] = [];
			const visit = (s: DocumentSymbol): void => {
				lines.push(s.range.start.line);
				for (const child of s.children ?? []) {
					visit(child);
				}
			};
			for (const s of symbols) {
				visit(s);
			}
			return lines.sort((a, b) => a - b);
		}, fileName);
	}

	async registerDocumentSymbols(fileName: string, symbols: FakeDocumentSymbol[]): Promise<void> {
		await this.evaluate(
			(vscode, fileName, symbols) => {
				const store = globalThis as { __glE2eSymbols?: { dispose(): unknown } };
				store.__glE2eSymbols?.dispose();

				const toSymbol = (s: FakeDocumentSymbol): DocumentSymbol => {
					// KEEP: kind by name — the enum can't cross the evaluator's JSON boundary
					const range = new vscode.Range(s.startLine, 0, s.endLine, 1);
					const symbol = new vscode.DocumentSymbol(s.name, '', vscode.SymbolKind[s.kind], range, range);
					symbol.children = (s.children ?? []).map(toSymbol);
					return symbol;
				};

				store.__glE2eSymbols = vscode.languages.registerDocumentSymbolProvider(
					{ scheme: 'file', pattern: `**/${fileName}` },
					{ provideDocumentSymbols: () => symbols.map(toSymbol) },
				);
			},
			fileName,
			symbols,
		);
	}

	async unregisterDocumentSymbols(): Promise<void> {
		await this.evaluate(() => {
			const store = globalThis as { __glE2eSymbols?: { dispose(): unknown } };
			store.__glE2eSymbols?.dispose();
			store.__glE2eSymbols = undefined;
		});
	}

	async insertLine(fileName: string, line: number, text: string): Promise<void> {
		await this.evaluate(
			async (vscode, fileName, line, text) => {
				const doc = vscode.workspace.textDocuments.find(
					d => d.uri.scheme === 'file' && d.uri.path.endsWith(`/${fileName}`),
				);
				if (doc == null) throw new Error(`Document not open: ${fileName}`);

				const edit = new vscode.WorkspaceEdit();
				edit.insert(doc.uri, new vscode.Position(line, 0), `${text}\n`);
				if (!(await vscode.workspace.applyEdit(edit))) throw new Error(`Edit not applied: ${fileName}`);
			},
			fileName,
			line,
			text,
		);
	}
}

export interface EditorCodeLens {
	line: number;
	title: string | undefined;
	command: string | undefined;
}

export interface FakeDocumentSymbol {
	name: string;
	kind: keyof typeof SymbolKind;
	startLine: number;
	endLine: number;
	children?: FakeDocumentSymbol[];
}
