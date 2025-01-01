import { Disposable, Uri, window } from 'vscode';
import { proBadge } from '../../../constants';
import { GlCommand } from '../../../constants.commands';
import type { TimelineShownTelemetryContext, TimelineTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { CommitSelectedEvent, FileSelectedEvent } from '../../../eventBus';
import { PlusFeatures } from '../../../features';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { GitUri } from '../../../git/gitUri';
import { getChangedFilesCount } from '../../../git/models/commit.utils';
import type { RepositoryChangeEvent } from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import type { SubscriptionChangeEvent } from '../../../plus/gk/account/subscriptionService';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function';
import { debounce } from '../../../system/function';
import { filter } from '../../../system/iterable';
import { flatten } from '../../../system/object';
import { getSettledValue } from '../../../system/promise';
import { executeCommand, registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import { getTabUri } from '../../../system/vscode/utils';
import { isViewFileNode } from '../../../views/nodes/abstract/viewFileNode';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider';
import type { WebviewShowOptions } from '../../webviewsController';
import { isSerializedState } from '../../webviewsController';
import type { Commit, Period, State } from './protocol';
import { DidChangeNotification, OpenDataPointCommand, UpdatePeriodCommand } from './protocol';
import type { TimelineWebviewShowingArgs } from './registration';

interface Context {
	uri: Uri | undefined;
	period: Period | undefined;
	etagRepositories: number | undefined;
	etagRepository: number | undefined;
	etagSubscription: number | undefined;
}

const defaultPeriod: Period = '3|M';

export class TimelineWebviewProvider implements WebviewProvider<State, State, TimelineWebviewShowingArgs> {
	private _context: Context;
	private readonly _disposable: Disposable;

	private get activeTabUri() {
		return getTabUri(window.tabGroups.activeTabGroup.activeTab);
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.timeline' | 'gitlens.timeline'>,
	) {
		this._context = {
			uri: undefined,
			period: defaultPeriod,
			etagRepositories: this.container.git.etag,
			etagRepository: 0,
			etagSubscription: this.container.subscription.etag,
		};

		if (this.host.isHost('editor')) {
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
				this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
			);
		} else {
			this.host.description = proBadge;
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
				this.container.git.onDidChangeRepository(this.onRepositoryChanged, this),
				this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
				window.tabGroups.onDidChangeTabGroups(this.onTabsChanged, this),
				window.tabGroups.onDidChangeTabs(this.onTabsChanged, this),
				this.container.events.on('file:selected', debounce(this.onFileSelected, 250), this),
			);
		}
	}

	dispose() {
		this._disposable.dispose();
	}

	onReloaded(): void {
		this.updateState(true);
	}

	canReuseInstance(...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>): boolean | undefined {
		let uri: Uri | undefined;

		const [arg] = args;
		if (arg != null) {
			if (arg instanceof Uri) {
				uri = arg;
			} else if (isViewFileNode(arg)) {
				uri = arg.uri;
			} else if (isSerializedState<State>(arg) && arg.state.uri != null) {
				uri = Uri.parse(arg.state.uri);
			}
		} else {
			uri = this.activeTabUri;
		}

		return uri?.toString() === this._context.uri?.toString() ? true : undefined;
	}

	getSplitArgs(): WebviewShowingArgs<TimelineWebviewShowingArgs, State> {
		return this._context.uri != null ? [this._context.uri] : [];
	}

	getTelemetryContext(): TimelineTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.period': this._context.period,
		};
	}

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>
	): [boolean, TimelineShownTelemetryContext] {
		let uri;
		const [arg] = args;
		if (arg != null) {
			if (arg instanceof Uri) {
				uri = arg;
			} else if (isViewFileNode(arg)) {
				uri = arg.uri;
			} else if (isSerializedState<State>(arg)) {
				this._context.period = arg.state.period;
				if (this.host.isHost('editor')) {
					uri = arg.state.uri != null ? Uri.parse(arg.state.uri) : undefined;
				}
			}
		}

		this.updateUri(uri ?? this.activeTabUri, true);
		if (!loading) {
			this.updateState();
		}

		const cfg = flatten(configuration.get('visualHistory'), 'context.config', { joinArrays: true });

		return [
			true,
			{
				...this.getTelemetryContext(),
				...cfg,
				'context.period': this._context.period,
			},
		];
	}

	includeBootstrap(): Promise<State> {
		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.isHost('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
				registerCommand(
					`${this.host.id}.openInTab`,
					() => {
						if (this._context.uri == null) return;

						void executeCommand(GlCommand.ShowInTimeline, this._context.uri);
						this.container.telemetry.sendEvent('timeline/action/openInEditor', this.getTelemetryContext());
					},
					this,
				),
			);
		}

		return commands;
	}

	onVisibilityChanged(visible: boolean) {
		if (!visible) return;

		if (this.host.isHost('view')) {
			this.updateUri(this.activeTabUri);
		}
	}

	async onMessageReceived(e: IpcMessage) {
		switch (true) {
			case OpenDataPointCommand.is(e): {
				if (e.params.data == null || !e.params.data.selected || this._context.uri == null) return;

				const repository = this.container.git.getRepository(this._context.uri);
				if (repository == null) return;

				const commit = await repository.git.getCommit(e.params.data.id);
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

				this.container.telemetry.sendEvent('timeline/commit/selected', this.getTelemetryContext());

				if (!this.container.views.commitDetails.ready) {
					void this.container.views.commitDetails.show({ preserveFocus: true }, {
						commit: commit,
						interaction: 'active',
						preserveVisibility: false,
					} satisfies CommitSelectedEvent['data']);
				}

				break;
			}
			case UpdatePeriodCommand.is(e): {
				if (this._context.period === e.params.period) return;

				this.container.telemetry.sendEvent('timeline/period/changed', {
					...this.getTelemetryContext(),
					'period.old': this._context.period,
					'period.new': e.params.period,
				});

				this._context.period = e.params.period;
				this.updateState(true);

				break;
			}
		}
	}

	@debug()
	private onTabsChanged() {
		this.updateUri(this.activeTabUri);
	}

	@debug({ args: false })
	private onFileSelected(e: FileSelectedEvent) {
		if (e.data == null) return;

		let uri: Uri | undefined = e.data.uri;
		if (uri != null && !this.container.git.isTrackable(uri)) {
			uri = undefined;
		}

		this.updateUri(this.activeTabUri);
	}

	@debug({ args: false })
	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		if (this._context.etagRepositories !== e.etag) {
			this._context.etagRepositories = e.etag;
			this.updateState();
		}
	}

	@debug({ args: false })
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Heads, RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
			return;
		}

		if (this._context.etagRepository !== e.repository.etag) {
			this._context.etagRepository = e.repository.etag;
			this.updateState();
		}
	}

	@debug({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (this._context.etagSubscription !== e.etag) {
			this._context.etagSubscription = e.etag;
			this.updateState();
		}
	}

	@debug({ args: false })
	private async getState(context: Context): Promise<State> {
		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';
		const shortDateFormat = configuration.get('defaultDateShortFormat') ?? 'short';
		const period = context.period ?? defaultPeriod;

		const gitUri = context.uri != null ? await GitUri.fromUri(context.uri) : undefined;
		const repoPath = gitUri?.repoPath;

		if (this.host.isHost('editor')) {
			this.host.title =
				gitUri == null ? this.host.originalTitle : `${this.host.originalTitle}: ${gitUri.fileName}`;
		} else {
			this.host.description = gitUri?.fileName ?? proBadge;
		}

		const access = await this.container.git.access(PlusFeatures.Timeline, repoPath);
		if (access.allowed === false) {
			return {
				...this.host.baseWebviewState,
				dataset: Promise.resolve(generateRandomTimelineDataset()),
				period: period,
				title: 'src/app/index.ts',
				sha: undefined,
				uri: context.uri?.toString(),
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		if (context.uri == null || gitUri == null || repoPath == null) {
			return {
				...this.host.baseWebviewState,
				period: period,
				title: gitUri?.relativePath,
				sha: gitUri?.shortSha,
				uri: context.uri?.toString(),
				dateFormat: dateFormat,
				shortDateFormat: shortDateFormat,
				access: access,
			};
		}

		return {
			...this.host.baseWebviewState,
			dataset: this.getDataset(gitUri, period),
			period: period,
			title: gitUri.relativePath,
			sha: gitUri.shortSha,
			uri: context.uri.toString(),
			dateFormat: dateFormat,
			shortDateFormat: shortDateFormat,
			access: access,
		};
	}

	private async getDataset(gitUri: GitUri, period: Period): Promise<Commit[]> {
		const repoPath = gitUri.repoPath!;

		const [currentUserResult, logResult] = await Promise.allSettled([
			this.container.git.getCurrentUser(repoPath),
			this.container.git.getLogForFile(repoPath, gitUri.fsPath, {
				limit: 0,
				ref: gitUri.sha,
				since: getPeriodDate(period)?.toISOString(),
			}),
		]);

		const log = getSettledValue(logResult);
		if (log == null) return [];

		const currentUser = getSettledValue(currentUserResult);

		let queryRequiredCommits = [
			...filter(log.commits.values(), c => c.file?.stats == null && getChangedFilesCount(c.stats?.files) !== 1),
		];

		if (queryRequiredCommits.length !== 0) {
			const limit = configuration.get('visualHistory.queryLimit') ?? 20;

			const repository = this.container.git.getRepository(gitUri);
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
				commit.file?.stats ?? (getChangedFilesCount(commit.stats?.files) === 1 ? commit.stats : undefined);
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

		return dataset;
	}

	private updateUri(uri: Uri | undefined, silent?: boolean) {
		let etag;
		if (uri != null) {
			const repository = this.container.git.getRepository(uri);
			etag = repository?.etag ?? 0;
		} else {
			etag = 0;
		}

		if (this._context.etagRepository !== etag || this._context.uri?.toString() !== uri?.toString()) {
			this._context.etagRepository = etag;
			this._context.uri = uri;

			if (silent) return;

			this.container.telemetry.sendEvent('timeline/editor/changed', this.getTelemetryContext());
			this.updateState();
		}
	}

	private _notifyDidChangeStateDebounced: Deferrable<() => void> | undefined = undefined;

	@debug()
	private updateState(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		this._notifyDidChangeStateDebounced ??= debounce(this.notifyDidChangeState.bind(this), 500);
		this._notifyDidChangeStateDebounced();
	}

	@debug()
	private async notifyDidChangeState() {
		this._notifyDidChangeStateDebounced?.cancel();

		return this.host.notify(DidChangeNotification, {
			state: await this.getState(this._context),
		});
	}
}

function getPeriodDate(period: Period): Date | undefined {
	if (period === 'all') return undefined;

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

function generateRandomTimelineDataset(): Commit[] {
	const dataset: Commit[] = [];
	const authors = ['Eric Amodio', 'Justin Roberts', 'Keith Daulton', 'Ramin Tadayon', 'Ada Lovelace', 'Grace Hopper'];

	const count = 10;
	for (let i = 0; i < count; i++) {
		// Generate a random date between now and 3 months ago
		const date = new Date(new Date().getTime() - Math.floor(Math.random() * (3 * 30 * 24 * 60 * 60 * 1000)));

		dataset.push({
			commit: String(i),
			author: authors[Math.floor(Math.random() * authors.length)],
			date: date.toISOString(),
			message: '',
			// Generate random additions/deletions between 1 and 20, but ensure we have a tiny and large commit
			additions: i === 0 ? 2 : i === count - 1 ? 50 : Math.floor(Math.random() * 20) + 1,
			deletions: i === 0 ? 1 : i === count - 1 ? 25 : Math.floor(Math.random() * 20) + 1,
			sort: date.getTime(),
		});
	}

	return dataset.sort((a, b) => b.sort - a.sort);
}
