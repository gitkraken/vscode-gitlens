import type { TabChangeEvent, TabGroupChangeEvent, TextDocumentShowOptions } from 'vscode';
import { Disposable, EventEmitter, Uri, ViewColumn, window } from 'vscode';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange } from '@gitlens/git/models/fileChange.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { isUncommitted, isUncommittedStaged, shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { flatten } from '@gitlens/utils/object.js';
import { basename } from '@gitlens/utils/path.js';
import { SubscriptionManager } from '@gitlens/utils/subscriptionManager.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import { proBadge } from '../../../constants.js';
import type {
	TimelineShownTelemetryContext,
	TimelineTelemetryContext,
	TimelineWebviewTelemetryContext,
} from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { FileSelectedEvent } from '../../../eventBus.js';
import {
	openChanges,
	openChangesWithWorking,
	openCommitChanges,
	openCommitChangesWithWorking,
} from '../../../git/actions/commit.js';
import { ensureWorkingUri } from '../../../git/gitUri.utils.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getReference } from '../../../git/utils/-webview/reference.utils.js';
import { Directive } from '../../../quickpicks/items/directive.js';
import type { ReferencesQuickPickIncludes } from '../../../quickpicks/referencePicker.js';
import { showReferencePicker2 } from '../../../quickpicks/referencePicker.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker2 } from '../../../quickpicks/repositoryPicker.js';
import { showRevisionFilesPicker } from '../../../quickpicks/revisionFilesPicker.js';
import { executeCommand, registerCommand } from '../../../system/-webview/command.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { isDescendant } from '../../../system/-webview/path.js';
import { openTextEditor } from '../../../system/-webview/vscode/editors.js';
import { getTabUri, tabContainsPath } from '../../../system/-webview/vscode/tabs.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../../rpc/eventVisibilityBuffer.js';
import { createRpcEventSubscription } from '../../rpc/eventVisibilityBuffer.js';
import { createSharedServices } from '../../rpc/services/common.js';
import { proxyServices } from '../../rpc/services/proxy.js';
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
	TimelineInitialContext,
	TimelineScope,
	TimelineScopeSerialized,
	TimelineServices,
} from './protocol.js';
import { DidChangeNotification } from './protocol.js';
import type { TimelineWebviewShowingArgs } from './registration.js';
import { buildTimelineDataset, buildWipDatums } from './timelineDataset.js';
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
	private _repositorySubscription: SubscriptionManager<GlRepository> | undefined;
	private _tabCloseDebounceTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly _tabsChangedSeq = getScopedCounter();

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
				getWip: (scope, signal) => buildWipDatums(this.container, scope, signal),

				// --- View-specific event (host-driven, requires VS Code API) ---
				onScopeChanged: createRpcEventSubscription<ScopeChangedEvent | undefined>(
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

			// `detectNested: true` resolves a worktree nested in scope.uri's container (getRepository alone folds to
			// the ancestor). Fall back to getRepository when discovery can't resolve a root (e.g. virtual repos).
			const repo =
				(await git.getOrAddRepository(scope.uri, { opened: false, detectNested: true })) ??
				git.getRepository(scope.uri);
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
				abbreviatedShaLength: this.container.CommitShaFormatting.length,
				currentUserNameStyle: configuration.get('defaultCurrentUserNameStyle') ?? 'nameAndYou',
				dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
				shortDateFormat: configuration.get('defaultDateShortFormat') ?? 'short',
			},
		};
	}

	private async getDatasetForRpc(
		scopeSerialized: TimelineScopeSerialized,
		config: TimelineConfig,
		signal?: AbortSignal,
	): Promise<TimelineDatasetResult> {
		const result = await buildTimelineDataset(this.container, scopeSerialized, config, signal);

		// Side-effects layered on top of the shared dataset builder
		const { repo, scopeRef: scope } = result;
		if (repo != null && scope != null) {
			const prevScope = this._currentScope;
			this._currentScope = scope;
			if (!areTimelineScopesEqual(scope, prevScope)) {
				this.host.sendTelemetryEvent('timeline/scope/changed');
			}

			this.ensureRepoWatching(repo);
			this.updateViewTitle(scope, repo);
		}

		// `mixed` means the workspace has both public and private repos — so a gated (private) scope can
		// offer switching to a public one. Only computed when access is denied (the only time the gate, and
		// thus the switch affordance, is shown) to avoid an aggregate visibility() scan on every (allowed)
		// dataset fetch, including each load-more. The result is cached on the provider.
		const allowRepoSwitch =
			result.access.allowed === false ? (await this.container.git.visibility()) === 'mixed' : false;

		return {
			dataset: result.dataset,
			scope: result.scope,
			repository: result.repository,
			access: result.access,
			allowRepoSwitch: allowRepoSwitch,
		};
	}

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
		// Reconstruct URI from relativePath — the webview may have changed relativePath (via choosePath/changeScope)
		// without updating the URI. getRepository resolves a nested worktree here because the timeline dataset already
		// registered it (so getClosest finds it, not the container).
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

	@trace({ args: false })
	private async onTabsChanged(_e: TabGroupChangeEvent | TabChangeEvent) {
		const seq = this._tabsChangedSeq.next();
		if (this._tabCloseDebounceTimer != null) {
			clearTimeout(this._tabCloseDebounceTimer);
			this._tabCloseDebounceTimer = undefined;
		}

		const uri = await ensureWorkingUri(this.container, this.activeTabUri);
		// A newer invocation is in flight — let it take over so this stale resolution can't blank
		// the view after a more recent event already fired a valid scope.
		if (this._tabsChangedSeq.current !== seq) return;

		if (uri == null) {
			// If the current scope's file is still visible somewhere (e.g. user clicked a commit and
			// a diff opened, so the active tab is now a gitlens:// revision URI we couldn't resolve
			// back to a working file), stay put — don't blank the view.
			if (this.isCurrentScopeVisible()) return;

			// No usable scope and the prior scope is gone too — debounce before firing scope cleared
			this._tabCloseDebounceTimer = setTimeout(() => {
				this._tabCloseDebounceTimer = undefined;
				// Re-check before blanking; state may have changed during the 1s wait
				if (this._tabsChangedSeq.current !== seq) return;
				if (this.isCurrentScopeVisible()) return;

				this._onScopeChanged.fire(undefined);
				this.host.sendTelemetryEvent('timeline/editor/changed');
			}, 1000);

			return;
		}

		// Skip redundant fires when we've already resolved to the same URI as the current scope
		if (this._currentScope?.uri != null && areUrisEqual(uri, this._currentScope.uri)) return;

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

	private async fireScopeForActiveTab(): Promise<void> {
		const uri = await ensureWorkingUri(this.container, this.activeTabUri);
		if (uri != null) {
			this._onScopeChanged.fire({ uri: uri.toString(), type: 'file' });
			return;
		}

		// Only blank the scope when the current scope's file is no longer visible anywhere —
		// otherwise a re-show triggered while a diff tab is active would clear the view.
		if (this.isCurrentScopeVisible()) return;

		this._onScopeChanged.fire(undefined);
	}

	private isCurrentScopeVisible(): boolean {
		const scopePath = this._currentScope?.uri.path;
		if (!scopePath) return false;

		for (const group of window.tabGroups.all) {
			for (const tab of group.tabs) {
				if (tabContainsPath(tab, scopePath)) return true;
			}
		}
		return false;
	}

	private fireFileSelected() {
		if (this._currentScope?.type !== 'file' || !this.host.is('editor')) return;

		this.container.events.fire(
			'file:selected',
			{ uri: this._currentScope.uri, preserveFocus: true, preserveVisibility: false },
			{ source: this.host.id },
		);
	}

	private ensureRepoWatching(repo: GlRepository): void {
		if (this._repositorySubscription?.source === repo) return;

		this._repositorySubscription?.dispose();
		this._repositorySubscription = new SubscriptionManager(repo, r => this.subscribeToRepository(r));
		if (this.host.visible) {
			this._repositorySubscription.start();
		}
	}

	private subscribeToRepository(repo: GlRepository): Disposable {
		// Start file system watching so the repo detects changes promptly.
		// Repo state changes flow through container.git.onDidChangeRepository,
		// which the generic factory events relay to the webview.
		return repo.watchWorkingTree(1000);
	}

	private updateViewTitle(scope: TimelineScope | undefined, repo: GlRepository | undefined): void {
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

	private getOpenEditorShowOptions(): (TextDocumentShowOptions & { sourceViewColumn?: ViewColumn }) | undefined {
		if (this.host.is('view')) return undefined;

		const mode = configuration.get('visualHistory.editorOpeningBehavior') ?? 'auto';
		if (mode !== 'auto' || !this.host.active) return undefined;

		return { viewColumn: ViewColumn.Beside, sourceViewColumn: this.host.viewColumn };
	}

	private async openDataPoint(params: SelectDataPointParams) {
		if (params.scope == null) return;

		const repo = this.container.git.getRepository(params.scope.uri);
		if (repo == null) return;

		this.host.sendTelemetryEvent('timeline/commit/selected');

		const commit = await repo.git.commits.getCommit(params.id || uncommitted);
		if (commit == null) return;

		if (!commit.hasFullDetails()) {
			await GitCommit.ensureFullDetails(commit, { include: { uncommittedFiles: true } });
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
							title: `Folder Changes in ${shortenRevision(commit.sha, {
								strings: { working: 'Working Tree' },
							})}`,
							...this.getOpenEditorShowOptions(),
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
							title: `Folder Changes between ${shortenRevision(commit.sha, {
								strings: { working: 'Working Tree' },
							})} and Working Tree`,
							...this.getOpenEditorShowOptions(),
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
						...this.getOpenEditorShowOptions(),
					});

					break;
				}

				if (!params.shift) {
					await openChanges(uri, commit, {
						preserveFocus: true,
						preview: true,
						...this.getOpenEditorShowOptions(),
					});
				} else {
					await openChangesWithWorking(uri, commit, {
						preserveFocus: true,
						preview: true,
						...this.getOpenEditorShowOptions(),
					});
				}

				break;
		}
	}
}
