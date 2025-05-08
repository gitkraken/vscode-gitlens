import type { TabChangeEvent, TabGroupChangeEvent } from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import { proBadge } from '../../../constants';
import type { TimelineShownTelemetryContext, TimelineTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { FileSelectedEvent } from '../../../eventBus';
import {
	openChanges,
	openChangesWithWorking,
	openCommitChanges,
	openCommitChangesWithWorking,
} from '../../../git/actions/commit';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { GitUri } from '../../../git/gitUri';
import { ensureWorkingUri } from '../../../git/gitUri.utils';
import type { GitCommit } from '../../../git/models/commit';
import type { GitFileChange } from '../../../git/models/fileChange';
import type { GitReference } from '../../../git/models/reference';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { uncommitted } from '../../../git/models/revision';
import { getReference } from '../../../git/utils/-webview/reference.utils';
import { getPseudoCommitsWithStats } from '../../../git/utils/-webview/statusFile.utils';
import { getChangedFilesCount } from '../../../git/utils/commit.utils';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '../../../git/utils/revision.utils';
import type { SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../../../quickpicks/referencePicker';
import { executeCommand, registerCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { isDescendant, isFolderGlobUri, isFolderUri } from '../../../system/-webview/path';
import { openTextEditor } from '../../../system/-webview/vscode/editors';
import { getTabUri } from '../../../system/-webview/vscode/tabs';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function/debounce';
import { debounce } from '../../../system/function/debounce';
import { filter, map, some } from '../../../system/iterable';
import { flatten } from '../../../system/object';
import { batch, getSettledValue } from '../../../system/promise';
import { SubscriptionManager } from '../../../system/subscriptionManager';
import { createDisposable } from '../../../system/unifiedDisposable';
import { uriEquals } from '../../../system/uri';
import { isViewFileOrFolderNode } from '../../../views/nodes/utils/-webview/node.utils';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider';
import type { WebviewShowOptions } from '../../webviewsController';
import { isSerializedState } from '../../webviewsController';
import type {
	SelectDataPointParams,
	State,
	TimelineDatum,
	TimelineItemType,
	TimelinePeriod,
	TimelineSliceBy,
} from './protocol';
import {
	ChooseRefRequest,
	DidChangeNotification,
	SelectDataPointCommand,
	UpdateConfigCommand,
	UpdateUriCommand,
} from './protocol';
import type { TimelineWebviewShowingArgs } from './registration';

interface Context {
	config: {
		base: GitReference | undefined;
		period: TimelinePeriod;
		showAllBranches: boolean;
		sliceBy: TimelineSliceBy;
	};
	uri: Uri | undefined;
	itemType: TimelineItemType | undefined;
	etagRepositories: number | undefined;
	etagRepository: number | undefined;
	etagRepositoryWip: number | undefined;
	etagSubscription: number | undefined;
}

const defaultPeriod: TimelinePeriod = '3|M';

export class TimelineWebviewProvider implements WebviewProvider<State, State, TimelineWebviewShowingArgs> {
	private _context: Context;
	private _disposable: Disposable | undefined;

	private get activeTabUri() {
		return getTabUri(window.tabGroups.activeTabGroup.activeTab);
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.timeline' | 'gitlens.timeline'>,
	) {
		this._context = {
			config: { period: defaultPeriod, base: undefined, showAllBranches: false, sliceBy: 'author' },
			uri: undefined,
			itemType: undefined,
			etagRepositories: this.container.git.etag,
			etagRepository: 0,
			etagRepositoryWip: 0,
			etagSubscription: this.container.subscription.etag,
		};

		if (this.host.is('view')) {
			this.host.description = proBadge;
		}
	}

	dispose(): void {
		this._disposable?.dispose();
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
			} else if (isViewFileOrFolderNode(arg)) {
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
			'context.itemType': this._context.itemType,
			'context.period': this._context.config.period,
			'context.showAllBranches': this._context.config.showAllBranches,
			'context.sliceBy': this._context.config.sliceBy,
		};
	}

	async onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>
	): Promise<[boolean, TimelineShownTelemetryContext]> {
		let uri;
		const [arg] = args;
		if (arg != null) {
			if (arg instanceof Uri) {
				uri = arg;
			} else if (isViewFileOrFolderNode(arg)) {
				uri = arg.uri;
			} else if (isSerializedState<State>(arg)) {
				this._context.config = { ...this._context.config, ...arg.state.config };
				if (this.host.is('editor')) {
					uri = arg.state.uri != null ? Uri.parse(arg.state.uri) : undefined;
				}
			}
		}

		uri ??= await ensureWorkingUri(this.container, this.activeTabUri);
		await this.updateUri(uri, true);
		if (this.host.is('editor')) {
			this.fireFileSelected();
		}

		if (!loading) {
			this.updateState();
		}

		const cfg = flatten(configuration.get('visualHistory'), 'context.config', { joinArrays: true });

		return [true, { ...this.getTelemetryContext(), ...cfg }];
	}

	includeBootstrap(): Promise<State> {
		return this.getState(this._context, false);
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
				registerCommand(
					`${this.host.id}.openInTab`,
					() => {
						if (this._context.uri == null) return;

						void executeCommand('gitlens.showFileInTimeline', this._context.uri);
						this.container.telemetry.sendEvent('timeline/action/openInEditor', this.getTelemetryContext());
					},
					this,
				),
			);
		}

		return commands;
	}

	onActiveChanged(active: boolean): void {
		if (active && this.host.is('editor')) {
			this.fireFileSelected();
		}
	}

	async onVisibilityChanged(visible: boolean): Promise<void> {
		if (!visible) {
			this._disposable?.dispose();
			this._repositorySubscription?.pause();

			return;
		}

		this._repositorySubscription?.resume();

		if (this.host.is('editor')) {
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			);
		} else {
			this._disposable = Disposable.from(
				this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
				this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
				window.tabGroups.onDidChangeTabGroups(this.onTabsChanged, this),
				window.tabGroups.onDidChangeTabs(this.onTabsChanged, this),
				this.container.events.on('file:selected', debounce(this.onFileSelected, 250), this),
			);

			await this.updateUri(await ensureWorkingUri(this.container, this.activeTabUri));
		}
	}

	private _openingDataPoint: SelectDataPointParams | undefined;
	private _pendingOpenDataPoint: SelectDataPointParams | undefined;

	async onMessageReceived(e: IpcMessage): Promise<void> {
		switch (true) {
			case ChooseRefRequest.is(e): {
				const { config, uri } = this._context;

				let ref = config.base;
				using respond = createDisposable(() => void this.host.respond(ChooseRefRequest, e, { ref: ref }));

				if (uri == null) return;

				const repo = this.container.git.getRepository(uri);
				if (repo == null) return;

				const pick = await showReferencePicker(
					repo.path,
					'Choose a Base Reference',
					'Choose a reference (branch, tag, etc) as the base to view history from',
					{
						allowRevisions: { ranges: true },
						picked: ref?.ref,
						include: ReferencesQuickPickIncludes.BranchesAndTags | ReferencesQuickPickIncludes.HEAD,
						sort: true,
					},
				);

				if (pick == null) return;

				ref = getReference(pick);
				config.base = ref.ref === 'HEAD' ? undefined : ref;

				respond.dispose();
				this.updateState(true);

				break;
			}
			case SelectDataPointCommand.is(e): {
				if (e.params.id == null || this._context.uri == null) return;

				const { uri } = this._context;

				// If already processing a change, store this request and return
				if (this._openingDataPoint) {
					this._pendingOpenDataPoint = e.params;
					return;
				}

				this._openingDataPoint = e.params;

				try {
					await this.openDataPoint(uri, e.params);
				} finally {
					const current = this._openingDataPoint;
					this._openingDataPoint = undefined;

					// Process the most recent pending request if any
					if (this._pendingOpenDataPoint) {
						const params = this._pendingOpenDataPoint;
						this._pendingOpenDataPoint = undefined;

						if (params.id !== current?.id || params.shift !== current?.shift) {
							void this.openDataPoint(uri, params);
						}
					}
				}

				break;
			}
			case UpdateConfigCommand.is(e): {
				const { config } = this._context;

				let changed = false;
				if (e.params.period != null && e.params.period !== config.period) {
					changed = true;
					config.period = e.params.period;
				}

				if (e.params.showAllBranches != null && e.params.showAllBranches !== config.showAllBranches) {
					changed = true;
					config.showAllBranches = e.params.showAllBranches;
				}

				if (e.params.sliceBy != null && e.params.sliceBy !== config.sliceBy) {
					changed = true;
					config.sliceBy = e.params.sliceBy;
				}

				if (changed) {
					this.container.telemetry.sendEvent('timeline/config/changed', {
						...this.getTelemetryContext(),
						period: config.period,
						showAllBranches: config.showAllBranches,
						sliceBy: config.sliceBy,
					});

					this.updateState(true);
				}

				break;
			}
			case UpdateUriCommand.is(e): {
				if (e.params.uri == null && e.params.path == null) return;

				if (e.params.path != null) {
					const uri = Uri.joinPath(this._context.uri!, e.params.path);
					void this.updateUri(uri);
					return;
				}

				if (e.params.uri != null) {
					void this.updateUri(Uri.parse(e.params.uri));
				}
				break;
			}
		}
	}

	private _tabCloseDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	@debug({ args: false })
	private async onTabsChanged(_e: TabGroupChangeEvent | TabChangeEvent) {
		if (this._tabCloseDebounceTimer != null) {
			clearTimeout(this._tabCloseDebounceTimer);
			this._tabCloseDebounceTimer = undefined;
		}

		const uri = await ensureWorkingUri(this.container, this.activeTabUri);
		if (uri == null) {
			this._tabCloseDebounceTimer = setTimeout(() => {
				this._tabCloseDebounceTimer = undefined;
				void this.updateUri(uri);
			}, 1000);

			return;
		}

		void this.updateUri(uri);
	}

	@debug({ args: false })
	private async onFileSelected(e: FileSelectedEvent) {
		if (e.data == null) return;

		let uri: Uri | undefined = e.data.uri;
		if (uri != null && !this.container.git.isTrackable(uri)) {
			uri = undefined;
		}

		void this.updateUri(await ensureWorkingUri(this.container, uri ?? this.activeTabUri));
	}

	private fireFileSelected() {
		if (this._context.uri == null) return;

		this.container.events.fire(
			'file:selected',
			{
				uri: this._context.uri,
				preserveFocus: true,
				preserveVisibility: false,
			},
			{ source: this.host.id },
		);
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
	private onRepositoryWipChanged(e: RepositoryFileSystemChangeEvent) {
		if (e.repository.id !== this._repositorySubscription?.source?.id) return;

		if (this._context.etagRepositoryWip !== e.repository.etagFileSystem) {
			this._context.etagRepositoryWip = e.repository.etagFileSystem;

			if (
				this._context.uri != null &&
				(e.uris.has(this._context.uri) || some(e.uris, u => isDescendant(u, this._context.uri!)))
			) {
				this.updateState();
			}
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
	private async getState(context: Context, includeDataset: boolean): Promise<State> {
		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';
		const shortDateFormat = configuration.get('defaultDateShortFormat') ?? 'short';

		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		const { uri } = context;
		const repo = uri != null ? this.container.git.getRepository(uri) : undefined;
		const ref = getReference(await repo?.git.branches().getBranch());

		const config = {
			...context.config,
			abbreviatedShaLength: this.container.CommitShaFormatting.length,
			dateFormat: dateFormat,
			shortDateFormat: shortDateFormat,
		};

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;
		const itemType = context.itemType ?? 'file';

		let title;
		let path;
		if (itemType === 'folder') {
			title = gitUri?.relativePath ?? '';
			path = title;
		} else {
			title = gitUri?.fileName ?? '';
			path = gitUri?.relativePath ?? '';
		}

		const item: State['item'] = { type: itemType, path: path };
		const repository: State['repository'] =
			repo != null ? { id: repo.id, uri: repo.uri.toString(), name: repo.name, ref: ref } : undefined;

		if (this.host.is('editor')) {
			this.host.title = `Visual ${itemType === 'folder' ? 'Folder' : 'File'} History${title ? `: ${title}` : ''}`;
		} else {
			this.host.description = title || proBadge;
		}

		const access = await this.container.git.access('timeline', repo?.uri);
		if (access.allowed === false) {
			return {
				...this.host.baseWebviewState,
				dataset: Promise.resolve(generateRandomTimelineDataset(itemType)),
				config: config,
				uri: uri?.toString(),
				item: { type: 'file', path: 'src/app/index.ts' },
				repository: repository,
				access: access,
			};
		}

		return {
			...this.host.baseWebviewState,
			dataset:
				includeDataset && uri != null && repo != null
					? this.getDataset(uri, repo, itemType, context.config)
					: undefined,
			config: config,
			uri: uri?.toString(),
			item: item,
			repository: repository,
			access: access,
		};
	}

	private async getDataset(
		uri: Uri,
		repo: Repository,
		itemType: TimelineItemType,
		config: Context['config'],
	): Promise<TimelineDatum[]> {
		const [currentUserResult, logResult, statusFilesResult] = await Promise.allSettled([
			repo.git.config().getCurrentUser(),
			repo.git.commits().getLogForPath(uri, config.base?.ref, {
				all: config.showAllBranches,
				limit: 0,
				since: getPeriodDate(config.period)?.toISOString(),
			}),
			repo.git.status().getStatusForPath?.(uri, { renames: itemType === 'file' }),
		]);

		const log = getSettledValue(logResult);
		if (log == null) return [];

		const currentUser = getSettledValue(currentUserResult);

		// For virtual repositories, we need to ensure that the commit details are fully loaded, but we need to deal with rate limits
		let queryCommitsWithoutStats = [...filter(log.commits.values(), c => getCommitStats(c, itemType) == null)];
		if (queryCommitsWithoutStats.length) {
			const limit = configuration.get('visualHistory.queryLimit') ?? 20;
			if (queryCommitsWithoutStats.length > limit) {
				const name = repo.provider.name;

				void window.showWarningMessage(
					`Unable able to show more than the first ${limit} commits for the specified time period because of ${
						name ? `${name} ` : ''
					}rate limits.`,
				);
				queryCommitsWithoutStats = queryCommitsWithoutStats.slice(0, 20);
			}

			void (await Promise.allSettled(queryCommitsWithoutStats.map(c => c.ensureFullDetails())));
		}

		const currentUserName = currentUser?.name ? `${currentUser.name} (you)` : 'You';
		const dataset = [...map(log.commits.values(), c => createDatum(c, itemType, currentUserName))];

		if (config.showAllBranches && config.sliceBy === 'branch') {
			const shas = new Set<string>(
				await repo.git.commits().getLogShas?.('^HEAD', { all: true, pathOrUri: uri, limit: 0 }),
			);

			const commitsUnreachableFromHEAD = dataset.filter(d => shas.has(d.sha));
			await batch(
				commitsUnreachableFromHEAD,
				10, // Process 10 commits at a time
				async datum => {
					datum.branches = await repo.git
						.branches()
						.getBranchesWithCommits([datum.sha], undefined, { all: true, mode: 'contains' });
				},
			);
		}

		const statusFiles = getSettledValue(statusFilesResult);
		const pseudoCommits = await getPseudoCommitsWithStats(this.container, statusFiles, true, currentUser);
		if (pseudoCommits?.length) {
			dataset.splice(0, 0, ...map(pseudoCommits, c => createDatum(c, itemType, currentUserName)));
		} else if (dataset.length) {
			dataset.splice(0, 0, {
				author: currentUserName,
				files: 0,
				additions: 0,
				deletions: 0,
				sha: '',
				date: new Date().toISOString(),
				message: 'Uncommitted Changes',
				sort: Date.now(),
			} satisfies TimelineDatum);
		}

		dataset.sort((a, b) => b.sort - a.sort);

		return dataset;
	}

	private async openDataPoint(uri: Uri, params: SelectDataPointParams) {
		const repo = this.container.git.getRepository(uri);
		if (repo == null) return;

		this.container.telemetry.sendEvent('timeline/commit/selected', this.getTelemetryContext());

		const commit = await repo.git.commits().getCommit(params.id || uncommitted);
		if (commit == null) return;

		if (!commit.hasFullDetails()) {
			await commit.ensureFullDetails({ include: { uncommittedFiles: true } });
		}

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

		function getFilesFilter(folderUri: Uri, sha: string): (f: GitFileChange) => boolean {
			if (isUncommitted(sha)) {
				if (isUncommittedStaged(sha)) {
					return f => Boolean(f.staged) && isDescendant(f.uri, folderUri);
				}
				return f => !f.staged && isDescendant(f.uri, folderUri);
			}
			return f => isDescendant(f.uri, folderUri);
		}

		switch (params.itemType) {
			case 'folder':
				if (!params.shift) {
					await openCommitChanges(
						this.container,
						commit,
						false,
						{
							preserveFocus: true,
							preview: true,
							// Since the multi-diff editor doesn't support choosing the view column, we need to do it manually so passing in our view column
							sourceViewColumn: this.host.viewColumn,
							viewColumn: this.host.is('view') ? undefined : ViewColumn.Beside,
							title: `Folder Changes in ${shortenRevision(commit.sha, {
								strings: { working: 'Working Tree' },
							})}`,
						},
						getFilesFilter(uri, commit.sha),
					);
				} else {
					await openCommitChangesWithWorking(
						this.container,
						commit,
						false,
						{
							preserveFocus: true,
							preview: true,
							// Since the multi-diff editor doesn't support choosing the view column, we need to do it manually so passing in our view column
							sourceViewColumn: this.host.viewColumn,
							viewColumn: this.host.is('view') ? undefined : ViewColumn.Beside,
							title: `Folder Changes in ${shortenRevision(commit.sha, {
								strings: { working: 'Working Tree' },
							})}`,
						},
						getFilesFilter(uri, commit.sha),
					);
				}

				break;

			case 'file':
				if (
					commit.isUncommitted &&
					!commit.isUncommittedStaged &&
					!commit.fileset?.files.some(f => f.uri.fsPath === uri.fsPath)
				) {
					void openTextEditor(uri, {
						preserveFocus: true,
						preview: true,
						viewColumn: this.host.is('view') ? undefined : ViewColumn.Beside,
					});

					break;
				}

				if (!params.shift) {
					await openChanges(uri, commit, {
						preserveFocus: true,
						preview: true,
						viewColumn: this.host.is('view') ? undefined : ViewColumn.Beside,
					});
				} else {
					await openChangesWithWorking(uri, commit, {
						preserveFocus: true,
						preview: true,
						viewColumn: this.host.is('view') ? undefined : ViewColumn.Beside,
					});
				}

				break;
		}
	}

	private _repositorySubscription: SubscriptionManager<Repository> | undefined;

	private async updateUri(uri: Uri | undefined, silent?: boolean) {
		if (this._tabCloseDebounceTimer != null) {
			clearTimeout(this._tabCloseDebounceTimer);
			this._tabCloseDebounceTimer = undefined;
		}

		if (uriEquals(uri, this._context.uri)) return;

		this._repositorySubscription?.dispose();
		this._repositorySubscription = undefined;

		let etag;
		if (uri != null) {
			const repo = this.container.git.getRepository(uri);
			if (repo != null) {
				this._repositorySubscription = new SubscriptionManager(repo, r => this.subscribeToRepository(r));
				if (this.host.visible) {
					this._repositorySubscription.start();
				}
			}
			etag = repo?.etag ?? 0;
		} else {
			etag = 0;
		}

		if (this._context.etagRepository !== etag || this._context.uri?.toString() !== uri?.toString()) {
			this._context.etagRepository = etag;
			this._context.uri = uri;
			if (uri != null) {
				if (isFolderGlobUri(uri) || (await isFolderUri(uri))) {
					this._context.itemType = 'folder';
				} else {
					this._context.itemType = 'file';
				}
			} else {
				this._context.itemType = undefined;
			}

			if (silent) return;

			this.container.telemetry.sendEvent('timeline/editor/changed', this.getTelemetryContext());
			this.updateState();
		}
	}

	private subscribeToRepository(repo: Repository): Disposable {
		this._context.etagRepository = repo.etag;
		this._context.etagRepositoryWip = repo.etagFileSystem;

		return Disposable.from(
			// TODO: advanced configuration for the watchFileSystem timing
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(this.onRepositoryWipChanged, this),
			repo.onDidChange(this.onRepositoryChanged, this),
		);
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
			state: await this.getState(this._context, true),
		});
	}
}

function createDatum(commit: GitCommit, itemType: TimelineItemType, currentUserName: string): TimelineDatum {
	let additions: number | undefined;
	let deletions: number | undefined;
	let files: number | undefined;

	const stats = getCommitStats(commit, itemType);
	if (stats != null) {
		({ additions, deletions } = stats);
	}
	if (itemType === 'file') {
		files = undefined;
	} else if (commit.stats != null) {
		files = getChangedFilesCount(commit.stats.files);
	}

	return {
		author: commit.author.name === 'You' ? currentUserName : commit.author.name,
		files: files,
		additions: additions,
		deletions: deletions,
		sha: commit.sha,
		date: commit.date.toISOString(),
		message: commit.message ?? commit.summary,
		sort: commit.date.getTime(),
	};
}

function getCommitStats(
	commit: GitCommit,
	itemType: TimelineItemType,
): { additions: number; deletions: number } | undefined {
	if (itemType === 'file') {
		return commit.file?.stats ?? (getChangedFilesCount(commit.stats?.files) === 1 ? commit.stats : undefined);
	}
	return commit.stats;
}

function getPeriodDate(period: TimelinePeriod): Date | undefined {
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

function generateRandomTimelineDataset(itemType: TimelineItemType): TimelineDatum[] {
	const dataset: TimelineDatum[] = [];
	const authors = ['Eric Amodio', 'Justin Roberts', 'Keith Daulton', 'Ramin Tadayon', 'Ada Lovelace', 'Grace Hopper'];

	const count = 10;
	for (let i = 0; i < count; i++) {
		// Generate a random date between now and 3 months ago
		const date = new Date(new Date().getTime() - Math.floor(Math.random() * (3 * 30 * 24 * 60 * 60 * 1000)));
		const author = authors[Math.floor(Math.random() * authors.length)];

		// Generate random additions/deletions between 1 and 20, but ensure we have a tiny and large commit
		const additions = i === 0 ? 2 : i === count - 1 ? 50 : Math.floor(Math.random() * 20) + 1;
		const deletions = i === 0 ? 1 : i === count - 1 ? 25 : Math.floor(Math.random() * 20) + 1;

		dataset.push({
			sha: Math.random().toString(16).substring(2, 10),
			author: author,
			date: date.toISOString(),
			message: `Commit message for changes by ${author}`,

			files: itemType === 'file' ? undefined : Math.floor(Math.random() * (additions + deletions)) + 1,
			additions: additions,
			deletions: deletions,

			sort: date.getTime(),
		});
	}

	return dataset.sort((a, b) => b.sort - a.sort);
}
