'use strict';
import { commands, Disposable, TextEditor, ViewColumn, window } from 'vscode';
import { Commands, ShowQuickCommitCommandArgs } from '../commands';
import { hasVisibleTextEditor, isTextEditor } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import {
	IpcMessage,
	onIpcCommand,
	ReadyCommandType,
	TimelineData,
	TimelineDataPointClickCommandType,
	TimelineDidChangeDataNotificationType,
} from './protocol';
import { debug, Functions } from '../system';
import { WebviewBase } from './webviewBase';

export class TimelineWebview extends WebviewBase {
	private _editor: TextEditor | undefined;

	constructor() {
		super(Commands.ShowTimelinePage, ViewColumn.Beside);

		const editor = window.activeTextEditor;
		if (editor !== undefined && isTextEditor(editor)) {
			this._editor = editor;
		}

		this.disposable = Disposable.from(
			this.disposable,
			window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
		);
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

			case TimelineDataPointClickCommandType.method:
				onIpcCommand(TimelineDataPointClickCommandType, e, async params => {
					if (params.data === undefined || this._editor === undefined) return;

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
