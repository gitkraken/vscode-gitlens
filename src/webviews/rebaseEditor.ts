'use strict';
import * as paths from 'path';
import * as fs from 'fs';
import {
	CancellationToken,
	commands,
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
import { Container } from '../container';
import { Logger } from '../logger';
import {
	Author,
	Commit,
	IpcMessage,
	onIpcCommand,
	RebaseDidAbortCommandType,
	RebaseDidChangeEntryCommandType,
	RebaseDidChangeNotificationType,
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

const rebaseRegex = /^\s?#\s?Rebase\s([0-9a-f]+?)..([0-9a-f]+?)\sonto\s([0-9a-f]+?)\s.*$/im;
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

	async resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, _token: CancellationToken) {
		const disposables: Disposable[] = [];

		disposables.push(panel.onDidDispose(() => disposables.forEach(d => d.dispose())));

		panel.webview.options = { enableCommandUris: true, enableScripts: true };

		disposables.push(panel.webview.onDidReceiveMessage(e => this.onMessageReceived(document, panel, e)));

		disposables.push(
			workspace.onDidChangeTextDocument(e => {
				if (e.contentChanges.length === 0 || e.document.uri.toString() !== document.uri.toString()) return;

				this.parseEntriesAndSendChange(panel, document);
			}),
		);

		panel.webview.html = await this.getHtml(panel.webview, document);
	}

	private parseEntries(contents: string): RebaseEntry[];
	private parseEntries(document: TextDocument): RebaseEntry[];
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

		return entries;
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
		const repoPath = await Container.git.getRepoPath(paths.join(document.uri.fsPath, '../../..'));
		const branch = await Container.git.getBranch(repoPath);

		const contents = document.getText();
		const entries = this.parseEntries(contents);
		const [, onto] = rebaseRegex.exec(contents) ?? ['', '', ''];

		const authors = new Map<string, Author>();
		const commits: Commit[] = [];

		let commit = await Container.git.getCommit(repoPath!, onto);
		if (commit != null) {
			if (!authors.has(commit.author)) {
				authors.set(commit.author, {
					author: commit.author,
					avatarUrl: commit.getAvatarUri(Container.config.defaultGravatarsStyle).toString(true),
					email: commit.email,
				});
			}

			commits.push({
				ref: commit.ref,
				author: commit.author,
				date: commit.formatDate(Container.config.defaultDateFormat),
				dateFromNow: commit.formatDateFromNow(),
				message: commit.message,
				// command: `command:${Commands.ShowQuickCommitDetails}`,
				// command: ShowQuickCommitDetailsCommand.getMarkdownCommandArgs({
				// 	sha: commit.ref,
				// }),
			});
		}

		for (const entry of entries) {
			commit = await Container.git.getCommit(repoPath!, entry.ref);
			if (commit == null) continue;

			if (!authors.has(commit.author)) {
				authors.set(commit.author, {
					author: commit.author,
					avatarUrl: commit.getAvatarUri(Container.config.defaultGravatarsStyle).toString(true),
					email: commit.email,
				});
			}

			commits.push({
				ref: commit.ref,
				author: commit.author,
				date: commit.formatDate(Container.config.defaultDateFormat),
				dateFromNow: commit.formatDateFromNow(),
				message: commit.message,
				// command: `command:${Commands.ShowQuickCommitDetails}`,
				// command: ShowQuickCommitDetailsCommand.getMarkdownCommandArgs({
				// 	sha: commit.ref,
				// }),
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

	private onMessageReceived(document: TextDocument, panel: WebviewPanel, e: IpcMessage) {
		switch (e.method) {
			// case ReadyCommandType.method:
			// 	onIpcCommand(ReadyCommandType, e, params => {
			// 		this.parseDocumentAndSendChange(panel, document);
			// 	});

			// 	break;

			case RebaseDidStartCommandType.method:
				onIpcCommand(RebaseDidStartCommandType, e, async _params => {
					await document.save();
					await commands.executeCommand('workbench.action.closeActiveEditor');
				});

				break;

			case RebaseDidAbortCommandType.method:
				onIpcCommand(RebaseDidAbortCommandType, e, async _params => {
					// Delete the contents to abort the rebase
					const edit = new WorkspaceEdit();
					edit.replace(document.uri, new Range(0, 0, document.lineCount, 0), '');
					await workspace.applyEdit(edit);
					await document.save();
					await commands.executeCommand('workbench.action.closeActiveEditor');
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

					const edit = new WorkspaceEdit();
					edit.replace(document.uri, range, `${params.action} ${entry.ref} ${entry.message}`);
					await workspace.applyEdit(edit);
				});

				break;

			case RebaseDidMoveEntryCommandType.method:
				onIpcCommand(RebaseDidMoveEntryCommandType, e, async params => {
					const entries = this.parseEntries(document);

					const entry = entries.find(e => e.ref === params.ref);
					if (entry == null) return;

					const index = entries.findIndex(e => e.ref === params.ref);
					if ((!params.down && index === 0) || (params.down && index === entries.length - 1)) {
						return;
					}

					const start = document.positionAt(entry.index);
					const range = document.validateRange(
						new Range(new Position(start.line, 0), new Position(start.line + 1, 0)),
					);

					const edit = new WorkspaceEdit();
					edit.delete(document.uri, range);
					edit.insert(
						document.uri,
						new Position(range.start.line + (params.down ? 2 : -1), 0),
						`${entry.action} ${entry.ref} ${entry.message}\n`,
					);
					await workspace.applyEdit(edit);
				});

				break;
		}
	}

	private _html: string | undefined;
	private async getHtml(webview: Webview, document: TextDocument): Promise<string> {
		const filename = Container.context.asAbsolutePath(paths.join('dist/webviews/', 'rebase.html'));

		let content;
		// When we are debugging avoid any caching so that we can change the html and have it update without reloading
		if (Logger.isDebugging) {
			content = await new Promise<string>((resolve, reject) => {
				fs.readFile(filename, 'utf8', (err, data) => {
					if (err) {
						reject(err);
					} else {
						resolve(data);
					}
				});
			});
		} else {
			if (this._html !== undefined) return this._html;

			const doc = await workspace.openTextDocument(filename);
			content = doc.getText();
		}

		let html = content
			.replace(/#{cspSource}/g, webview.cspSource)
			.replace(
				/#{root}/g,
				Uri.file(Container.context.asAbsolutePath('.')).with({ scheme: 'vscode-resource' }).toString(),
			);

		const bootstrap = await this.parseState(document);

		html = html.replace(
			/#{endOfBody}/i,
			`<script type="text/javascript" nonce="Z2l0bGVucy1ib290c3RyYXA=">window.bootstrap = ${JSON.stringify(
				bootstrap,
			)};</script>`,
		);

		this._html = html;
		return html;
	}
}
