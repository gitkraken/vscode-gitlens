'use strict';
import { TextDecoder } from 'util';
import {
	CancellationToken,
	commands,
	Disposable,
	TextEditor,
	Uri,
	ViewColumn,
	Webview,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
	window,
	workspace,
} from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { hasVisibleTextEditor, isTextEditor } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import {
	IpcMessage,
	IpcNotificationParamsOf,
	IpcNotificationType,
	onIpcCommand,
	ReadyCommandType,
	TimelineClickCommandType,
	TimelineData,
	TimelineDidChangeDataNotificationType,
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
	private _view: WebviewView | undefined;

	constructor() {
		const editor = window.activeTextEditor;
		if (editor !== undefined && isTextEditor(editor)) {
			this._editor = editor;
		}

		this.disposable = Disposable.from(
			window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
			window.registerWebviewViewProvider(this.id, this),
		);
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

		// webviewView.iconPath = Uri.file(Container.context.asAbsolutePath('images/gitlens-icon.png'));
		webviewView.title = this.title;

		this._disposableView = Disposable.from(
			// this._view,
			this._view.onDidDispose(this.onViewDisposed, this),
			this._view.onDidChangeVisibility(this.onViewVisibilityChanged, this),
			this._view.webview.onDidReceiveMessage(this.onMessageReceived, this),
			// ...this.registerCommands(),
		);

		webviewView.webview.html = await this.getHtml(webviewView.webview);
	}

	private async getHtml(webview: Webview): Promise<string> {
		const uri = Uri.joinPath(Container.context.extensionUri, 'dist', 'webviews', this.filename);
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		const html = content
			.replace(/#{cspSource}/g, webview.cspSource)
			.replace(/#{root}/g, webview.asWebviewUri(Container.context.extensionUri).toString());

		// if (this.renderHead != null) {
		// 	html = html.replace(/#{head}/i, await this.renderHead());
		// }

		// if (this.renderBody != null) {
		// 	html = html.replace(/#{body}/i, await this.renderBody());
		// }

		// if (this.renderEndOfBody != null) {
		// 	html = html.replace(/#{endOfBody}/i, await this.renderEndOfBody());
		// }

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
		this._view = undefined;
	}

	private onViewVisibilityChanged() {
		// // Anytime the webview becomes active, make sure it has the most up-to-date config
		// if (this._view?.visible) {
		// 	void this.notifyDidChangeConfiguration();
		// }
	}

	protected onMessageReceived(e?: IpcMessage) {
		if (e == null) return;

		switch (e.method) {
			case ReadyCommandType.method:
				onIpcCommand(ReadyCommandType, e, () => {
					void this.notifyDidChangeData(this._editor);
				});

				break;

			case TimelineClickCommandType.method:
				onIpcCommand(TimelineClickCommandType, e, async params => {
					if (params.data === undefined || this._editor === undefined) return;

					const commandArgs: DiffWithPreviousCommandArgs = {
						line: 0,
						showOptions: {
							preserveFocus: true,
							preview: true,
							viewColumn: ViewColumn.Beside,
						},
					};

					const gitUri = await GitUri.fromUri(this._editor.document.uri);

					void commands.executeCommand(
						Commands.DiffWithPrevious,
						new GitUri(gitUri, { repoPath: gitUri.repoPath!, sha: params.data.id }),
						commandArgs,
					);
				});

				break;

			default:
				// super.onMessageReceived(e);

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
		return 'GitLens Timeline';
	}

	setTitle(title: string) {
		if (this._view == null) return;

		this._view.title = title;
	}

	private async getData(editor: TextEditor | undefined): Promise<TimelineData | undefined> {
		let currentUser;
		let log;

		let title;
		let repoPath;
		let uri;
		if (editor == undefined) {
			const repo = [...(await Container.git.getRepositories())][0]!;
			repoPath = repo.path;
			title = repo.name;

			this.setTitle(`Timeline of ${repo.name}`);

			[currentUser, log] = await Promise.all([
				Container.git.getCurrentUser(repoPath),
				Container.git.getLog(repoPath),
			]);
		} else {
			const gitUri = await GitUri.fromUri(editor.document.uri);
			uri = gitUri.toFileUri().toString(true);
			repoPath = gitUri.repoPath!;
			title = gitUri.relativePath;

			this.setTitle(`Timeline of ${gitUri.fileName}`);

			[currentUser, log] = await Promise.all([
				Container.git.getCurrentUser(repoPath),
				Container.git.getLogForFile(repoPath, gitUri.fsPath, {
					ref: gitUri.sha,
				}),
			]);
		}

		if (log === undefined) return undefined;

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

		return { dataset: dataset, repoPath: repoPath, title: title, uri: uri };
	}

	private async notifyDidChangeData(editor: TextEditor | undefined) {
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
