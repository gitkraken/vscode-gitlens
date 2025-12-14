import type { TabChangeEvent, TabGroupChangeEvent } from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import { proBadge } from '../../../constants';
import type { TimelineShownTelemetryContext, TimelineTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { FileSelectedEvent } from '../../../eventBus';
import type { FeatureAccess, RepoFeatureAccess } from '../../../features';
import {
	openChanges,
	openChangesWithWorking,
	openCommitChanges,
	openCommitChangesWithWorking,
} from '../../../git/actions/commit';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { ensureWorkingUri } from '../../../git/gitUri.utils';
import type { GitCommit } from '../../../git/models/commit';
import type { GitFileChange } from '../../../git/models/fileChange';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { uncommitted } from '../../../git/models/revision';
import { getReference } from '../../../git/utils/-webview/reference.utils';
import { toRepositoryShape } from '../../../git/utils/-webview/repository.utils';
import { getPseudoCommitsWithStats } from '../../../git/utils/-webview/statusFile.utils';
import { getChangedFilesCount } from '../../../git/utils/commit.utils';
import { createReference } from '../../../git/utils/reference.utils';
import {
	createRevisionRange,
	isUncommitted,
	isUncommittedStaged,
	shortenRevision,
} from '../../../git/utils/revision.utils';
import type { SubscriptionChangeEvent } from '../../../plus/gk/subscriptionService';
import { Directive } from '../../../quickpicks/items/directive';
import type { ReferencesQuickPickIncludes } from '../../../quickpicks/referencePicker';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker2 } from '../../../quickpicks/repositoryPicker';
import { showRevisionFilesPicker } from '../../../quickpicks/revisionFilesPicker';
import { executeCommand, registerCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { isDescendant } from '../../../system/-webview/path';
import { openTextEditor } from '../../../system/-webview/vscode/editors';
import { getTabUri } from '../../../system/-webview/vscode/tabs';
import { createFromDateDelta } from '../../../system/date';
import { debug } from '../../../system/decorators/log';
import type { Deferrable } from '../../../system/function/debounce';
import { debounce } from '../../../system/function/debounce';
import { map, some } from '../../../system/iterable';
import { flatten } from '../../../system/object';
import { basename } from '../../../system/path';
import { batch, getSettledValue } from '../../../system/promise';
import { PromiseCache } from '../../../system/promiseCache';
import { SubscriptionManager } from '../../../system/subscriptionManager';
import { createDisposable } from '../../../system/unifiedDisposable';
import { areUrisEqual } from '../../../system/uri';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider';
import type { WebviewShowOptions } from '../../webviewsController';
import { isSerializedState } from '../../webviewsController';
import type {
	ChoosePathParams,
	ChooseRefParams,
	DidChooseRefParams,
	SelectDataPointParams,
	State,
	TimelineDatum,
	TimelinePeriod,
	TimelineScope,
	TimelineScopeType,
	TimelineSliceBy,
	UpdateConfigParams,
	UpdateScopeParams,
} from './protocol';
import {
	ChoosePathRequest,
	ChooseRefRequest,
	DidChangeNotification,
	SelectDataPointCommand,
	UpdateConfigCommand,
	UpdateScopeCommand,
} from './protocol';
import type { TimelineWebviewShowingArgs } from './registration';
import {
	areTimelineScopesEqual,
	areTimelineScopesEquivalent,
	deserializeTimelineScope,
	isTimelineScope,
	serializeTimelineScope,
} from './utils/-webview/timeline.utils';

interface Context {
	config: {
		period: TimelinePeriod;
		showAllBranches: boolean;
		sliceBy: TimelineSliceBy;
	};
	scope: TimelineScope | undefined;
	etags: {
		repositories: number | undefined;
		repository: number | undefined;
		repositoryWip: number | undefined;
		subscription: number | undefined;
	};
}

const defaultPeriod: TimelinePeriod = '3|M';

export class TimelineWebviewProvider implements WebviewProvider<State, State, TimelineWebviewShowingArgs> {
	private _context: Context;
	private _disposable: Disposable | undefined;
	private _cache = new PromiseCache<'bootstrap' | 'state', State>({ accessTTL: 1000 * 60 * 5 });

	private get activeTabUri() {
		return getTabUri(window.tabGroups.activeTabGroup.activeTab);
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.timeline' | 'gitlens.timeline'>,
	) {
		this._context = {
			config: { period: defaultPeriod, showAllBranches: false, sliceBy: 'author' },
			scope: undefined,
			etags: {
				repositories: this.container.git.etag,
				repository: undefined,
				repositoryWip: undefined,
				subscription: this.container.subscription.etag,
			},
		};

		if (this.host.is('view')) {
			this.host.description = proBadge;
		}
	}

	dispose(): void {
		this._cache.clear();
		this._disposable?.dispose();
	}

	canReuseInstance(...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>): boolean | undefined {
		let scope: TimelineScope | undefined;

		const [arg] = args;
		if (arg != null) {
			if (isTimelineScope(arg)) {
				scope = arg;
			} else if (isSerializedState<State>(arg) && arg.state.scope?.uri != null) {
				scope = deserializeTimelineScope(arg.state.scope);
			}
		} else {
			const uri = this.activeTabUri;
			if (uri != null) {
				scope = { type: 'file', uri: uri };
			}
		}

		return areTimelineScopesEquivalent(scope, this._context.scope);
	}

	getSplitArgs(): WebviewShowingArgs<TimelineWebviewShowingArgs, State> {
		return this._context.scope != null ? [this._context.scope] : [];
	}

	getTelemetryContext(): TimelineTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.period': this._context.config.period,
			'context.scope.hasHead': this._context.scope?.head != null,
			'context.scope.hasBase': this._context.scope?.base != null,
			'context.scope.type': this._context.scope?.type,
			'context.showAllBranches': this._context.config.showAllBranches,
			'context.sliceBy': this._context.config.sliceBy,
		};
	}

	async onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>
	): Promise<[boolean, TimelineShownTelemetryContext]> {
		let scope: TimelineScope | undefined;

		const [arg] = args;
		if (arg != null) {
			if (isTimelineScope(arg)) {
				scope = arg;
			} else if (isSerializedState<State>(arg) && arg.state.scope != null) {
				this._context.config = { ...this._context.config, ...arg.state.config };
				// Only re-use the serialized state if we are in an editor (as the view alwaysfollows the active tab)
				if (this.host.is('editor')) {
					scope = {
						type: arg.state.scope.type,
						uri: Uri.parse(arg.state.scope.uri),
						head: arg.state.scope.head,
					};
				}
			}
		}

		if (scope == null) {
			let uri = await ensureWorkingUri(this.container, this.activeTabUri);
			if (uri != null) {
				scope = { type: 'file', uri: uri };
			} else if (this.host.is('editor')) {
				uri = this.container.git.getBestRepositoryOrFirst()?.uri;
				if (uri != null) {
					scope = { type: 'repo', uri: uri };
				}
			}
		}

		const changed = await this.updateScope(scope, true, true);
		if (!loading && (changed || !this.host.visible)) {
			this.updateState();
		}

		const cfg = flatten(configuration.get('visualHistory'), 'context.config', { joinArrays: true });

		return [true, { ...this.getTelemetryContext(), ...cfg }];
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		return this._cache.getOrCreate('bootstrap', () => this.getState(this._context, false));
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
				registerCommand(
					`${this.host.id}.openInTab`,
					() => {
						// Only allow files in the timeline view
						if (this._context.scope?.type !== 'file') return;

						void executeCommand<TimelineScope>('gitlens.visualizeHistory', this._context.scope);
						this.container.telemetry.sendEvent('timeline/action/openInEditor', {
							...this.getTelemetryContext(),
							'scope.type': this._context.scope.type,
							'scope.hasHead': this._context.scope.head != null,
							'scope.hasBase': this._context.scope.base != null,
						});
					},
					this,
				),
			);
		}

		return commands;
	}

	onActiveChanged(active: boolean): void {
		if (active) {
			this.fireFileSelected();
		}
	}

	async onReady(): Promise<void> {
		await this.updateScope(this._context.scope, true);
		this.updateState(true);
	}

	onRefresh(_force?: boolean): void {
		this._cache.clear();
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

			const uri = await ensureWorkingUri(this.container, this.activeTabUri);
			void this.updateScope(uri ? { type: 'file', uri: uri } : undefined);
		}
	}

	private _openingDataPoint: SelectDataPointParams | undefined;
	private _pendingOpenDataPoint: SelectDataPointParams | undefined;

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case ChoosePathRequest.is(e):
				void this.onMessageChoosePath(e);
				break;

			case ChooseRefRequest.is(e):
				void this.onMessageChooseRef(e);
				break;

			case SelectDataPointCommand.is(e):
				void this.onMessageSelectDataPoint(e);
				break;

			case UpdateConfigCommand.is(e):
				this.onMessageUpdateConfig(e);
				break;

			case UpdateScopeCommand.is(e):
				void this.onMessageUpdateScope(e);
				break;
		}
	}

	private async onMessageChoosePath(e: IpcMessage<ChoosePathParams>) {
		const { repoUri: repoPath, ref, title, initialPath } = e.params;
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) {
			void this.host.respond(ChoosePathRequest, e, { picked: undefined });
			return;
		}

		const picked = await showRevisionFilesPicker(this.container, createReference(ref?.ref ?? 'HEAD', repo.path), {
			allowFolders: true,
			initialPath: initialPath,
			title: title,
		});

		void this.host.respond(ChoosePathRequest, e, {
			picked:
				picked != null
					? {
							type: picked.type,
							relativePath: this.container.git.getRelativePath(picked.uri, repo.uri),
						}
					: undefined,
		});
	}

	private async onMessageChooseRef(e: IpcMessage<ChooseRefParams>) {
		let response: DidChooseRefParams | undefined;
		using respond = createDisposable(() => void this.host.respond(ChooseRefRequest, e, response));

		const { scope } = this._context;
		if (scope == null || e.params.scope == null) return;

		const repo = this.container.git.getRepository(e.params.scope.uri);
		if (repo == null) return;

		if (!areTimelineScopesEqual(e.params.scope, scope)) {
			debugger;
			await this.updateScope(deserializeTimelineScope(e.params.scope));
		}

		let ref = e.params.type === 'base' ? scope.base : scope.head;

		const include: ReferencesQuickPickIncludes[] = ['branches', 'tags', 'HEAD'];
		if (!repo.virtual && !this._context.config.showAllBranches && e.params.type !== 'base') {
			include.push('allBranches');
		}

		const pick = await showReferencePicker2(
			repo.path,
			e.params.type === 'base' ? 'Choose a Base Reference' : 'Choose a Head Reference',
			e.params.type === 'base'
				? 'Choose a reference (branch, tag, etc) as the base to view history from'
				: 'Choose a reference (branch, tag, etc) as the head to view history for',
			{
				allowedAdditionalInput: { rev: true /*, range: true */ },
				picked: ref?.ref,
				include: include,
				sort: true,
			},
		);

		// All branches case
		if (pick.directive === Directive.RefsAllBranches) {
			response = { type: e.params.type, ref: null };
			respond.dispose();
			return;
		}
		if (pick.value == null) return;

		if (pick.value.ref === 'HEAD') {
			ref = getReference(pick.value);

			// const branch = await repo.git2.branches.getBranch();
			// ref = getReference(branch ?? pick.value);

			// const resolved = await repo.git2.revision.resolveRevision('HEAD');
			// ref = resolved != null ? createReference(resolved.sha, repo.path) : ref;
		} else {
			ref = getReference(pick.value);
		}
		response = { type: e.params.type, ref: ref };
		respond.dispose();
	}

	private async onMessageSelectDataPoint(e: IpcMessage<SelectDataPointParams>) {
		if (e.params.scope == null || e.params.id == null) return;

		// If already processing a change, store this request and return
		if (this._openingDataPoint) {
			this._pendingOpenDataPoint = e.params;
			return;
		}

		this._openingDataPoint = e.params;

		try {
			await this.openDataPoint(e.params);
		} finally {
			const current = this._openingDataPoint;
			this._openingDataPoint = undefined;

			// Process the most recent pending request if any
			if (this._pendingOpenDataPoint) {
				const params = this._pendingOpenDataPoint;
				this._pendingOpenDataPoint = undefined;

				if (params.id !== current?.id || params.shift !== current?.shift) {
					void this.openDataPoint(params);
				}
			}
		}
	}

	private onMessageUpdateConfig(e: IpcMessage<UpdateConfigParams>) {
		const { config } = this._context;

		let changed = false;

		const { changes } = e.params;
		if (changes.period != null && changes.period !== config.period) {
			changed = true;
			config.period = changes.period;
		}

		if (changes.showAllBranches != null && changes.showAllBranches !== config.showAllBranches) {
			changed = true;
			config.showAllBranches = changes.showAllBranches;

			if (config.sliceBy === 'branch' && !config.showAllBranches) {
				config.sliceBy = 'author';
			}
		}

		if (changes.sliceBy != null && changes.sliceBy !== config.sliceBy) {
			changed = true;
			config.sliceBy = changes.sliceBy;

			if (config.sliceBy === 'branch' && !config.showAllBranches) {
				config.showAllBranches = true;
			}
		}

		if (changed) {
			this.container.telemetry.sendEvent('timeline/config/changed', {
				...this.getTelemetryContext(),
				period: config.period,
				showAllBranches: config.showAllBranches,
				sliceBy: config.sliceBy,
			});

			this._cache.clear();
			this.updateState(true);
		}
	}

	private async onMessageUpdateScope(e: IpcMessage<UpdateScopeParams>) {
		if (e.params.scope == null) return;

		let repo = this.container.git.getRepository(e.params.scope.uri);
		if (repo == null) return;

		const scope = deserializeTimelineScope(e.params.scope);

		const {
			changes: { type, head, base, relativePath },
		} = e.params;

		let changed = false;
		if (type != null && type !== scope.type) {
			changed = true;
			scope.type = type;
			if (type === 'repo') {
				scope.uri = repo.uri;
			}
		} else if (type === 'repo' && scope.type === 'repo') {
			const { title, placeholder } = await getRepositoryPickerTitleAndPlaceholder(
				this.container.git.openRepositories,
				'Switch',
				repo?.name,
			);
			const result = await showRepositoryPicker2(
				this.container,
				title,
				placeholder,
				this.container.git.openRepositories,
				{ picked: repo },
			);
			if (result.value != null && !areUrisEqual(result.value.uri, scope.uri)) {
				repo = result.value;
				changed = true;
				scope.uri = result.value.uri;
				scope.head = undefined;
				scope.base = undefined;
			}
		}

		if (head !== undefined) {
			changed = true;
			scope.head = head ?? undefined;
		}

		if (base !== undefined) {
			changed = true;
			scope.base = base ?? undefined;
		}

		if (relativePath != null) {
			changed = true;
			scope.uri = this.container.git.getAbsoluteUri(relativePath, repo.uri);
		}

		// If we are changing the type, and in the view, open it in the editor
		if (this.host.is('view') || e.params.altOrShift) {
			void executeCommand<TimelineScope>('gitlens.visualizeHistory', scope);
			this.container.telemetry.sendEvent('timeline/action/openInEditor', {
				...this.getTelemetryContext(),
				'scope.type': scope.type,
				'scope.hasHead': scope.head != null,
				'scope.hasBase': scope.base != null,
			});
			return;
		}

		if (!changed) return;

		void this.updateScope(scope);
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
			this._tabCloseDebounceTimer = setTimeout(async () => {
				this._tabCloseDebounceTimer = undefined;
				const changed = await this.updateScope(uri, undefined, true);
				if (changed) {
					this.container.telemetry.sendEvent('timeline/editor/changed', this.getTelemetryContext());
				}
			}, 1000);

			return;
		}

		const changed = await this.updateScope(uri ? { type: 'file', uri: uri } : undefined, undefined, true);
		if (changed) {
			this.container.telemetry.sendEvent('timeline/editor/changed', this.getTelemetryContext());
		}
	}

	@debug({ args: false })
	private async onFileSelected(e: FileSelectedEvent) {
		if (e.data == null) return;

		let uri: Uri | undefined = e.data.uri;
		if (uri != null && !this.container.git.isTrackable(uri)) {
			uri = undefined;
		}

		uri = await ensureWorkingUri(this.container, uri ?? this.activeTabUri);
		const changed = await this.updateScope(uri ? { type: 'file', uri: uri } : undefined, undefined, true);
		if (changed) {
			this.container.telemetry.sendEvent('timeline/editor/changed', this.getTelemetryContext());
		}
	}

	private fireFileSelected() {
		if (this._context.scope?.type !== 'file' || !this.host.is('editor')) return;

		this.container.events.fire(
			'file:selected',
			{ uri: this._context.scope.uri, preserveFocus: true, preserveVisibility: false },
			{ source: this.host.id },
		);
	}

	@debug({ args: false })
	private onRepositoriesChanged(e: RepositoriesChangeEvent) {
		if (this._context.etags.repositories === e.etag) return;
		void this.updateScope(this._context.scope);
	}

	@debug({ args: false })
	private onRepositoryChanged(e: RepositoryChangeEvent) {
		if (!e.changed(RepositoryChange.Heads, RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
			return;
		}

		if (this._context.etags.repository === e.repository.etag) return;
		void this.updateScope(this._context.scope);
	}

	@debug({ args: false })
	private onRepositoryWipChanged(e: RepositoryFileSystemChangeEvent) {
		if (e.repository.id !== this._repositorySubscription?.source?.id) return;

		if (this._context.etags.repositoryWip === e.repository.etagFileSystem) return;

		const uri = this._context.scope?.uri;
		if (uri != null && (e.uris.has(uri) || some(e.uris, u => isDescendant(u, uri)))) {
			void this.updateScope(this._context.scope);
		} else {
			this._context.etags.repositoryWip = e.repository.etagFileSystem;
		}
	}

	@debug({ args: false })
	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (this._context.etags.subscription === e.etag) return;
		void this.updateScope(this._context.scope);
	}

	@debug({ args: false })
	private async getState(context: Context, includeDataset: boolean): Promise<State> {
		const dateFormat = configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma';
		const shortDateFormat = configuration.get('defaultDateShortFormat') ?? 'short';

		const { git } = this.container;
		const { scope } = context;

		const config: State['config'] = {
			...context.config,
			abbreviatedShaLength: this.container.CommitShaFormatting.length,
			dateFormat: dateFormat,
			shortDateFormat: shortDateFormat,
		};

		if (git.isDiscoveringRepositories) {
			await git.isDiscoveringRepositories;
		}

		const repo =
			scope?.uri != null
				? (git.getRepository(scope.uri) ?? (await git.getOrOpenRepository(scope.uri, { closeOnOpen: true })))
				: undefined;
		const access = await git.access('timeline', repo?.uri);

		if (scope == null || repo == null) {
			return {
				...this.host.baseWebviewState,
				dataset: undefined,
				config: config,
				scope: undefined,
				repository: undefined,
				repositories: { count: 0, openCount: 0 },
				access: access,
			};
		}

		const { uri } = scope;
		const relativePath = git.getRelativePath(uri, repo.uri);
		const ref = getReference(await repo.git.branches.getBranch());
		const repository: State['repository'] = repo != null ? { ...toRepositoryShape(repo), ref: ref } : undefined;

		scope.head ??= ref;
		if (scope.base == null) {
			// const mergeTarget = await repo.git2.branches.getBestMergeTargetBranchName?.(scope.head!.ref);
			// if (mergeTarget != null) {
			// 	const mergeBase = await repo.git2.refs.getMergeBase?.(scope.head!.ref, mergeTarget);
			// 	if (mergeBase != null) {
			// 		scope.base = createReference(mergeBase, repo.path, { refType: 'revision' });
			// 	}
			// }

			scope.base ??= scope.head;
		}

		return {
			...this.host.baseWebviewState,
			dataset: includeDataset ? this.getDataset(scope, repo, context.config, access) : undefined,
			config: config,
			scope: serializeTimelineScope(scope as Required<TimelineScope>, relativePath),
			repository: repository,
			repositories: {
				count: this.container.git.repositoryCount,
				openCount: this.container.git.openRepositoryCount,
			},
			access: access,
		};
	}

	private async getDataset(
		scope: TimelineScope,
		repo: Repository,
		config: Context['config'],
		access: RepoFeatureAccess | FeatureAccess,
	): Promise<TimelineDatum[]> {
		if (access.allowed === false) {
			return generateRandomTimelineDataset(scope.type);
		}

		let ref;
		if (!config.showAllBranches) {
			ref = scope.head?.ref;
			if (ref) {
				if (scope.base?.ref != null && scope.base?.ref !== ref) {
					ref = createRevisionRange(ref, scope.base?.ref, '..');
				}
			} else {
				ref = scope.base?.ref;
			}
		}

		const [contributorsResult, statusFilesResult, currentUserResult] = await Promise.allSettled([
			repo.git.contributors.getContributors(ref, {
				all: config.showAllBranches,
				pathspec: scope.type === 'repo' ? undefined : scope.uri.fsPath,
				since: getPeriodDate(config.period)?.toISOString(),
				stats: true,
			}),
			repo.virtual
				? undefined
				: scope.type !== 'repo'
					? repo.git.status.getStatusForPath?.(scope.uri, { renames: scope.type === 'file' })
					: repo.git.status.getStatus().then(s => s?.files),
			repo.git.config.getCurrentUser(),
		]);

		const currentUser = getSettledValue(currentUserResult);
		const currentUserName = currentUser?.name ? `${currentUser.name} (you)` : 'You';

		const dataset: TimelineDatum[] = [];

		const result = getSettledValue(contributorsResult);
		if (result != null) {
			for (const contributor of result.contributors) {
				if (contributor.contributions == null) continue;

				for (const contribution of contributor.contributions) {
					dataset.push({
						author: contributor.current ? currentUserName : contributor.name,
						sha: contribution.sha,
						date: contribution.date.toISOString(),
						message: contribution.message,

						files: contribution.files,
						additions: contribution.additions,
						deletions: contribution.deletions,

						sort: contribution.date.getTime(),
					});
				}
			}
		}

		if (config.showAllBranches && config.sliceBy === 'branch' && scope.type !== 'repo' && !repo.virtual) {
			const shas = new Set<string>(
				await repo.git.commits.getLogShas?.(`^${scope.head?.ref ?? 'HEAD'}`, {
					all: true,
					pathOrUri: scope.uri,
					limit: 0,
				}),
			);

			const commitsUnreachableFromHEAD = dataset.filter(d => shas.has(d.sha));
			await batch(
				commitsUnreachableFromHEAD,
				10, // Process 10 commits at a time
				async datum => {
					datum.branches = await repo.git.branches.getBranchesWithCommits([datum.sha], undefined, {
						all: true,
						mode: 'contains',
					});
				},
			);
		}

		const statusFiles = getSettledValue(statusFilesResult);
		const relativePath = this.container.git.getRelativePath(scope.uri, repo.uri);

		const pseudoCommits = await getPseudoCommitsWithStats(this.container, statusFiles, relativePath, currentUser);
		if (pseudoCommits?.length) {
			dataset.splice(0, 0, ...map(pseudoCommits, c => createDatum(c, scope.type, currentUserName)));
		} else if (dataset.length) {
			dataset.splice(0, 0, {
				author: dataset[0].author,
				files: 0,
				additions: 0,
				deletions: 0,
				sha: '', // Special case for working tree when there are no working changes
				date: new Date().toISOString(),
				message: 'Working Tree',
				sort: Date.now(),
			} satisfies TimelineDatum);
		}

		dataset.sort((a, b) => b.sort - a.sort);

		return dataset;
	}

	private async openDataPoint(params: SelectDataPointParams) {
		if (params.scope == null) return;

		const repo = this.container.git.getRepository(params.scope.uri);
		if (repo == null) return;

		this.container.telemetry.sendEvent('timeline/commit/selected', this.getTelemetryContext());

		const commit = await repo.git.commits.getCommit(params.id || uncommitted);
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

		const { type, uri } = deserializeTimelineScope(params.scope);

		switch (type) {
			case 'folder':
			case 'repo':
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
						type === 'folder' ? getFilesFilter(uri, commit.sha) : undefined,
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
						type === 'folder' ? getFilesFilter(uri, commit.sha) : undefined,
					);
				}

				break;

			case 'file':
				if (
					commit.isUncommitted &&
					!commit.isUncommittedStaged &&
					!commit.anyFiles?.some(f => f.uri.fsPath === uri.fsPath)
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

	private async updateScope(
		scope: TimelineScope | undefined,
		silent?: boolean,
		allowEquivalent?: boolean,
	): Promise<boolean> {
		if (this._tabCloseDebounceTimer != null) {
			clearTimeout(this._tabCloseDebounceTimer);
			this._tabCloseDebounceTimer = undefined;
		}

		const etags: Context['etags'] = {
			repositories: this.container.git.etag,
			repository: undefined,
			repositoryWip: undefined,
			subscription: this.container.subscription.etag,
		};
		let title = '';

		if (scope != null) {
			if (this.container.git.isDiscoveringRepositories) {
				await this.container.git.isDiscoveringRepositories;
			}

			const repo = this.container.git.getRepository(scope.uri);

			if (this._repositorySubscription?.source !== repo) {
				this._repositorySubscription?.dispose();
				this._repositorySubscription = undefined;
			}

			if (repo != null) {
				if (areUrisEqual(scope.uri, repo.uri)) {
					scope.type = 'repo';
					scope.head ??= getReference(await repo.git.branches.getBranch());
				}

				this._repositorySubscription ??= new SubscriptionManager(repo, r => this.subscribeToRepository(r));

				if (scope.type === 'file' || scope.type === 'folder') {
					title = basename(this.container.git.getRelativePath(scope.uri, repo.uri));
					if (scope.head) {
						title += ` (${scope.head.ref})`;
					}
					if (this.container.git.repositoryCount > 1) {
						title += ` \u2022 ${repo.name}`;
					}
				} else if (scope.head) {
					title += scope.head.name;
					if (this.container.git.repositoryCount > 1) {
						title += ` \u2022 ${repo.name}`;
					}
				} else {
					title = repo.name;
				}
			}

			etags.repository = repo?.etag ?? 0;
			etags.repositoryWip = repo?.etagFileSystem ?? 0;
		} else {
			this._repositorySubscription?.dispose();
			this._repositorySubscription = undefined;

			etags.repository = 0;
			etags.repositoryWip = 0;
		}

		if (this.host.visible) {
			this._repositorySubscription?.start();
		}

		if (
			areEtagsEqual(this._context.etags, etags) &&
			(allowEquivalent
				? areTimelineScopesEquivalent(scope, this._context.scope)
				: areTimelineScopesEqual(scope, this._context.scope))
		) {
			return false;
		}

		this._cache.clear();
		this._context.scope = scope;
		this._context.etags = etags;

		if (this.host.is('editor')) {
			this.host.title = title || 'Visual History';
		} else {
			this.host.description = title || proBadge;
		}

		this.fireFileSelected();
		this.container.telemetry.sendEvent('timeline/scope/changed', this.getTelemetryContext());

		if (!silent) {
			this.updateState();
		}
		return true;
	}

	private subscribeToRepository(repo: Repository): Disposable {
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

		const state = await this._cache.getOrCreate('state', () => this.getState(this._context, true));
		return this.host.notify(DidChangeNotification, { state: state });
	}
}

function createDatum(commit: GitCommit, scopeType: TimelineScopeType, currentUserName: string): TimelineDatum {
	let additions: number | undefined;
	let deletions: number | undefined;
	let files: number | undefined;

	const stats = getCommitStats(commit, scopeType);
	if (stats != null) {
		({ additions, deletions } = stats);
	}
	if (scopeType === 'file') {
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
	scopeType: TimelineScopeType,
): { additions: number; deletions: number } | undefined {
	if (scopeType === 'file') {
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

function generateRandomTimelineDataset(itemType: TimelineScopeType): TimelineDatum[] {
	const dataset: TimelineDatum[] = [];
	const authors = ['Eric Amodio', 'Justin Roberts', 'Keith Daulton', 'Ramin Tadayon', 'Ada Lovelace', 'Grace Hopper'];

	const count = 10;
	for (let i = 0; i < count; i++) {
		// Generate a random date between now and 3 months ago
		const date = new Date(Date.now() - Math.floor(Math.random() * (3 * 30 * 24 * 60 * 60 * 1000)));
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

function areEtagsEqual(a: Context['etags'], b: Context['etags']): boolean {
	return (
		a.repositories === b.repositories &&
		a.repository === b.repository &&
		a.repositoryWip === b.repositoryWip &&
		a.subscription === b.subscription
	);
}
