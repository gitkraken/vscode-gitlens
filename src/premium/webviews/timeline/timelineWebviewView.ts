'use strict';
import { commands, Disposable, TextEditor, window } from 'vscode';
import { ShowQuickCommitCommandArgs } from '../../../commands';
import { Commands } from '../../../constants';
import { Container } from '../../../container';
import { PremiumFeatures } from '../../../features';
import { GitUri } from '../../../git/gitUri';
import { RepositoryChange, RepositoryChangeComparisonMode, RepositoryChangeEvent } from '../../../git/models';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import { debounce, Deferrable } from '../../../system/function';
import { hasVisibleTextEditor, isTextEditor } from '../../../system/utils';
import { IpcMessage, onIpc } from '../../../webviews/protocol';
import { WebviewViewBase } from '../../../webviews/webviewViewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import {
	Commit,
	DidChangeStateNotificationType,
	OpenDataPointCommandType,
	Period,
	State,
	UpdatePeriodCommandType,
} from './protocol';

interface Context {
	editor: TextEditor | undefined;
	period: Period | undefined;
	etagRepository: number | undefined;
	etagSubscription: number | undefined;
}

const defaultPeriod: Period = '3|M';

export class TimelineWebviewView extends WebviewViewBase<State> {
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;

	constructor(container: Container) {
		super(container, 'gitlens.views.timeline', 'timeline.html', 'Visual File History');

		this._context = {
			editor: undefined,
			period: defaultPeriod,
			etagRepository: 0,
			etagSubscription: this.container.subscription.etag,
		};

		this.disposables.push(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			window.onDidChangeActiveTextEditor(this.onActiveEditorChanged, this),
			this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
		);
	}

	protected override async includeBootstrap(): Promise<State> {
		this._bootstraping = true;
		this.updatePendingEditor(window.activeTextEditor);
		this._context = { ...this._context, ...this._pendingContext };
		return this.getState(this._context);
	}

	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (!this.updatePendingEditor(editor)) return;

		this.updateState();
	}

	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Heads, RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
			return;
		}

		if (this.updatePendingContext({ etagRepository: e.repository.etag })) {
			this.updateState();
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (this.updatePendingContext({ etagSubscription: e.etag })) {
			this.updateState();
		}
	}

	protected override onVisibilityChanged(visible: boolean) {
		if (!visible) return;

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;
			return;
		}
		this.updateState(true);
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenDataPointCommandType.method:
				onIpc(OpenDataPointCommandType, e, params => {
					if (params.data == null || !params.data.selected || this._context.editor == null) return;

					const repository = this.container.git.getRepository(this._context.editor.document.uri);
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
					if (this.updatePendingContext({ period: params.period })) {
						this.updateState(true);
					}
				});

				break;
		}
	}

	@debug({ args: false })
	private async getState(current: Context): Promise<State> {
		const access = await this.container.git.access(PremiumFeatures.Timeline);

		const period = current.period ?? defaultPeriod;

		const dateFormat = this.container.config.defaultDateFormat ?? 'MMMM Do, YYYY h:mma';
		if (current.editor == null || !access.allowed) {
			return {
				period: period,
				title: 'There are no editors open that can provide file history information',
				dateFormat: dateFormat,
				access: access,
			};
		}

		const gitUri = await GitUri.fromUri(current.editor.document.uri);
		const repoPath = gitUri.repoPath!;
		const title = gitUri.relativePath;

		this.description = gitUri.fileName;

		const [currentUser, log] = await Promise.all([
			this.container.git.getCurrentUser(repoPath),
			this.container.git.getLogForFile(repoPath, gitUri.fsPath, {
				limit: 0,
				ref: gitUri.sha,
				since: this.getPeriodDate(period).toISOString(),
			}),
		]);

		if (log == null) {
			return {
				dataset: [],
				period: period,
				title: 'No commits found for the specified time period',
				uri: current.editor.document.uri.toString(),
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
			period: period,
			title: title,
			uri: current.editor.document.uri.toString(),
			dateFormat: dateFormat,
			access: access,
		};
	}

	private getPeriodDate(period: Period): Date {
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

	private updatePendingContext(context: Partial<Context>): boolean {
		let changed = false;
		for (const [key, value] of Object.entries(context)) {
			if ((this._context as unknown as Record<string, unknown>)[key] !== value) {
				if (this._pendingContext == null) {
					this._pendingContext = {};
				}

				(this._pendingContext as Record<string, unknown>)[key] = value;
				changed = true;
			}
		}

		return changed;
	}

	private updatePendingEditor(editor: TextEditor | undefined): boolean {
		if (editor == null && hasVisibleTextEditor()) return false;
		if (editor != null && !isTextEditor(editor)) return false;

		let etag;
		if (editor != null) {
			const repository = this.container.git.getRepository(editor.document.uri);
			etag = repository?.etag ?? 0;
		} else {
			etag = 0;
		}

		return this.updatePendingContext({ editor: editor, etagRepository: etag });
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
		if (!this.isReady || !this.visible) return;

		this.updatePendingEditor(window.activeTextEditor);

		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		if (this._notifyDidChangeStateDebounced == null) {
			this._notifyDidChangeStateDebounced = debounce(this.notifyDidChangeState.bind(this), 500);
		}

		this._notifyDidChangeStateDebounced();
	}

	@debug()
	private async notifyDidChangeState() {
		if (!this.isReady || !this.visible) return false;

		this._notifyDidChangeStateDebounced?.cancel();
		const context = { ...this._context, ...this._pendingContext };

		return window.withProgress({ location: { viewId: this.id } }, async () => {
			const success = await this.notify(DidChangeStateNotificationType, {
				state: await this.getState(context),
			});
			if (success) {
				this._context = context;
				this._pendingContext = undefined;
			}
		});
	}
}
