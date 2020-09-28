'use strict';
import {
	CancellationToken,
	commands,
	Disposable,
	TextEditor,
	ViewColumn,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
	window,
} from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { hasVisibleTextEditor, isTextEditor } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import {
	IpcMessage,
	onIpcCommand,
	ReadyCommandType,
	TimelineClickCommandType,
	TimelineData,
	TimelineDidChangeDataNotificationType,
} from './protocol';
import { debug, Functions } from '../system';

export class TimelineWebviewView implements WebviewViewProvider, Disposable {
	private readonly disposable: Disposable;
	private _editor: TextEditor | undefined;
	private _view: WebviewView | undefined;

	constructor() {
		const editor = window.activeTextEditor;
		if (editor !== undefined && isTextEditor(editor)) {
			this._editor = editor;
		}

		this.disposable = Disposable.from(
			window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
			window.registerWebviewViewProvider('gitlens.views.timeline', this),
		);
	}

	async resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext, token: CancellationToken) {
		this._view = webviewView;
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor === undefined && hasVisibleTextEditor()) return;
		if (editor !== undefined && !isTextEditor(editor)) return;

		this._editor = editor;
		void this.notifyDidChangeData(editor);
	}

	protected onMessageReceived(e: IpcMessage) {
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
				super.onMessageReceived(e);

				break;
		}
	}

	get filename(): string {
		return 'timeline.html';
	}

	get id(): string {
		return 'gitlens.timeline';
	}

	get title(): string {
		return 'GitLens Timeline';
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
}
