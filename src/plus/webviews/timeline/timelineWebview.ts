import type { TextEditor, ViewColumn } from 'vscode';
import { commands, Disposable, Uri, window } from 'vscode';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import type { CommitSelectedEvent, FileSelectedEvent } from '../../../eventBus';
import { PlusFeatures } from '../../../features';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
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
import type { ViewFileNode } from '../../../views/nodes/viewNode';
import { isViewFileNode } from '../../../views/nodes/viewNode';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import type { WebviewController, WebviewProvider } from '../../../webviews/webviewController';
import { updatePendingContext } from '../../../webviews/webviewController';
import { isSerializedState } from '../../../webviews/webviewsController';
import type { SubscriptionChangeEvent } from '../../subscription/subscriptionService';
import type { Commit, Period, State } from './protocol';
import { DidChangeNotificationType, OpenDataPointCommandType, UpdatePeriodCommandType } from './protocol';

interface Context {
	uri: Uri | undefined;
	period: Period | undefined;
	etagRepositories: number | undefined;
	etagRepository: number | undefined;
	etagSubscription: number | undefined;
}

const defaultPeriod: Period = '3|M';

export class TimelineWebviewProvider implements WebviewProvider<State> {
	private _bootstraping = true;
	/** The context the webview has */
	private _context: Context;
	/** The context the webview should have */
	private _pendingContext: Partial<Context> | undefined;
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._context = {
			uri: undefined,
			period: defaultPeriod,
			etagRepositories: this.container.git.etag,
			etagRepository: 0,
			etagSubscription: this.container.subscription.etag,
		};

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		if (this.host.isEditor()) {
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
				this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
			);
		} else {
			this.host.description = '✨';
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
				this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
				this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
				window.onDidChangeActiveTextEditor(debounce(this.onActiveEditorChanged, 250), this),
				this.container.events.on('file:selected', debounce(this.onFileSelected, 250), this),
			);
		}
	}

	dispose() {
		this._disposable.dispose();
	}

	onShowing(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: [Uri | ViewFileNode | { state: Partial<State> }] | unknown[]
	): boolean {
		const [arg] = args;
		if (arg != null) {
			if (arg instanceof Uri) {
				this.updatePendingUri(arg);
			} else if (isViewFileNode(arg)) {
				this.updatePendingUri(arg.uri);
			} else if (isSerializedState<State>(arg)) {
				this.updatePendingContext({
					period: arg.state.period,
					uri: arg.state.uri != null ? Uri.parse(arg.state.uri) : undefined,
				});
			}
		} else {
			this.updatePendingEditor(window.activeTextEditor);
		}

		if (loading) {
			this._context = { ...this._context, ...this._pendingContext };
			this._pendingContext = undefined;
		} else {
			this.updateState();
		}

		return true;
	}

	includeBootstrap(): Promise<State> {
		this._bootstraping = true;

		this._context = { ...this._context, ...this._pendingContext };
		this._pendingContext = undefined;

		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		if (this.host.isEditor()) {
			return [registerCommand(Commands.RefreshTimelinePage, () => this.host.refresh(true))];
		}

		return [
			registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
			registerCommand(`${this.host.id}.openInTab`, () => this.openInTab(), this),
		];
	}

	onVisibilityChanged(visible: boolean) {
		if (!visible) return;

		if (this.host.isView()) {
			this.updatePendingEditor(window.activeTextEditor);
		}

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

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case OpenDataPointCommandType.method:
				onIpc(OpenDataPointCommandType, e, async params => {
					if (params.data == null || !params.data.selected || this._context.uri == null) return;

					const repository = this.container.git.getRepository(this._context.uri);
					if (repository == null) return;

					const commit = await repository.getCommit(params.data.id);
					if (commit == null) return;

					this.container.events.fire(
						'commit:selected',
						{
							commit: commit,
							interaction: 'active',
							preserveFocus: true,
							preserveVisibility: false,
						},
						{ source: this.host.id },
					);

					if (!this.container.commitDetailsView.ready) {
						void this.container.commitDetailsView.show({ preserveFocus: true }, {
							commit: commit,
							interaction: 'active',
							preserveVisibility: false,
						} satisfies CommitSelectedEvent['data']);
					}
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
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		if (editor != null) {
			if (!isTextEditor(editor)) return;

			if (!this.container.git.isTrackable(editor.document.uri)) {
				editor = undefined;
			}
		}

		if (!this.updatePendingEditor(editor)) return;

		this.updateState();
	}

	@debug({ args: false })
	private onFileSelected(e: FileSelectedEvent) {
		if (e.data == null) return;

		let uri: Uri | undefined = e.data.uri;
		if (uri != null) {
			if (!this.container.git.isTrackable(uri)) {
				uri = undefined;
			}
		}

		if (!this.updatePendingUri(uri)) return;

		this.updateState();
	}

	@debug({ args: false })
	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		const changed = this.updatePendingUri(this._context.uri);

		if (this.updatePendingContext({ etagRepositories: e.etag }) || changed) {
			this.updateState();
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

		const gitUri = current.uri != null ? await GitUri.fromUri(current.uri) : undefined;
		const repoPath = gitUri?.repoPath;

		if (this.host.isEditor()) {
			this.host.title =
				gitUri == null ? this.host.originalTitle : `${this.host.originalTitle}: ${gitUri.fileName}`;
		} else {
			this.host.description = gitUri?.fileName ?? '✨';
		}

		const access = await this.container.git.access(PlusFeatures.Timeline, repoPath);

		if (current.uri == null || gitUri == null || repoPath == null || access.allowed === false) {
			const access = await this.container.git.access(PlusFeatures.Timeline, repoPath);
			return {
				timestamp: Date.now(),
				period: period,
				title: gitUri?.relativePath,
				sha: gitUri?.shortSha,
				uri: current.uri?.toString(),
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		const [currentUser, log] = await Promise.all([
			this.container.git.getCurrentUser(repoPath),
			this.container.git.getLogForFile(repoPath, gitUri.fsPath, {
				limit: 0,
				ref: gitUri.sha,
				since: getPeriodDate(period)?.toISOString(),
			}),
		]);

		if (log == null) {
			return {
				timestamp: Date.now(),
				dataset: [],
				period: period,
				title: gitUri.relativePath,
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
			timestamp: Date.now(),
			dataset: dataset,
			period: period,
			title: gitUri.relativePath,
			sha: gitUri.shortSha,
			uri: current.uri.toString(),
			dateFormat: dateFormat,
			shortDateFormat: shortDateFormat,
			access: access,
		};
	}

	private updatePendingContext(context: Partial<Context>, force?: boolean): boolean {
		const [changed, pending] = updatePendingContext(this._context, this._pendingContext, context, force);
		if (changed) {
			this._pendingContext = pending;
		}

		return changed;
	}

	private updatePendingEditor(editor: TextEditor | undefined, force?: boolean): boolean {
		if (editor == null && hasVisibleTextEditor(this._context.uri ?? this._pendingContext?.uri)) return false;
		if (editor != null && !isTextEditor(editor)) return false;

		return this.updatePendingUri(editor?.document.uri, force);
	}

	private updatePendingUri(uri: Uri | undefined, force?: boolean): boolean {
		let etag;
		if (uri != null) {
			const repository = this.container.git.getRepository(uri);
			etag = repository?.etag ?? 0;
		} else {
			etag = 0;
		}

		return this.updatePendingContext({ uri: uri, etagRepository: etag }, force);
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
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
		this._notifyDidChangeStateDebounced?.cancel();
		if (this._pendingContext == null) return false;

		const context = { ...this._context, ...this._pendingContext };
		this._context = context;
		this._pendingContext = undefined;

		const task = async () =>
			this.host.notify(DidChangeNotificationType, {
				state: await this.getState(context),
			});

		if (!this.host.isView()) return task();
		return window.withProgress({ location: { viewId: this.host.id } }, task);
	}

	private openInTab() {
		const uri = this._context.uri;
		if (uri == null) return;

		void commands.executeCommand(Commands.ShowTimelinePage, uri);
	}
}

function getPeriodDate(period: Period): Date | undefined {
	if (period == 'all') return undefined;

	const [number, unit] = period.split('|');

	let date;
	switch (unit) {
		case 'D':
			date = createFromDateDelta(new Date(), { days: -parseInt(number, 10) });
			break;
		case 'M':
			date = createFromDateDelta(new Date(), { months: -parseInt(number, 10) });
			break;
		case 'Y':
			date = createFromDateDelta(new Date(), { years: -parseInt(number, 10) });
			break;
		default:
			date = createFromDateDelta(new Date(), { months: -3 });
			break;
	}

	// If we are more than 1/2 way through the day, then set the date to the next day
	if (date.getHours() >= 12) {
		date.setDate(date.getDate() + 1);
	}
	date.setHours(0, 0, 0, 0);
	return date;
}
