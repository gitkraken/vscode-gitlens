import type { TabChangeEvent, TabGroupChangeEvent } from 'vscode';
import { Disposable, EventEmitter, Uri, ViewColumn, window } from 'vscode';
import { proBadge } from '../../../constants.js';
import type {
	TimelineShownTelemetryContext,
	TimelineTelemetryContext,
	TimelineWebviewTelemetryContext,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { FileSelectedEvent } from '../../../eventBus.js';
import type { FeatureAccess, RepoFeatureAccess } from '../../../features.js';
import {
	openChanges,
	openChangesWithWorking,
	openCommitChanges,
	openCommitChangesWithWorking,
} from '../../../git/actions/commit.js';
import { ensureWorkingUri } from '../../../git/gitUri.utils.js';
import type { GitCommit } from '../../../git/models/commit.js';
import type { GitFileChange } from '../../../git/models/fileChange.js';
import type { Repository } from '../../../git/models/repository.js';
import { uncommitted } from '../../../git/models/revision.js';
import { getReference } from '../../../git/utils/-webview/reference.utils.js';
import { toRepositoryShape } from '../../../git/utils/-webview/repository.utils.js';
import { getPseudoCommitsWithStats } from '../../../git/utils/-webview/statusFile.utils.js';
import { getChangedFilesCount } from '../../../git/utils/commit.utils.js';
import { createReference } from '../../../git/utils/reference.utils.js';
import {
	createRevisionRange,
	isUncommitted,
	isUncommittedStaged,
	shortenRevision,
} from '../../../git/utils/revision.utils.js';
import { Directive } from '../../../quickpicks/items/directive.js';
import type { ReferencesQuickPickIncludes } from '../../../quickpicks/referencePicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker2 } from '../../../quickpicks/repositoryPicker.js';
import { showRevisionFilesPicker } from '../../../quickpicks/revisionFilesPicker.js';
import { executeCommand, registerCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { isDescendant } from '../../../system/-webview/path.js';
import { openTextEditor } from '../../../system/-webview/vscode/editors.js';
import { getTabUri } from '../../../system/-webview/vscode/tabs.js';
import { createFromDateDelta } from '../../../system/date.js';
import { trace } from '../../../system/decorators/log.js';
import { debounce } from '../../../system/function/debounce.js';
import { map } from '../../../system/iterable.js';
import { flatten } from '../../../system/object.js';
import { basename } from '../../../system/path.js';
import { batch, getSettledValue } from '../../../system/promise.js';
import { SubscriptionManager } from '../../../system/subscriptionManager.js';
import { areUrisEqual } from '../../../system/uri.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createEventSubscription } from '../../rpc/eventVisibilityBuffer.js';
import { createSharedServices, proxyServices } from '../../rpc/services/common.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../../webviewProvider.js';
import type { WebviewShowOptions } from '../../webviewsController.js';
import { isSerializedState } from '../../webviewsController.js';
import type {
	ChoosePathParams,
	ChooseRefParams,
	DidChoosePathParams,
	DidChooseRefParams,
	ScopeChangedEvent,
	SelectDataPointParams,
	State,
	TimelineConfig,
	TimelineDatasetResult,
	TimelineDatum,
	TimelineInitialContext,
	TimelinePeriod,
	TimelineScope,
	TimelineScopeSerialized,
	TimelineScopeType,
	TimelineServices,
} from './protocol.js';
import { DidChangeNotification } from './protocol.js';
import type { TimelineWebviewShowingArgs } from './registration.js';
import {
	areTimelineScopesEqual,
	areTimelineScopesEquivalent,
	deserializeTimelineScope,
	isTimelineScope,
	serializeTimelineScope,
} from './utils/-webview/timeline.utils.js';

export class TimelineWebviewProvider implements WebviewProvider<State, State, TimelineWebviewShowingArgs> {
	// --- Showing context (set in onShowing, consumed by getInitialContext) ---
	private _showingScope: TimelineScope | undefined;
	private _showingConfigOverrides: Partial<TimelineConfig> | undefined;
	/** Captured in onShowing (before panel takes focus) so getInitialContext can use it. */
	private _showingActiveTabUri: Uri | undefined;

	// --- Operational tracking (for canReuseInstance, getSplitArgs, telemetry) ---
	private _currentScope: TimelineScope | undefined;

	// --- Telemetry context pushed from the webview via RPC ---
	private _telemetryContext: TimelineWebviewTelemetryContext | undefined;

	// --- Events ---
	private readonly _onScopeChanged = new EventEmitter<ScopeChangedEvent | undefined>();

	// --- Disposables & subscriptions ---
	private _disposable: Disposable | undefined;
	private _repositorySubscription: SubscriptionManager<Repository> | undefined;
	private _tabCloseDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	// --- Data point opening guard ---
	private _openingDataPoint: SelectDataPointParams | undefined;
	private _pendingOpenDataPoint: SelectDataPointParams | undefined;

	private get activeTabUri() {
		return getTabUri(window.tabGroups.activeTabGroup.activeTab);
	}

	/** Subscription listener — fires legacy IPC notification for PromosContext cache invalidation */
	private readonly _subscriptionDisposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.timeline' | 'gitlens.timeline'>,
	) {
		if (this.host.is('view')) {
			this.host.description = proBadge;
		}

		// Bridge: fire legacy DidChangeNotification on subscription changes so
		// PromosContext (which listens for IPC, not RPC) can clear its cache
		this._subscriptionDisposable = this.container.subscription.onDidChange(() => {
			const state: Partial<State> = {
				webviewId: this.host.id,
				webviewInstanceId: this.host.instanceId,
				timestamp: Date.now(),
			};
			void this.host.notify(DidChangeNotification, { state: state as State });
		});
	}

	dispose(): void {
		this._subscriptionDisposable.dispose();
		this._onScopeChanged.dispose();
		this._disposable?.dispose();
		this._repositorySubscription?.dispose();
	}

	// ============================================================
	// WebviewProvider interface
	// ============================================================

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

		return areTimelineScopesEquivalent(scope, this._currentScope);
	}

	getSplitArgs(): WebviewShowingArgs<TimelineWebviewShowingArgs, State> {
		return this._currentScope != null ? [this._currentScope] : [];
	}

	getTelemetryContext(): TimelineTelemetryContext {
		const context: TimelineTelemetryContext = {
			...this.host.getTelemetryContext(),
			'context.period': undefined,
			'context.scope.hasHead': this._currentScope?.head != null,
			'context.scope.hasBase': this._currentScope?.base != null,
			'context.scope.type': this._currentScope?.type,
			'context.showAllBranches': undefined,
			'context.sliceBy': undefined,
			...this._telemetryContext,
		};
		return context;
	}

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<TimelineWebviewShowingArgs, State>
	): [boolean, TimelineShownTelemetryContext] {
		let scope: TimelineScope | undefined;

		const [arg] = args;
		if (arg != null) {
			if (isTimelineScope(arg)) {
				scope = arg;
			} else if (isSerializedState<State>(arg) && arg.state.scope != null) {
				this._showingConfigOverrides = arg.state.config;
				// Only re-use the serialized state if we are in an editor (the view always follows the active tab)
				if (this.host.is('editor')) {
					scope = {
						type: arg.state.scope.type,
						uri: Uri.parse(arg.state.scope.uri),
						head: arg.state.scope.head,
					};
				}
			}
		}

		this._showingScope = scope;
		// Capture active tab URI now, before the timeline panel takes focus
		this._showingActiveTabUri = scope == null ? this.activeTabUri : undefined;
		if (scope != null) {
			this._currentScope = scope;
		}

		// If the webview is already live (reused panel, preserveInstance: true), fire
		// a scope changed event so it navigates to the new scope. When loading=true,
		// the webview will call populateInitialState() which reads _showingScope.
		if (!loading && scope != null) {
			this._onScopeChanged.fire({ uri: scope.uri.toString(), type: scope.type });
		}

		const cfg = flatten(configuration.get('visualHistory'), 'context.config', { joinArrays: true });
		return [true, { ...this.getTelemetryContext(), ...cfg }];
	}

	includeBootstrap(): Promise<State> {
		// Webview fetches all data via RPC — bootstrap only provides metadata
		return Promise.resolve({
			webviewId: this.host.id,
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
		} as State);
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
				registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
				registerCommand(
					`${this.host.id}.openInTab`,
					() => {
						if (this._currentScope?.type !== 'file') return;

						void executeCommand<TimelineScope>('gitlens.visualizeHistory', this._currentScope);
						this.host.sendTelemetryEvent('timeline/action/openInEditor', {
							'scope.type': this._currentScope.type,
							'scope.hasHead': this._currentScope.head != null,
							'scope.hasBase': this._currentScope.base != null,
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

	onRefresh(_force?: boolean): void {
		// No cache to clear — the webview refetches via RPC
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._disposable?.dispose();
			this._repositorySubscription?.pause();

			return;
		}

		this._repositorySubscription?.resume();

		// View mode (sidebar): listen for tab/file changes to fire onScopeChanged
		// (subscription and repository changes are handled by generic factory events)
		if (!this.host.is('editor')) {
			this._disposable = Disposable.from(
				window.tabGroups.onDidChangeTabGroups(this.onTabsChanged, this),
				window.tabGroups.onDidChangeTabs(this.onTabsChanged, this),
				this.container.events.on('file:selected', debounce(this.onFileSelected, 250), this),
			);

			// Re-derive scope from active tab on re-show (active tab may have changed while hidden)
			void this.fireScopeForActiveTab();
		}
	}

	// ============================================================
	// RPC
	// ============================================================

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): TimelineServices {
		const base = createSharedServices(
			this.container,
			this.host,
			context => {
				this._telemetryContext = context as TimelineWebviewTelemetryContext;
			},
			buffer,
			tracker,
		);

		return proxyServices({
			...base,

			timeline: {
				// --- Lifecycle ---
				getInitialContext: () => this.getInitialContext(),

				// --- View-specific data ---
				getDataset: (scope, config, signal) => this.getDatasetForRpc(scope, config, signal),

				// --- View-specific event (host-driven, requires VS Code API) ---
				onScopeChanged: createEventSubscription<ScopeChangedEvent | undefined>(
					buffer,
					'scopeChanged',
					'save-last',
					buffered => this._onScopeChanged.event(buffered),
					undefined,
					tracker,
				),

				// --- User actions ---
				selectDataPoint: params => this.onSelectDataPoint(params),
				chooseRef: params => this.onChooseRef(params),
				choosePath: params => this.onChoosePath(params),
				chooseRepo: () => this.chooseRepo(),
				openInEditor: scope => this.openInEditor(scope),
			},
		} satisfies TimelineServices);
	}

	// ============================================================
	// RPC service methods
	// ============================================================

	private async getInitialContext(): Promise<TimelineInitialContext> {
		let scope = this._showingScope;

		// If no scope from showing args, derive from the active tab captured at onShowing time
		// (by the time getInitialContext runs, the timeline panel may have taken focus)
		if (scope == null) {
			const uri = await ensureWorkingUri(this.container, this._showingActiveTabUri ?? this.activeTabUri);
			if (uri != null) {
				scope = { type: 'file', uri: uri };
			} else if (this.host.is('editor')) {
				const repoUri = this.container.git.getBestRepositoryOrFirst()?.uri;
				if (repoUri != null) {
					scope = { type: 'repo', uri: repoUri };
				}
			}
		}

		let serialized: TimelineScopeSerialized | undefined;
		if (scope != null) {
			const { git } = this.container;
			if (git.isDiscoveringRepositories) {
				await git.isDiscoveringRepositories;
			}

			const repo =
				git.getRepository(scope.uri) ?? (await git.getOrOpenRepository(scope.uri, { closeOnOpen: true }));
			if (repo != null) {
				if (areUrisEqual(scope.uri, repo.uri)) {
					scope.type = 'repo';
				}

				scope.head ??= getReference(await repo.git.branches.getBranch());
				scope.base ??= scope.head;

				const relativePath = git.getRelativePath(scope.uri, repo.uri);
				serialized = serializeTimelineScope(scope as Required<TimelineScope>, relativePath);

				// Side-effects
				this.ensureRepoWatching(repo);
				this.updateViewTitle(scope, repo);
			}
		}

		this._currentScope = scope;
		this.fireFileSelected();

		const configOverrides = this._showingConfigOverrides;
		this._showingConfigOverrides = undefined;

		return {
			scope: serialized,
			configOverrides: configOverrides,
			displayConfig: {
				abbreviatedShaLength: configuration.get('advanced.abbreviatedShaLength'),
				dateFormat: configuration.get('defaultDateFormat') ?? '',
				shortDateFormat: configuration.get('defaultDateShortFormat') ?? '',
			},
		};
	}

	private async getDatasetForRpc(
		scopeSerialized: TimelineScopeSerialized,
		config: TimelineConfig,
		signal?: AbortSignal,
	): Promise<TimelineDatasetResult> {
		const scope = deserializeTimelineScope(scopeSerialized);

		const { git } = this.container;
		if (git.isDiscoveringRepositories) {
			await git.isDiscoveringRepositories;
		}
		signal?.throwIfAborted();

		const repo = git.getRepository(scope.uri) ?? (await git.getOrOpenRepository(scope.uri, { closeOnOpen: true }));
		if (repo == null) {
			const access = await this.container.subscription.getSubscription();
			return {
				dataset: [],
				scope: scopeSerialized,
				repository: undefined,
				access: { allowed: false, subscription: { current: access } },
			};
		}

		// Reconstruct the correct scope URI from the repo URI + relativePath.
		// The webview may have changed relativePath (via choosePath/changeScope) without
		// updating the serialized URI, so we must rebuild it here.
		if (scopeSerialized.relativePath && scope.type !== 'repo') {
			scope.uri = Uri.joinPath(repo.uri, scopeSerialized.relativePath);
		}

		// Enrich scope: resolve type, head, base, relativePath
		if (areUrisEqual(scope.uri, repo.uri)) {
			scope.type = 'repo';
		}
		scope.head ??= getReference(await repo.git.branches.getBranch());
		scope.base ??= scope.head;
		const relativePath = git.getRelativePath(scope.uri, repo.uri);
		const enrichedScope = serializeTimelineScope(scope as Required<TimelineScope>, relativePath);
		signal?.throwIfAborted();

		// Track scope for operational methods
		const prevScope = this._currentScope;
		this._currentScope = scope;
		if (!areTimelineScopesEqual(scope, prevScope)) {
			this.host.sendTelemetryEvent('timeline/scope/changed');
		}

		// Side-effects
		this.ensureRepoWatching(repo);
		this.updateViewTitle(scope, repo);

		const access = await git.access('timeline', repo.uri);
		signal?.throwIfAborted();
		const dataset = await this.computeDataset(scope, repo, config, access);

		return {
			dataset: dataset,
			scope: enrichedScope,
			repository: { ...toRepositoryShape(repo), ref: scope.head },
			access: access,
		};
	}

	// ============================================================
	// User action methods (called via RPC)
	// ============================================================

	private async onSelectDataPoint(params: SelectDataPointParams) {
		if (params.scope == null || params.id == null) return;

		// If already processing a change, store this request and return
		if (this._openingDataPoint) {
			this._pendingOpenDataPoint = params;
			return;
		}

		this._openingDataPoint = params;

		try {
			await this.openDataPoint(params);
		} finally {
			const current = this._openingDataPoint;
			this._openingDataPoint = undefined;

			// Process the most recent pending request if any
			if (this._pendingOpenDataPoint) {
				const pending = this._pendingOpenDataPoint;
				this._pendingOpenDataPoint = undefined;

				if (pending.id !== current?.id || pending.shift !== current?.shift) {
					void this.openDataPoint(pending);
				}
			}
		}
	}

	private async onChooseRef(params: ChooseRefParams): Promise<DidChooseRefParams> {
		if (params.scope == null) return undefined;

		const repo = this.container.git.getRepository(params.scope.uri);
		if (repo == null) return undefined;

		const scope = deserializeTimelineScope(params.scope);
		const ref = params.type === 'base' ? scope.base : scope.head;

		const include: ReferencesQuickPickIncludes[] = ['branches', 'tags', 'HEAD'];
		if (!repo.virtual && !params.showAllBranches && params.type !== 'base') {
			include.push('allBranches');
		}

		const pick = await showReferencePicker2(
			repo.path,
			params.type === 'base' ? 'Choose a Base Reference' : 'Choose a Head Reference',
			params.type === 'base'
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
			return { type: params.type, ref: null };
		}
		if (pick.value == null) return undefined;

		return { type: params.type, ref: getReference(pick.value) };
	}

	private async onChoosePath(params: ChoosePathParams): Promise<DidChoosePathParams> {
		const { repoUri: repoPath, ref, title, initialPath } = params;
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) {
			return { picked: undefined };
		}

		const picked = await showRevisionFilesPicker(this.container, createReference(ref?.ref ?? 'HEAD', repo.path), {
			allowFolders: true,
			initialPath: initialPath,
			title: title,
		});

		return {
			picked:
				picked != null
					? {
							type: picked.type,
							relativePath: this.container.git.getRelativePath(picked.uri, repo.uri),
						}
					: undefined,
		};
	}

	private async chooseRepo(): Promise<ScopeChangedEvent | undefined> {
		const { title, placeholder } = getRepositoryPickerTitleAndPlaceholder(
			this.container.git.openRepositories,
			'Switch',
		);

		const result = await showRepositoryPicker2(
			this.container,
			title,
			placeholder,
			this.container.git.openRepositories,
		);

		if (result.value == null) return undefined;
		return { uri: result.value.uri.toString(), type: 'repo' };
	}

	private openInEditor(scopeSerialized: TimelineScopeSerialized): void {
		const scope = deserializeTimelineScope(scopeSerialized);
		// Reconstruct URI from relativePath — the webview may have changed
		// relativePath (via choosePath/changeScope) without updating the URI
		if (scopeSerialized.relativePath && scope.type !== 'repo') {
			const repo = this.container.git.getRepository(scope.uri);
			if (repo != null) {
				scope.uri = Uri.joinPath(repo.uri, scopeSerialized.relativePath);
			}
		}
		void executeCommand<TimelineScope>('gitlens.visualizeHistory', scope);
		this.host.sendTelemetryEvent('timeline/action/openInEditor', {
			'scope.type': scope.type,
			'scope.hasHead': scope.head != null,
			'scope.hasBase': scope.base != null,
		});
	}

	// ============================================================
	// Internal event handlers
	// ============================================================

	@trace({ args: false })
	private async onTabsChanged(_e: TabGroupChangeEvent | TabChangeEvent) {
		if (this._tabCloseDebounceTimer != null) {
			clearTimeout(this._tabCloseDebounceTimer);
			this._tabCloseDebounceTimer = undefined;
		}

		const uri = await ensureWorkingUri(this.container, this.activeTabUri);
		if (uri == null) {
			// Tab closed — debounce before firing scope cleared
			this._tabCloseDebounceTimer = setTimeout(() => {
				this._tabCloseDebounceTimer = undefined;
				this._onScopeChanged.fire(undefined);
				this.host.sendTelemetryEvent('timeline/editor/changed');
			}, 1000);

			return;
		}

		this._onScopeChanged.fire({ uri: uri.toString(), type: 'file' });
		this.host.sendTelemetryEvent('timeline/editor/changed');
	}

	@trace({ args: false })
	private async onFileSelected(e: FileSelectedEvent) {
		if (e.data == null) return;

		let uri: Uri | undefined = e.data.uri;
		if (uri != null && !this.container.git.isTrackable(uri)) {
			uri = undefined;
		}

		uri = await ensureWorkingUri(this.container, uri ?? this.activeTabUri);
		if (uri != null) {
			this._onScopeChanged.fire({ uri: uri.toString(), type: 'file' });
			this.host.sendTelemetryEvent('timeline/editor/changed');
		}
	}

	// ============================================================
	// Internal helpers
	// ============================================================

	private async fireScopeForActiveTab(): Promise<void> {
		const uri = await ensureWorkingUri(this.container, this.activeTabUri);
		if (uri != null) {
			this._onScopeChanged.fire({ uri: uri.toString(), type: 'file' });
		} else {
			this._onScopeChanged.fire(undefined);
		}
	}

	private fireFileSelected() {
		if (this._currentScope?.type !== 'file' || !this.host.is('editor')) return;

		this.container.events.fire(
			'file:selected',
			{ uri: this._currentScope.uri, preserveFocus: true, preserveVisibility: false },
			{ source: this.host.id },
		);
	}

	private ensureRepoWatching(repo: Repository): void {
		if (this._repositorySubscription?.source === repo) return;

		this._repositorySubscription?.dispose();
		this._repositorySubscription = new SubscriptionManager(repo, r => this.subscribeToRepository(r));
		if (this.host.visible) {
			this._repositorySubscription.start();
		}
	}

	private subscribeToRepository(repo: Repository): Disposable {
		// Start file system watching so the repo detects changes promptly.
		// Repo state changes flow through container.git.onDidChangeRepository,
		// which the generic factory events relay to the webview.
		return repo.watchFileSystem(1000);
	}

	private updateViewTitle(scope: TimelineScope | undefined, repo: Repository | undefined): void {
		let title = '';

		if (scope != null && repo != null) {
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

		if (this.host.is('editor')) {
			this.host.title = title || 'Visual History';
		} else {
			this.host.description = title || proBadge;
		}
	}

	private async computeDataset(
		scope: TimelineScope,
		repo: Repository,
		config: TimelineConfig,
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

		this.host.sendTelemetryEvent('timeline/commit/selected');

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
