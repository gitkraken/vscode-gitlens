'use strict';
import { TextDecoder } from 'util';
import {
	CancellationToken,
	ConfigurationTarget,
	CustomTextEditorProvider,
	Disposable,
	Position,
	Range,
	TextDocument,
	Uri,
	Webview,
	WebviewPanel,
	window,
	workspace,
	WorkspaceEdit,
} from 'vscode';
import { ShowQuickCommitCommand } from '../commands';
import { configuration } from '../configuration';
import { Container } from '../container';
import { Logger } from '../logger';
import { debug } from '../system';
import {
	Author,
	Commit,
	IpcMessage,
	onIpcCommand,
	RebaseDidAbortCommandType,
	RebaseDidChangeEntryCommandType,
	RebaseDidChangeNotificationType,
	RebaseDidDisableCommandType,
	RebaseDidMoveEntryCommandType,
	RebaseDidStartCommandType,
	RebaseEntry,
	RebaseEntryAction,
	RebaseState,
} from './protocol';

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === Number.MAX_SAFE_INTEGER) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

const rebaseRegex = /^\s?#\s?Rebase\s([0-9a-f]+)(?:..([0-9a-f]+))?\sonto\s([0-9a-f]+)\s.*$/im;
const rebaseCommandsRegex = /^\s?(p|pick|r|reword|e|edit|s|squash|f|fixup|d|drop)\s([0-9a-f]+?)\s(.*)$/gm;

const rebaseActionsMap = new Map<string, RebaseEntryAction>([
	['p', 'pick'],
	['pick', 'pick'],
	['r', 'reword'],
	['reword', 'reword'],
	['e', 'edit'],
	['edit', 'edit'],
	['s', 'squash'],
	['squash', 'squash'],
	['f', 'fixup'],
	['fixup', 'fixup'],
	['d', 'drop'],
	['drop', 'drop'],
]);

export class RebaseEditorProvider implements CustomTextEditorProvider, Disposable {
	private readonly _disposable: Disposable;

	constructor() {
		this._disposable = Disposable.from(
			window.registerCustomEditorProvider('gitlens.rebase', this, {
				webviewOptions: {
					enableFindWidget: true,
				},
			}),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	get enabled(): boolean {
		const associations = configuration.inspectAny<{ viewType: string; filenamePattern: string }[]>(
			'workbench.editorAssociations',
		)?.globalValue;
		if (associations == null || associations.length === 0) return true;

		const association = associations.find(a => a.filenamePattern === 'git-rebase-todo');
		return association != null ? association.viewType === 'gitlens.rebase' : true;
	}

	private _disableAfterNextUse: boolean = false;
	async enableForNextUse() {
		if (!this.enabled) {
			await this.setEnabled(true);
			this._disableAfterNextUse = true;
		}
	}

	async setEnabled(enabled: boolean): Promise<void> {
		this._disableAfterNextUse = false;

		const inspection = configuration.inspectAny<{ viewType: string; filenamePattern: string }[]>(
			'workbench.editorAssociations',
		);

		let associations = inspection?.globalValue;
		if (associations == null || associations.length === 0) {
			if (enabled) return;

			associations = [
				{
					viewType: 'default',
					filenamePattern: 'git-rebase-todo',
				},
			];
		} else {
			const index = associations.findIndex(a => a.filenamePattern === 'git-rebase-todo');
			if (index !== -1) {
				if (enabled) {
					if (associations.length === 1) {
						associations = undefined;
					} else {
						associations.splice(index, 1);
					}
				} else {
					associations[index].viewType = 'default';
				}
			} else if (!enabled) {
				associations.push({
					viewType: 'default',
					filenamePattern: 'git-rebase-todo',
				});
			}
		}

		await configuration.updateAny('workbench.editorAssociations', associations, ConfigurationTarget.Global);
	}

	@debug<RebaseEditorProvider['resolveCustomTextEditor']>({ args: false })
	async resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, _token: CancellationToken) {
		const disposable = Disposable.from(
			panel.onDidDispose(() => disposable.dispose()),
			panel.webview.onDidReceiveMessage(e =>
				this.onMessageReceived({ document: document, panel: panel, disposable: disposable }, e),
			),
			workspace.onDidChangeTextDocument(e => {
				if (e.contentChanges.length === 0 || e.document.uri.toString() !== document.uri.toString()) return;

				this.parseEntriesAndSendChange(panel, document);
			}),
		);

		panel.webview.options = { enableCommandUris: true, enableScripts: true };
		panel.webview.html = await this.getHtml(panel.webview, document);

		if (this._disableAfterNextUse) {
			this._disableAfterNextUse = false;
			void this.setEnabled(false);
		}
	}

	private parseEntries(contents: string): RebaseEntry[];
	private parseEntries(document: TextDocument): RebaseEntry[];
	@debug<RebaseEditorProvider['parseEntries']>({ args: false })
	private parseEntries(contentsOrDocument: string | TextDocument): RebaseEntry[] {
		const contents = typeof contentsOrDocument === 'string' ? contentsOrDocument : contentsOrDocument.getText();

		const entries: RebaseEntry[] = [];

		let match;
		let action;
		let ref;
		let message;

		do {
			match = rebaseCommandsRegex.exec(contents);
			if (match == null) break;

			[, action, ref, message] = match;

			entries.push({
				index: match.index,
				action: rebaseActionsMap.get(action) ?? 'pick',
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				ref: ` ${ref}`.substr(1),
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				message: message == null || message.length === 0 ? '' : ` ${message}`.substr(1),
			});
		} while (true);

		return entries.reverse();
	}

	private parseEntriesAndSendChange(panel: WebviewPanel, document: TextDocument) {
		const entries = this.parseEntries(document);
		void this.postMessage(panel, {
			id: nextIpcId(),
			method: RebaseDidChangeNotificationType.method,
			params: { entries: entries },
		});
	}

	private async parseState(document: TextDocument): Promise<RebaseState> {
		const repoPath = await Container.git.getRepoPath(Uri.joinPath(document.uri, '../../..'));
		const branch = await Container.git.getBranch(repoPath);

		const contents = document.getText();
		const entries = this.parseEntries(contents);
		const [, , , onto] = rebaseRegex.exec(contents) ?? ['', '', ''];

		const authors = new Map<string, Author>();
		const commits: Commit[] = [];

		let commit = await Container.git.getCommit(repoPath!, onto);
		if (commit != null) {
			if (!authors.has(commit.author)) {
				authors.set(commit.author, {
					author: commit.author,
					avatarUrl: (
						await commit.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle })
					).toString(true),
					email: commit.email,
				});
			}

			commits.push({
				ref: commit.ref,
				author: commit.author,
				date: commit.formatDate(Container.config.defaultDateFormat),
				dateFromNow: commit.formatDateFromNow(),
				message: commit.message || 'root',
			});
		}

		for (const entry of entries) {
			commit = await Container.git.getCommit(repoPath!, entry.ref);
			if (commit == null) continue;

			if (!authors.has(commit.author)) {
				authors.set(commit.author, {
					author: commit.author,
					avatarUrl: (
						await commit.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle })
					).toString(true),
					email: commit.email,
				});
			}

			commits.push({
				ref: commit.ref,
				author: commit.author,
				date: commit.formatDate(Container.config.defaultDateFormat),
				dateFromNow: commit.formatDateFromNow(),
				message: commit.message,
			});
		}

		return {
			branch: branch?.name ?? '',
			onto: onto ?? '',
			entries: entries,
			authors: [...authors.values()],
			commits: commits,
			commands: {
				// eslint-disable-next-line no-template-curly-in-string
				commit: ShowQuickCommitCommand.getMarkdownCommandArgs('${commit}', repoPath),
			},
		};
	}

	private async postMessage(panel: WebviewPanel, message: IpcMessage) {
		try {
			const success = await panel.webview.postMessage(message);
			return success;
		} catch (ex) {
			Logger.error(ex);
			return false;
		}
	}

	private onMessageReceived(
		{ document, panel, disposable }: { document: TextDocument; panel: WebviewPanel; disposable: Disposable },
		e: IpcMessage,
	) {
		switch (e.method) {
			// case ReadyCommandType.method:
			// 	onIpcCommand(ReadyCommandType, e, params => {
			// 		this.parseDocumentAndSendChange(panel, document);
			// 	});

			// 	break;

			case RebaseDidDisableCommandType.method:
				onIpcCommand(RebaseDidDisableCommandType, e, async () => {
					await this.abort(document, panel, disposable);
					await this.setEnabled(false);
				});

				break;

			case RebaseDidStartCommandType.method:
				onIpcCommand(RebaseDidStartCommandType, e, async () => {
					await this.rebase(document, panel, disposable);
				});

				break;

			case RebaseDidAbortCommandType.method:
				onIpcCommand(RebaseDidAbortCommandType, e, async () => {
					await this.abort(document, panel, disposable);
				});

				break;

			case RebaseDidChangeEntryCommandType.method:
				onIpcCommand(RebaseDidChangeEntryCommandType, e, async params => {
					const entries = this.parseEntries(document);

					const entry = entries.find(e => e.ref === params.ref);
					if (entry == null) return;

					const start = document.positionAt(entry.index);
					const range = document.validateRange(
						new Range(new Position(start.line, 0), new Position(start.line, Number.MAX_SAFE_INTEGER)),
					);

					// Fake the new set of entries, so we can ensure that the last entry isn't a squash/fixup
					const newEntries = [...entries];
					newEntries.splice(entries.indexOf(entry), 1, {
						...entry,
						action: params.action,
					});

					let squashing = false;

					for (const entry of newEntries) {
						if (entry.action === 'squash' || entry.action === 'fixup') {
							squashing = true;
						} else if (squashing) {
							if (entry.action !== 'drop') {
								squashing = false;
							}
						}
					}

					const edit = new WorkspaceEdit();

					let action = params.action;

					// Ensure that the last entry isn't a squash/fixup
					if (squashing) {
						const lastEntry = newEntries[newEntries.length - 1];
						if (entry.ref === lastEntry.ref) {
							action = 'pick';
						} else {
							const start = document.positionAt(lastEntry.index);
							const range = document.validateRange(
								new Range(
									new Position(start.line, 0),
									new Position(start.line, Number.MAX_SAFE_INTEGER),
								),
							);

							edit.replace(document.uri, range, `pick ${lastEntry.ref} ${lastEntry.message}`);
						}
					}

					edit.replace(document.uri, range, `${action} ${entry.ref} ${entry.message}`);
					await workspace.applyEdit(edit);
				});

				break;

			case RebaseDidMoveEntryCommandType.method:
				onIpcCommand(RebaseDidMoveEntryCommandType, e, async params => {
					const entries = this.parseEntries(document);

					const entry = entries.find(e => e.ref === params.ref);
					if (entry == null) return;

					const index = entries.findIndex(e => e.ref === params.ref);

					let newIndex;
					if (params.relative) {
						if ((params.to === -1 && index === 0) || (params.to === 1 && index === entries.length - 1)) {
							return;
						}

						newIndex = index + params.to;
					} else {
						if (index === params.to) return;

						newIndex = params.to;
					}

					const newEntry = entries[newIndex];
					let newLine = document.positionAt(newEntry.index).line;
					if (newIndex < index) {
						newLine++;
					}

					const start = document.positionAt(entry.index);
					const range = document.validateRange(
						new Range(new Position(start.line, 0), new Position(start.line + 1, 0)),
					);

					// Fake the new set of entries, so we can ensure that the last entry isn't a squash/fixup
					const newEntries = [...entries];
					newEntries.splice(index, 1);
					newEntries.splice(newIndex, 0, entry);

					let squashing = false;

					for (const entry of newEntries) {
						if (entry.action === 'squash' || entry.action === 'fixup') {
							squashing = true;
						} else if (squashing) {
							if (entry.action !== 'drop') {
								squashing = false;
							}
						}
					}

					const edit = new WorkspaceEdit();

					let action = entry.action;

					// Ensure that the last entry isn't a squash/fixup
					if (squashing) {
						const lastEntry = newEntries[newEntries.length - 1];
						if (entry.ref === lastEntry.ref) {
							action = 'pick';
						} else {
							const start = document.positionAt(lastEntry.index);
							const range = document.validateRange(
								new Range(
									new Position(start.line, 0),
									new Position(start.line, Number.MAX_SAFE_INTEGER),
								),
							);

							edit.replace(document.uri, range, `pick ${lastEntry.ref} ${lastEntry.message}`);
						}
					}

					edit.delete(document.uri, range);
					edit.insert(document.uri, new Position(newLine, 0), `${action} ${entry.ref} ${entry.message}\n`);

					await workspace.applyEdit(edit);
				});

				break;
		}
	}

	private async abort(document: TextDocument, panel: WebviewPanel, disposable: Disposable) {
		// Avoid triggering events by disposing them first
		disposable.dispose();

		// Delete the contents to abort the rebase
		const edit = new WorkspaceEdit();
		edit.replace(document.uri, new Range(0, 0, document.lineCount, 0), '');
		await workspace.applyEdit(edit);
		await document.save();
		panel.dispose();
	}

	private async rebase(document: TextDocument, panel: WebviewPanel, disposable: Disposable) {
		// Avoid triggering events by disposing them first
		disposable.dispose();

		await document.save();
		panel.dispose();
	}

	private async getHtml(webview: Webview, document: TextDocument): Promise<string> {
		const uri = Uri.joinPath(Container.context.extensionUri, 'dist', 'webviews', 'rebase.html');
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		let html = content
			.replace(/#{cspSource}/g, webview.cspSource)
			.replace(/#{root}/g, webview.asWebviewUri(Container.context.extensionUri).toString());

		const bootstrap = await this.parseState(document);

		html = html.replace(
			/#{endOfBody}/i,
			`<script type="text/javascript" nonce="Z2l0bGVucy1ib290c3RyYXA=">window.bootstrap = ${JSON.stringify(
				bootstrap,
			)};</script>`,
		);

		return html;
	}
}
