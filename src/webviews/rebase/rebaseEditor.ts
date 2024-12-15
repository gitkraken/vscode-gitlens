import { getNonce } from '@env/crypto';
import type {
	CancellationToken,
	CustomTextEditorProvider,
	TextDocument,
	WebviewPanel,
	WebviewPanelOnDidChangeViewStateEvent,
} from 'vscode';
import { ConfigurationTarget, Disposable, Position, Range, Uri, window, workspace, WorkspaceEdit } from 'vscode';
import { InspectCommand } from '../../commands/inspect';
import type { Container } from '../../container';
import { emojify } from '../../emojis';
import type { GitCommit } from '../../git/models/commit';
import { createReference } from '../../git/models/reference.utils';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { showRebaseSwitchToTextWarningMessage } from '../../messages';
import { getScopedCounter } from '../../system/counter';
import { debug, log } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { join, map } from '../../system/iterable';
import { Logger } from '../../system/logger';
import { normalizePath } from '../../system/path';
import { executeCoreCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import type { IpcMessage, WebviewFocusChangedParams } from '../protocol';
import { WebviewFocusChangedCommand } from '../protocol';
import { replaceWebviewHtmlTokens, resetContextKeys, setContextKeys } from '../webviewController';
import type {
	Author,
	ChangeEntryParams,
	MoveEntryParams,
	RebaseEntry,
	RebaseEntryAction,
	ReorderParams,
	State,
	UpdateSelectionParams,
} from './protocol';
import {
	AbortCommand,
	ChangeEntryCommand,
	DidChangeNotification,
	DisableCommand,
	MoveEntryCommand,
	ReorderCommand,
	SearchCommand,
	StartCommand,
	SwitchCommand,
	UpdateSelectionCommand,
} from './protocol';

const maxSmallIntegerV8 = 2 ** 30 - 1; // Max number that can be stored in V8's smis (small integers)
const utf8TextDecoder = new TextDecoder('utf8');

const ipcSequencer = getScopedCounter();
const webviewIdGenerator = getScopedCounter();

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

interface RebaseEditorContext {
	dispose(): void;

	readonly id: number;
	readonly document: TextDocument;
	readonly panel: WebviewPanel;
	readonly repoPath: string;
	readonly subscriptions: Disposable[];

	authors?: Map<string, Author>;
	branchName?: string | null;
	commits?: GitCommit[];
	pendingChange?: boolean;

	firstSelection?: boolean;
	fireSelectionChangedDebounced?: Deferrable<RebaseEditorProvider['fireSelectionChanged']> | undefined;
	notifyDidChangeStateDebounced?: Deferrable<RebaseEditorProvider['notifyDidChangeState']> | undefined;
}

export class RebaseEditorProvider implements CustomTextEditorProvider, Disposable {
	private readonly _disposable: Disposable;
	private ascending = false;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			window.registerCustomEditorProvider('gitlens.rebase', this, {
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: {
					enableFindWidget: true,
					retainContextWhenHidden: true,
				},
			}),
		);
		this.ascending = configuration.get('rebaseEditor.ordering') === 'asc';
	}

	dispose() {
		this._disposable.dispose();
	}

	private get contextKeyPrefix() {
		return 'gitlens:webview:rebase' as const;
	}

	get enabled(): boolean {
		const associations = configuration.inspectCore('workbench.editorAssociations')?.globalValue;
		if (associations == null || associations.length === 0) return true;

		if (Array.isArray(associations)) {
			const association = associations.find(a => a.filenamePattern === 'git-rebase-todo');
			return association != null ? association.viewType === 'gitlens.rebase' : true;
		}

		const association = associations['git-rebase-todo'];
		return association != null ? association === 'gitlens.rebase' : true;
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

		const inspection = configuration.inspectCore('workbench.editorAssociations');

		let associations = inspection?.globalValue;
		if (Array.isArray(associations)) {
			associations = associations.reduce<Record<string, string>>((accumulator, current) => {
				accumulator[current.filenamePattern] = current.viewType;
				return accumulator;
			}, Object.create(null));
		}

		if (associations == null) {
			if (enabled) return;

			associations = {
				'git-rebase-todo': 'default',
			};
		} else {
			associations['git-rebase-todo'] = enabled ? 'gitlens.rebase' : 'default';
		}

		await configuration.updateAny('workbench.editorAssociations', associations, ConfigurationTarget.Global);
	}

	@debug<RebaseEditorProvider['resolveCustomTextEditor']>({ args: { 1: false, 2: false } })
	async resolveCustomTextEditor(document: TextDocument, panel: WebviewPanel, _token: CancellationToken) {
		void this.container.usage.track(`rebaseEditor:shown`).catch();

		const repoPath = normalizePath(Uri.joinPath(document.uri, '..', '..', '..').fsPath);
		const repo = this.container.git.getRepository(repoPath);

		const subscriptions: Disposable[] = [];
		const context: RebaseEditorContext = {
			dispose: () => void Disposable.from(...subscriptions).dispose(),

			id: webviewIdGenerator.next(),
			subscriptions: subscriptions,
			document: document,
			panel: panel,
			repoPath: repo?.path ?? repoPath,

			firstSelection: true,
		};

		subscriptions.push(
			panel.onDidDispose(() => {
				resetContextKeys(this.contextKeyPrefix);

				Disposable.from(...subscriptions).dispose();
			}),
			panel.onDidChangeViewState(e => this.onViewStateChanged(context, e)),
			panel.webview.onDidReceiveMessage(e => this.onMessageReceived(context, e)),
			workspace.onDidChangeTextDocument(e => {
				if (e.contentChanges.length === 0 || e.document.uri.toString() !== document.uri.toString()) return;

				this.updateState(context, true);
			}),
			workspace.onDidSaveTextDocument(e => {
				if (e.uri.toString() !== document.uri.toString()) return;

				this.updateState(context, true);
			}),
		);

		if (repo != null) {
			subscriptions.push(
				repo.onDidChange(e => {
					if (!e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) return;

					this.updateState(context);
				}),
			);
		}

		panel.webview.options = { enableCommandUris: true, enableScripts: true };
		panel.webview.html = await this.getHtml(context);

		if (this._disableAfterNextUse) {
			this._disableAfterNextUse = false;
			void this.setEnabled(false);
		}
	}

	@debug<RebaseEditorProvider['onViewFocusChanged']>({
		args: { 0: e => `focused=${e.focused}, inputFocused=${e.inputFocused}` },
	})
	protected onViewFocusChanged(_e: WebviewFocusChangedParams): void {
		setContextKeys(this.contextKeyPrefix);
	}

	@debug<RebaseEditorProvider['onViewStateChanged']>({
		args: {
			0: c => `${c.id}:${c.document.uri.toString(true)}`,
			1: e => `active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}`,
		},
	})
	protected onViewStateChanged(context: RebaseEditorContext, e: WebviewPanelOnDidChangeViewStateEvent): void {
		if (e.webviewPanel.visible) {
			setContextKeys(this.contextKeyPrefix);
		} else {
			resetContextKeys(this.contextKeyPrefix);
		}

		if (!context.pendingChange) return;

		this.updateState(context);
	}

	private async parseState(context: RebaseEditorContext): Promise<State> {
		if (context.branchName === undefined) {
			const branch = await this.container.git.getBranch(context.repoPath);
			context.branchName = branch?.name ?? null;
		}
		const state = await parseRebaseTodo(this.container, context, this.ascending);
		return state;
	}

	private async postMessage(context: RebaseEditorContext, message: IpcMessage) {
		try {
			const success = await context.panel.webview.postMessage(message);
			context.pendingChange = !success;
			return success;
		} catch (ex) {
			Logger.error(ex);

			context.pendingChange = true;
			return false;
		}
	}

	private onMessageReceived(context: RebaseEditorContext, e: IpcMessage) {
		switch (true) {
			// case ReadyCommandType.is(e):
			// 	this.parseDocumentAndSendChange(panel, document);
			// 	break;

			case WebviewFocusChangedCommand.is(e):
				this.onViewFocusChanged(e.params);
				break;

			case AbortCommand.is(e):
				void this.abort(context);

				break;

			case DisableCommand.is(e):
				void this.disable(context);
				break;

			case SearchCommand.is(e):
				void executeCoreCommand('editor.action.webvieweditor.showFind');
				break;

			case StartCommand.is(e):
				void this.rebase(context);
				break;

			case SwitchCommand.is(e):
				this.switchToText(context);
				break;

			case ReorderCommand.is(e):
				this.swapOrdering(e.params, context);
				break;

			case ChangeEntryCommand.is(e):
				void this.onEntryChanged(context, e.params);
				break;

			case MoveEntryCommand.is(e):
				void this.onEntryMoved(context, e.params);
				break;

			case UpdateSelectionCommand.is(e):
				this.onSelectionChanged(context, e.params);
				break;
		}
	}

	private async onEntryChanged(context: RebaseEditorContext, params: ChangeEntryParams) {
		const entries = parseRebaseTodoEntries(context.document);

		const entry = entries.find(e => e.sha === params.sha);
		if (entry == null) return;

		const start = context.document.positionAt(entry.index);
		const range = context.document.validateRange(
			new Range(new Position(start.line, 0), new Position(start.line, maxSmallIntegerV8)),
		);

		let action = params.action;
		const edit = new WorkspaceEdit();

		// Fake the new set of entries, to check if last entry is a squash/fixup
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

		// Ensure that the last entry isn't a squash/fixup
		if (squashing) {
			const lastEntry = newEntries[newEntries.length - 1];
			if (entry.sha === lastEntry.sha) {
				action = 'pick';
			} else {
				const start = context.document.positionAt(lastEntry.index);
				const range = context.document.validateRange(
					new Range(new Position(start.line, 0), new Position(start.line, maxSmallIntegerV8)),
				);

				edit.replace(context.document.uri, range, `pick ${lastEntry.sha} ${lastEntry.message}`);
			}
		}

		edit.replace(context.document.uri, range, `${action} ${entry.sha} ${entry.message}`);
		await workspace.applyEdit(edit);
	}

	private async onEntryMoved(context: RebaseEditorContext, params: MoveEntryParams) {
		const entries = parseRebaseTodoEntries(context.document);

		const entry = entries.find(e => e.sha === params.sha);
		if (entry == null) return;

		const index = entries.findIndex(e => e.sha === params.sha);

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
		let newLine = context.document.positionAt(newEntry.index).line;
		if (newIndex < index) {
			newLine++;
		}

		const start = context.document.positionAt(entry.index);
		const range = context.document.validateRange(
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
			if (entry.sha === lastEntry.sha) {
				action = 'pick';
			} else {
				const start = context.document.positionAt(lastEntry.index);
				const range = context.document.validateRange(
					new Range(new Position(start.line, 0), new Position(start.line, maxSmallIntegerV8)),
				);

				edit.replace(context.document.uri, range, `pick ${lastEntry.sha} ${lastEntry.message}`);
			}
		}

		edit.delete(context.document.uri, range);
		edit.insert(context.document.uri, new Position(newLine, 0), `${action} ${entry.sha} ${entry.message}\n`);

		await workspace.applyEdit(edit);
	}

	private onSelectionChanged(context: RebaseEditorContext, params: UpdateSelectionParams) {
		if (context.fireSelectionChangedDebounced == null) {
			context.fireSelectionChangedDebounced = debounce(this.fireSelectionChanged.bind(this), 250);
		}

		context.fireSelectionChangedDebounced(context, params.sha);
	}

	private fireSelectionChanged(context: RebaseEditorContext, sha: string | undefined) {
		if (sha == null) return;
		const showDetailsView = configuration.get('rebaseEditor.showDetailsView');

		// Find the full sha
		sha = context.commits?.find(c => c.sha.startsWith(sha!))?.sha ?? sha;

		this.container.events.fire(
			'commit:selected',
			{
				commit: createReference(sha, context.repoPath, { refType: 'revision' }),
				interaction: 'passive',
				preserveFocus: true,
				preserveVisibility: context.firstSelection
					? showDetailsView === false
					: showDetailsView !== 'selection',
			},
			{
				source: 'gitlens.rebase',
			},
		);
		context.firstSelection = false;
	}

	@debug<RebaseEditorProvider['updateState']>({ args: { 0: c => `${c.id}:${c.document.uri.toString(true)}` } })
	private updateState(context: RebaseEditorContext, immediate: boolean = false) {
		if (immediate) {
			context.notifyDidChangeStateDebounced?.cancel();

			void this.notifyDidChangeState(context);
			return;
		}

		if (context.notifyDidChangeStateDebounced == null) {
			context.notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 250);
		}

		void context.notifyDidChangeStateDebounced(context);
	}

	@debug<RebaseEditorProvider['notifyDidChangeState']>({
		args: { 0: c => `${c.id}:${c.document.uri.toString(true)}` },
	})
	private async notifyDidChangeState(context: RebaseEditorContext) {
		if (!context.panel.visible) {
			context.pendingChange = true;

			return;
		}

		const state = await this.parseState(context);
		void this.postMessage(context, {
			id: `host:${ipcSequencer.next()}`,
			scope: DidChangeNotification.scope,
			method: DidChangeNotification.method,
			params: { state: state },
		});
	}

	@log({ args: false })
	private async abort(context: RebaseEditorContext) {
		// Avoid triggering events by disposing them first
		context.dispose();

		// Delete the contents to abort the rebase
		const edit = new WorkspaceEdit();
		edit.replace(context.document.uri, new Range(0, 0, context.document.lineCount, 0), '');
		await workspace.applyEdit(edit);
		await context.document.save();

		context.panel.dispose();
	}

	@log({ args: false })
	private async disable(context: RebaseEditorContext) {
		await this.abort(context);
		await this.setEnabled(false);
	}

	@log({ args: false })
	private async rebase(context: RebaseEditorContext) {
		// Avoid triggering events by disposing them first
		context.dispose();

		await context.document.save();

		context.panel.dispose();
	}

	@log({ args: false })
	private swapOrdering(params: ReorderParams, context: RebaseEditorContext) {
		this.ascending = params.ascending ?? false;
		void configuration.updateEffective('rebaseEditor.ordering', this.ascending ? 'asc' : 'desc');
		this.updateState(context, true);
	}

	@log({ args: false })
	private switchToText(context: RebaseEditorContext) {
		void showRebaseSwitchToTextWarningMessage();

		// Open the text version of the document
		void executeCoreCommand('vscode.open', context.document.uri, {
			override: false,
			preview: false,
		});
	}

	private async getHtml(context: RebaseEditorContext): Promise<string> {
		const webRootUri = Uri.joinPath(this.container.context.extensionUri, 'dist', 'webviews');
		const uri = Uri.joinPath(webRootUri, 'rebase.html');

		const [bytes, bootstrap] = await Promise.all([workspace.fs.readFile(uri), this.parseState(context)]);

		const html = replaceWebviewHtmlTokens(
			utf8TextDecoder.decode(bytes),
			'gitlens.rebase',
			undefined,
			context.panel.webview.cspSource,
			getNonce(),
			context.panel.webview.asWebviewUri(this.container.context.extensionUri).toString(),
			context.panel.webview.asWebviewUri(webRootUri).toString(),
			'editor',
			bootstrap,
		);
		return html;
	}
}

async function loadRichCommitData(
	container: Container,
	context: RebaseEditorContext,
	onto: string,
	entries: RebaseEntry[],
) {
	context.commits = [];
	context.authors = new Map<string, Author>();

	const log = await container.git.richSearchCommits(
		context.repoPath,
		{
			query: `${onto ? `#:${onto} ` : ''}${join(
				map(entries, e => `#:${e.sha}`),
				' ',
			)}`,
		},
		{ limit: 0 },
	);

	if (log != null) {
		for (const c of log.commits.values()) {
			context.commits.push(c);

			if (!context.authors.has(c.author.name)) {
				context.authors.set(c.author.name, {
					author: c.author.name,
					avatarUrl: (await c.getAvatarUri()).toString(true),
					email: c.author.email,
				});
			}
			if (!context.authors.has(c.committer.name)) {
				const avatarUri = await c.committer.getAvatarUri(c);
				context.authors.set(c.committer.name, {
					author: c.committer.name,
					avatarUrl: avatarUri.toString(true),
					email: c.committer.email,
				});
			}
		}
	}
}

async function parseRebaseTodo(
	container: Container,
	context: RebaseEditorContext,
	ascending: boolean,
): Promise<Omit<State, 'rebasing'>> {
	const contents = context.document.getText();
	const entries = parseRebaseTodoEntries(contents);
	let [, , , onto] = rebaseRegex.exec(contents) ?? ['', '', ''];

	if (context.authors == null || context.commits == null) {
		await loadRichCommitData(container, context, onto, entries);
	}

	const defaultDateFormat = configuration.get('defaultDateFormat');
	const command = InspectCommand.createMarkdownCommandLink(`\${commit}`, context.repoPath);

	const ontoCommit = onto ? context.commits?.find(c => c.sha.startsWith(onto)) : undefined;

	let commit;
	for (const entry of entries) {
		commit = context.commits?.find(c => c.sha.startsWith(entry.sha));
		if (commit == null) continue;

		// If the onto commit is contained in the list of commits, remove it and clear the 'onto' value — See #1201
		if (commit.sha === ontoCommit?.sha) {
			onto = '';
		}

		entry.commit = {
			sha: commit.sha,
			author: commit.author.name,
			committer: commit.committer.name,
			date: commit.formatDate(defaultDateFormat),
			dateFromNow: commit.formattedDate,
			message: emojify(commit.message ?? commit.summary),
		};
	}

	return {
		webviewId: 'gitlens.rebase',
		webviewInstanceId: undefined,
		timestamp: Date.now(),
		branch: context.branchName ?? '',
		onto: onto
			? {
					sha: onto,
					commit:
						ontoCommit != null
							? {
									sha: ontoCommit.sha,
									author: ontoCommit.author.name,
									committer: ontoCommit.committer.name,
									date: ontoCommit.formatDate(defaultDateFormat),
									dateFromNow: ontoCommit.formatDateFromNow(),
									message: emojify(ontoCommit.message || 'root'),
							  }
							: undefined,
			  }
			: undefined,
		entries: entries,
		authors: context.authors != null ? Object.fromEntries(context.authors) : {},
		commands: { commit: command },
		ascending: ascending,
	};
}

function parseRebaseTodoEntries(contents: string): RebaseEntry[];
function parseRebaseTodoEntries(document: TextDocument): RebaseEntry[];
function parseRebaseTodoEntries(contentsOrDocument: string | TextDocument): RebaseEntry[] {
	const contents = typeof contentsOrDocument === 'string' ? contentsOrDocument : contentsOrDocument.getText();

	const entries: RebaseEntry[] = [];

	let match;
	let action;
	let sha;
	let message;

	do {
		match = rebaseCommandsRegex.exec(contents);
		if (match == null) break;

		[, action, sha, message] = match;

		entries.push({
			index: match.index,
			action: rebaseActionsMap.get(action) ?? 'pick',
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			sha: ` ${sha}`.substring(1),
			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			message: message == null || message.length === 0 ? '' : ` ${message}`.substring(1),
		});
	} while (true);

	return entries.reverse();
}
