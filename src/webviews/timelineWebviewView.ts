'use strict';
import { TextDecoder } from 'util';
import {
	CancellationToken,
	commands,
	Disposable,
	TextEditor,
	Uri,
	Webview,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
	window,
	workspace,
} from 'vscode';
import { Commands, ShowQuickCommitCommandArgs } from '../commands';
import { hasVisibleTextEditor, isTextEditor } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import {
	IpcMessage,
	IpcNotificationParamsOf,
	IpcNotificationType,
	onIpcCommand,
	ReadyCommandType,
	TimelineData,
	TimelineDataPointClickCommandType,
	TimelineDidChangeDataNotificationType,
	TimelinePeriodUpdateCommandType,
} from './protocol';
import { debug, Functions } from '../system';

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === Number.MAX_SAFE_INTEGER) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

export class TimelineWebviewView implements WebviewViewProvider, Disposable {
	private readonly disposable: Disposable;
	private _disposableView: Disposable | undefined;

	private _editor: TextEditor | undefined;
	private _isReady: boolean = false;
	private _period: string = '3 months ago';
	private _view: WebviewView | undefined;

	constructor() {
		const editor = window.activeTextEditor;
		if (editor !== undefined && isTextEditor(editor)) {
			this._editor = editor;
		}

		this.disposable = Disposable.from(window.registerWebviewViewProvider(this.id, this));
	}

	dispose() {
		this.disposable.dispose();
		this._disposableView?.dispose();
	}

	async resolveWebviewView(
		webviewView: WebviewView,
		_context: WebviewViewResolveContext,
		_token: CancellationToken,
	): Promise<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableCommandUris: true,
			enableScripts: true,
		};

		webviewView.title = this.title;

		this._disposableView = Disposable.from(
			this._view.onDidDispose(this.onViewDisposed, this),
			this._view.onDidChangeVisibility(this.onViewVisibilityChanged, this),
			this._view.webview.onDidReceiveMessage(this.onMessageReceived, this),
			// ...this.registerCommands(),
		);

		webviewView.webview.html = await this.getHtml(webviewView.webview);

		this.onViewVisibilityChanged();
	}

	private async getHtml(webview: Webview): Promise<string> {
		const uri = Uri.joinPath(Container.context.extensionUri, 'dist', 'webviews', this.filename);
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		const html = content
			.replace(/#{cspSource}/g, webview.cspSource)
			.replace(/#{root}/g, webview.asWebviewUri(Container.context.extensionUri).toString());

		return html;
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor === undefined && hasVisibleTextEditor()) return;
		if (editor !== undefined && !isTextEditor(editor)) return;

		this._editor = editor;
		void this.notifyDidChangeData(editor);
	}

	private onViewDisposed() {
		this._disposableView?.dispose();
		this._disposableView = undefined;
		this._disposableVisibility?.dispose();
		this._disposableVisibility = undefined;
		this._isReady = false;
		this._view = undefined;
	}

	private _disposableVisibility: Disposable | undefined;
	private onViewVisibilityChanged() {
		this._isReady = false;
		if (this._view?.visible) {
			console.log('became visible');
			if (this._disposableVisibility == null) {
				this._disposableVisibility = window.onDidChangeActiveTextEditor(
					Functions.debounce(this.onActiveEditorChanged, 500),
					this,
				);
				this.onActiveEditorChanged(window.activeTextEditor);
			}
		} else {
			console.log('became hidden');
			this._disposableVisibility?.dispose();
			this._disposableVisibility = undefined;
			// this.setTitle(this.title);
		}
	}

	protected onMessageReceived(e?: IpcMessage) {
		if (e == null) return;

		switch (e.method) {
			case ReadyCommandType.method:
				onIpcCommand(ReadyCommandType, e, () => {
					this._isReady = true;
					void this.notifyDidChangeData(this._editor);
				});

				break;

			case TimelineDataPointClickCommandType.method:
				onIpcCommand(TimelineDataPointClickCommandType, e, async params => {
					if (params.data == null || this._editor == null || !params.data.selected) return;

					const gitUri = await GitUri.fromUri(this._editor.document.uri);

					const commandArgs: ShowQuickCommitCommandArgs = {
						repoPath: gitUri.repoPath!,
						sha: params.data.id,
					};

					void commands.executeCommand(Commands.ShowQuickCommit, commandArgs);

					// const commandArgs: DiffWithPreviousCommandArgs = {
					// 	line: 0,
					// 	showOptions: {
					// 		preserveFocus: true,
					// 		preview: true,
					// 		viewColumn: ViewColumn.Beside,
					// 	},
					// };

					// void commands.executeCommand(
					// 	Commands.DiffWithPrevious,
					// 	new GitUri(gitUri, { repoPath: gitUri.repoPath!, sha: params.data.id }),
					// 	commandArgs,
					// );
				});

				break;

			case TimelinePeriodUpdateCommandType.method:
				onIpcCommand(TimelinePeriodUpdateCommandType, e, params => {
					if (params.data == null) return;

					this._period = params.data?.period;
					void this.notifyDidChangeData(this._editor);
				});

				break;
		}
	}

	get filename(): string {
		return 'timeline.html';
	}

	get id(): string {
		return 'gitlens.views.timeline';
	}

	get title(): string {
		return 'Timeline';
	}

	setTitle(title: string) {
		if (this._view == null) return;

		this._view.title = title;
	}

	get description() {
		return this._view?.description;
	}
	set description(description: string | undefined) {
		if (this._view == null) return;

		this._view.description = description;
	}

	private async getData(editor: TextEditor | undefined): Promise<TimelineData | undefined> {
		let currentUser;
		let log;

		let title;
		let repoPath;
		let uri;
		if (editor == null) {
			const repo = [...(await Container.git.getRepositories())][0]!;
			repoPath = repo.path;
			title = repo.name;

			// this.setTitle(`${this.title} \u2022 ${repo.name}`);
			this.description = repo.name;

			[currentUser, log] = await Promise.all([
				Container.git.getCurrentUser(repoPath),
				Container.git.getLog(repoPath, { limit: 0, since: this._period }),
			]);
		} else {
			const gitUri = await GitUri.fromUri(editor.document.uri);
			uri = gitUri.toFileUri().toString(true);
			repoPath = gitUri.repoPath!;
			title = gitUri.relativePath;

			// this.setTitle(`${this.title} \u2022 ${gitUri.fileName}`);
			this.description = gitUri.fileName;

			[currentUser, log] = await Promise.all([
				Container.git.getCurrentUser(repoPath),
				Container.git.getLogForFile(repoPath, gitUri.fsPath, {
					limit: 0,
					ref: gitUri.sha,
					since: this._period,
				}),
			]);
		}

		if (log == null) return undefined;

		const name = currentUser?.name ? `${currentUser.name} (you)` : 'You';

		const dataset = [];
		for (const commit of log.commits.values()) {
			const diff = commit.getDiffStatus();
			dataset.push({
				author: commit.author === 'You' ? name : commit.author,
				added: diff.added,
				changed: diff.changed,
				deleted: diff.deleted,
				commit: commit.sha,
				date: commit.date,
				message: commit.message,
			});
		}

		dataset.sort((a, b) => a.date.getTime() - b.date.getTime());

		return { dataset: dataset, period: this._period, repoPath: repoPath, title: title, uri: uri };
	}

	private async notifyDidChangeData(editor: TextEditor | undefined) {
		if (!this._isReady) return false;

		return this.notify(TimelineDidChangeDataNotificationType, {
			data: await this.getData(editor),
		});
	}

	protected notify<NT extends IpcNotificationType>(type: NT, params: IpcNotificationParamsOf<NT>): Thenable<boolean> {
		return this.postMessage({ id: nextIpcId(), method: type.method, params: params });
	}

	private postMessage(message: IpcMessage) {
		if (this._view == null) return Promise.resolve(false);

		return this._view.webview.postMessage(message);
	}
}
