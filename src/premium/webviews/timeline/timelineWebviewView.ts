'use strict';
import { commands, Disposable, TextEditor, window } from 'vscode';
import { ShowQuickCommitCommandArgs } from '../../../commands';
import { Commands } from '../../../constants';
import { Container } from '../../../container';
import { PremiumFeatures } from '../../../features';
import { GitUri } from '../../../git/gitUri';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import { debounce } from '../../../system/function';
import { hasVisibleTextEditor, isTextEditor } from '../../../system/utils';
import { IpcMessage, onIpc } from '../../../webviews/protocol';
import { WebviewViewBase } from '../../../webviews/webviewViewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import {
	Commit,
	DidChangeStateNotificationType,
	OpenDataPointCommandType,
	State,
	UpdatePeriodCommandType,
} from './protocol';

export class TimelineWebviewView extends WebviewViewBase<State> {
	private _editor: TextEditor | undefined;
	private _period: `${number}|${'D' | 'M' | 'Y'}` = '3|M';

	constructor(container: Container) {
		super(container, 'gitlens.views.timeline', 'timeline.html', 'Visual File History');

		this.disposables.push(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	override dispose() {
		super.dispose();
		this._disposableVisibility?.dispose();
	}

	protected override onReady() {
		this.onActiveEditorChanged(window.activeTextEditor);
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState(undefined);
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (!this.isReady || (this._editor === editor && editor != null)) return;
		if (editor == null && hasVisibleTextEditor()) return;
		if (editor != null && !isTextEditor(editor)) return;

		this._editor = editor;
		void this.notifyDidChangeState(editor);
	}

	private onSubscriptionChanged(_e: SubscriptionChangeEvent) {
		void this.notifyDidChangeState(this._editor);
	}

	private _disposableVisibility: Disposable | undefined;
	protected override onVisibilityChanged(visible: boolean) {
		if (visible) {
			if (this._disposableVisibility == null) {
				this._disposableVisibility = window.onDidChangeActiveTextEditor(
					debounce(this.onActiveEditorChanged, 500),
					this,
				);
			}
			this.onActiveEditorChanged(window.activeTextEditor);
		} else {
			this._disposableVisibility?.dispose();
			this._disposableVisibility = undefined;

			this._editor = undefined;
		}
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenDataPointCommandType.method:
				onIpc(OpenDataPointCommandType, e, params => {
					if (params.data == null || this._editor == null || !params.data.selected) return;

					const repository = this.container.git.getRepository(this._editor.document.uri);
					if (repository == null) return;

					const commandArgs: ShowQuickCommitCommandArgs = {
						repoPath: repository.path,
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

			case UpdatePeriodCommandType.method:
				onIpc(UpdatePeriodCommandType, e, params => {
					this._period = params.period;
					void this.notifyDidChangeState(this._editor);
				});

				break;
		}
	}

	@debug({ args: { 0: e => e?.document.uri.toString(true) } })
	private async getState(editor: TextEditor | undefined): Promise<State> {
		const access = await this.container.git.access(PremiumFeatures.Timeline);

		const dateFormat = this.container.config.defaultDateFormat ?? 'MMMM Do, YYYY h:mma';
		if (editor == null || !access.allowed) {
			return {
				period: this._period,
				title: 'There are no editors open that can provide file history information',
				dateFormat: dateFormat,
				access: access,
			};
		}

		const gitUri = await GitUri.fromUri(editor.document.uri);
		const repoPath = gitUri.repoPath!;
		const title = gitUri.relativePath;

		// this.setTitle(`${this.title} \u2022 ${gitUri.fileName}`);
		this.description = gitUri.fileName;

		const [currentUser, log] = await Promise.all([
			this.container.git.getCurrentUser(repoPath),
			this.container.git.getLogForFile(repoPath, gitUri.fsPath, {
				limit: 0,
				ref: gitUri.sha,
				since: this.getPeriodDate().toISOString(),
			}),
		]);

		if (log == null) {
			return {
				dataset: [],
				period: this._period,
				title: title,
				uri: editor.document.uri.toString(),
				dateFormat: dateFormat,
				access: access,
			};
		}

		const name = currentUser?.name ? `${currentUser.name} (you)` : 'You';

		const dataset: Commit[] = [];
		for (const commit of log.commits.values()) {
			const stats = commit.file?.stats;
			dataset.push({
				author: commit.author.name === 'You' ? name : commit.author.name,
				additions: stats?.additions ?? 0,
				// changed: stats?.changes ?? 0,
				deletions: stats?.deletions ?? 0,
				commit: commit.sha,
				date: commit.date.toISOString(),
				message: commit.message ?? commit.summary,
				sort: commit.date.getTime(),
			});
		}

		dataset.sort((a, b) => b.sort - a.sort);

		return {
			dataset: dataset,
			period: this._period,
			title: title,
			uri: editor.document.uri.toString(),
			dateFormat: dateFormat,
			access: access,
		};
	}

	private getPeriodDate(): Date {
		const period = this._period ?? '3|M';

		const [number, unit] = period.split('|');

		switch (unit) {
			case 'D':
				return createFromDateDelta(new Date(), { days: -parseInt(number, 10) });
			case 'M':
				return createFromDateDelta(new Date(), { months: -parseInt(number, 10) });
			case 'Y':
				return createFromDateDelta(new Date(), { years: -parseInt(number, 10) });
			default:
				return createFromDateDelta(new Date(), { months: -3 });
		}
	}

	private async notifyDidChangeState(editor: TextEditor | undefined) {
		if (!this.isReady) return false;

		return window.withProgress({ location: { viewId: this.id } }, async () =>
			this.notify(DidChangeStateNotificationType, {
				state: await this.getState(editor),
			}),
		);
	}
}
