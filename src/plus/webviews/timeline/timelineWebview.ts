'use strict';
import type { Disposable, TextEditor, ViewColumn } from 'vscode';
import { Uri, window } from 'vscode';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { PlusFeatures } from '../../../features';
import { showDetailsView } from '../../../git/actions/commit';
import { GitUri } from '../../../git/gitUri';
import { getChangedFilesCount } from '../../../git/models/commit';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { registerCommand } from '../../../system/command';
import { configuration } from '../../../system/configuration';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { filter } from '../../../system/iterable';
import { hasVisibleTextEditor, isTextEditor } from '../../../system/utils';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type { Commit, Period, State } from './protocol';
import { DidChangeNotificationType, OpenDataPointCommandType, UpdatePeriodCommandType } from './protocol';
import { generateRandomTimelineDataset } from './timelineWebviewView';

interface Context {
	uri: Uri | undefined;
	period: Period | undefined;
	etagRepository: number | undefined;
	etagSubscription: number | undefined;
}

const defaultPeriod: Period = '3|M';

export class TimelineWebview extends WebviewBase<State> {
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;

	constructor(container: Container) {
		super(
			container,
			'gitlens.timeline',
			'timeline.html',
			'images/gitlens-icon.png',
			'Visual File History',
			`${ContextKeys.WebviewPrefix}timeline`,
			'timelineWebview',
			Commands.ShowTimelinePage,
		);
		this._context = {
			uri: undefined,
			period: defaultPeriod,
			etagRepository: 0,
			etagSubscription: 0,
		};
	}

	override async show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		return super.show(options, ...args);
	}

	protected override onInitializing(): Disposable[] | undefined {
		this._context = {
			uri: undefined,
			period: defaultPeriod,
			etagRepository: 0,
			etagSubscription: this.container.subscription.etag,
		};

		this.updatePendingEditor(window.activeTextEditor);
		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return [
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
		];
	}

	protected override onShowCommand(uri?: Uri): void {
		if (uri != null) {
			this.updatePendingUri(uri);
		} else {
			this.updatePendingEditor(window.activeTextEditor);
		}
		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		super.onShowCommand();
	}

	protected override async includeBootstrap(): Promise<State> {
		this._bootstraping = true;

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return this.getState(this._context);
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshTimelinePage, () => this.refresh(true))];
	}

	protected override onVisibilityChanged(visible: boolean) {
		if (!visible) return;

		// Since this gets called even the first time the webview is shown, avoid sending an update, because the bootstrap has the data
		if (this._bootstraping) {
			this._bootstraping = false;

			// If the uri changed since bootstrap still send the update
			if (this._pendingContext == null || !('uri' in this._pendingContext)) {
				return;
			}
		}

		// Should be immediate, but it causes the bubbles to go missing on the chart, since the update happens while it still rendering
		this.updateState();
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenDataPointCommandType.method:
				onIpc(OpenDataPointCommandType, e, async params => {
					if (params.data == null || !params.data.selected || this._context.uri == null) return;

					const repository = this.container.git.getRepository(this._context.uri);
					if (repository == null) return;

					const commit = await repository.getCommit(params.data.id);
					if (commit == null) return;

					void showDetailsView(commit, { pin: false, preserveFocus: true });
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
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Heads, RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
			return;
		}

		if (this.updatePendingContext({ etagRepository: e.repository.etag })) {
			this.updateState();
		}
	}

	@debug({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (this.updatePendingContext({ etagSubscription: e.etag })) {
			this.updateState();
		}
	}

	@debug({ args: false })
	private async getState(current: Context): Promise<State> {
		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';
		const shortDateFormat = configuration.get('defaultDateShortFormat') ?? 'short';
		const period = current.period ?? defaultPeriod;

		if (current.uri == null) {
			const access = await this.container.git.access(PlusFeatures.Timeline);
			return {
				emptyMessage: 'There are no editors open that can provide file history information',
				period: period,
				title: '',
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		const gitUri = await GitUri.fromUri(current.uri);
		const repoPath = gitUri.repoPath!;

		const access = await this.container.git.access(PlusFeatures.Timeline, repoPath);
		if (access.allowed === false) {
			const dataset = generateRandomTimelineDataset();
			return {
				dataset: dataset.sort((a, b) => b.sort - a.sort),
				period: period,
				title: 'src/app/index.ts',
				uri: Uri.file('src/app/index.ts').toString(),
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		const title = gitUri.relativePath;
		this.title = `${this.originalTitle}: ${gitUri.fileName}`;

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
				emptyMessage: 'No commits found for the specified time period',
				period: period,
				title: title,
				sha: gitUri.shortSha,
				uri: current.uri.toString(),
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		let queryRequiredCommits = [
			...filter(
				log.commits.values(),
				c => c.file?.stats == null && getChangedFilesCount(c.stats?.changedFiles) !== 1,
			),
		];

		if (queryRequiredCommits.length !== 0) {
			const limit = configuration.get('visualHistory.queryLimit') ?? 20;

			const repository = this.container.git.getRepository(current.uri);
			const name = repository?.provider.name;

			if (queryRequiredCommits.length > limit) {
				void window.showWarningMessage(
					`Unable able to show more than the first ${limit} commits for the specified time period because of ${
						name ? `${name} ` : ''
					}rate limits.`,
				);
				queryRequiredCommits = queryRequiredCommits.slice(0, 20);
			}

			void (await Promise.allSettled(queryRequiredCommits.map(c => c.ensureFullDetails())));
		}

		const name = currentUser?.name ? `${currentUser.name} (you)` : 'You';

		const dataset: Commit[] = [];
		for (const commit of log.commits.values()) {
			const stats =
				commit.file?.stats ??
				(getChangedFilesCount(commit.stats?.changedFiles) === 1 ? commit.stats : undefined);
			dataset.push({
				author: commit.author.name === 'You' ? name : commit.author.name,
				additions: stats?.additions,
				deletions: stats?.deletions,
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
			sha: gitUri.shortSha,
			uri: current.uri.toString(),
			dateFormat: dateFormat,
			shortDateFormat: shortDateFormat,
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
			const current = (this._context as unknown as Record<string, unknown>)[key];
			if (
				current === value ||
				((current instanceof Uri || value instanceof Uri) && (current as any)?.toString() === value?.toString())
			) {
				continue;
			}

			if (this._pendingContext == null) {
				this._pendingContext = {};
			}

			(this._pendingContext as Record<string, unknown>)[key] = value;
			changed = true;
		}

		return changed;
	}

	private updatePendingEditor(editor: TextEditor | undefined): boolean {
		if (editor == null && hasVisibleTextEditor()) return false;
		if (editor != null && !isTextEditor(editor)) return false;

		return this.updatePendingUri(editor?.document.uri);
	}

	private updatePendingUri(uri: Uri | undefined): boolean {
		let etag;
		if (uri != null) {
			const repository = this.container.git.getRepository(uri);
			etag = repository?.etag ?? 0;
		} else {
			etag = 0;
		}

		return this.updatePendingContext({ uri: uri, etagRepository: etag });
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
		if (!this.isReady || !this.visible) return;

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
		if (this._pendingContext == null) return false;

		const context = { ...this._context, ...this._pendingContext };

		return window.withProgress({ location: { viewId: this.id } }, async () => {
			const success = await this.notify(DidChangeNotificationType, {
				state: await this.getState(context),
			});
			if (success) {
				this._context = context;
				this._pendingContext = undefined;
			}
		});
	}
}
