import type { Remote } from '@eamodio/supertalk';
import { setAbbreviatedShaLength } from '@gitlens/git/utils/revision.utils.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { dirname } from '@gitlens/utils/path.js';
import type {
	ScopeChangedEvent,
	TimelineDatasetResult,
	TimelinePeriod,
	TimelineScopeSerialized,
	TimelineScopeType,
	TimelineServices,
	TimelineSliceBy,
} from '../../../plus/timeline/protocol.js';
import type { RepositoryChange, RepositoryChangeEventData } from '../../../rpc/services/types.js';
import { fireAndForget } from '../../shared/actions/rpc.js';
import { createTelemetryContextUpdater } from '../../shared/actions/telemetry.js';
import type { Resource } from '../../shared/state/resource.js';
import type { CommitEventDetail } from './components/chart.js';
import type { TimelineState } from './state.js';

/** Change types that don't affect timeline chart data. Denylist for forward compatibility — new types trigger refresh by default. */
const irrelevantTimelineChanges: ReadonlySet<RepositoryChange> = new Set([
	'config',
	'remotes',
	'tags',
	'starred',
	'remoteProviders',
	'ignores',
	'gkConfig',
]);

/** Resolved timeline sub-service type (after awaiting the sub-service property from the Remote proxy). */
type ResolvedTimeline = Awaited<Remote<TimelineServices>['timeline']>;

/** Resolved repository service — used to watch working-tree changes for the active scope. */
type ResolvedRepository = Awaited<Remote<TimelineServices>['repository']>;

export function resolveInitialScope(
	persistedScope: TimelineScopeSerialized | undefined,
	hostScope: TimelineScopeSerialized | undefined,
): TimelineScopeSerialized | undefined {
	return hostScope ?? persistedScope;
}

export class TimelineActions {
	private readonly _services: Remote<TimelineServices>;
	private readonly _timeline: ResolvedTimeline;
	private readonly _repository: ResolvedRepository;
	private readonly _state: TimelineState;
	private readonly _datasetResource: Resource<TimelineDatasetResult | undefined>;

	// Telemetry dedup: only push when context changes
	private readonly _pushTelemetryContext: (context: Record<string, string | number | boolean | undefined>) => void;

	// Debounced chart selection
	private _fireSelectDataPointDebounced: Deferrable<(e: CommitEventDetail) => void> | undefined;

	// Working-tree watch for the currently-viewed repo (refreshes pseudo-commit/WIP row)
	private _wipWatchRepoPath: string | undefined;
	private _wipWatchUnsubscribe: (() => void) | undefined;

	constructor(
		state: TimelineState,
		services: Remote<TimelineServices>,
		timeline: ResolvedTimeline,
		repository: ResolvedRepository,
		datasetResource: Resource<TimelineDatasetResult | undefined>,
	) {
		this._state = state;
		this._services = services;
		this._timeline = timeline;
		this._repository = repository;
		this._datasetResource = datasetResource;

		const telemetry = Promise.resolve(services.telemetry);
		this._pushTelemetryContext = createTelemetryContextUpdater(
			context => void telemetry.then(t => t.updateContext(context)),
		);
	}

	/** Cancel any pending debouncers and unsubscribe from WIP watching. Call from disconnectedCallback. */
	dispose(): void {
		this._fireSelectDataPointDebounced?.cancel?.();
		this.unwatchWip();
	}

	/**
	 * Subscribe to FS changes for a repo so the WIP pseudo-commit row refreshes on file saves.
	 *
	 * Supertalk RPC marshals subscription methods as `Promise<Unsubscribe>`, so the call
	 * must be awaited — a synchronous assignment captures the Promise (not callable).
	 */
	private watchWip(repoPath: string): void {
		if (repoPath === this._wipWatchRepoPath) return;

		this._wipWatchUnsubscribe?.();
		this._wipWatchUnsubscribe = undefined;
		this._wipWatchRepoPath = repoPath;

		void (async () => {
			const unsubscribe = (await this._repository.onRepositoryWorkingChanged(repoPath, () => {
				void this.fetchTimeline();
			})) as unknown as (() => void) | undefined;
			if (typeof unsubscribe !== 'function') return;
			if (this._wipWatchRepoPath !== repoPath) {
				unsubscribe();
				return;
			}
			this._wipWatchUnsubscribe = unsubscribe;
		})();
	}

	/** Stop watching WIP changes for the current repo. */
	private unwatchWip(): void {
		this._wipWatchUnsubscribe?.();
		this._wipWatchUnsubscribe = undefined;
		this._wipWatchRepoPath = undefined;
	}

	/**
	 * Called when the webview becomes hidden (`visibilitychange`) to prevent
	 * hanging promises — VS Code silently drops host→webview `postMessage`
	 * while hidden, so RPC responses would never arrive.
	 */
	cancelPendingRequests(): void {
		this._datasetResource.cancel();
		this._fireSelectDataPointDebounced?.cancel?.();
	}

	/**
	 * Fetch initial context and populate state.
	 * Called once from `_onRpcReady` after subscriptions are set up.
	 */
	async populateInitialState(): Promise<void> {
		const s = this._state;
		const ctx = await this._timeline.getInitialContext();

		// Apply host display config
		s.displayConfig.set({
			abbreviatedShaLength: ctx.displayConfig.abbreviatedShaLength,
			dateFormat: ctx.displayConfig.dateFormat,
			shortDateFormat: ctx.displayConfig.shortDateFormat,
		});
		setAbbreviatedShaLength(ctx.displayConfig.abbreviatedShaLength);

		// Apply config overrides from command args (e.g., opening Timeline for a specific file).
		// These override persisted values since they represent an explicit user action.
		if (ctx.configOverrides != null) {
			if (ctx.configOverrides.period != null) {
				s.period.set(ctx.configOverrides.period);
			}
			if (ctx.configOverrides.showAllBranches != null) {
				s.showAllBranches.set(ctx.configOverrides.showAllBranches);
			}
			if (ctx.configOverrides.sliceBy != null) {
				s.sliceBy.set(ctx.configOverrides.sliceBy);
			}
		}

		// Host scope is authoritative on initial load/re-show because it reflects the
		// current active editor or explicit open args. Persisted scope is only a fallback
		// when the host has no scope to provide.
		const scope = resolveInitialScope(s.scope.get(), ctx.scope);
		if (scope != null) {
			s.scope.set(scope);
			await this.fetchTimeline();
		}

		void this.fetchRepoCount();
	}

	/**
	 * Fetch the timeline dataset. The resource handles cancel-previous and
	 * staleness detection internally. Side-effect signals (scope, repository,
	 * repositories, access) are updated from the result.
	 */
	async fetchTimeline(): Promise<void> {
		const s = this._state;
		if (s.scope.get() == null) return;

		await this._datasetResource.fetch();

		// Update side-effect signals from the result
		if (this._datasetResource.status.get() === 'success') {
			const result = this._datasetResource.value.get();
			if (result != null) {
				// Update scope with enriched version from host (has relativePath, head, base)
				s.scope.set(result.scope);
				s.repository.set(result.repository);
				s.access.set(result.access);
				s.error.set(undefined);
				// Start/switch WIP watch for the enriched repo so file saves refresh the pseudo-commit row
				if (result.repository?.path) {
					this.watchWip(result.repository.path);
				}
			}
		} else if (this._datasetResource.status.get() === 'error') {
			s.error.set(this._datasetResource.error.get());
		}
	}

	async fetchDisplayConfig(): Promise<void> {
		const config = await this._services.config;
		const [dateFormat, shortDateFormat, abbreviatedShaLength] = await config.getMany(
			'defaultDateFormat',
			'defaultDateShortFormat',
			'advanced.abbreviatedShaLength',
		);
		this._state.displayConfig.set({
			dateFormat: dateFormat ?? '',
			shortDateFormat: shortDateFormat ?? '',
			abbreviatedShaLength: abbreviatedShaLength,
		});
		setAbbreviatedShaLength(abbreviatedShaLength);
	}

	async fetchRepoCount(): Promise<void> {
		const repositories = await this._services.repositories;
		const state = await repositories.getRepositoriesState();
		this._state.repositories.set({
			count: state.count,
			openCount: state.openCount,
		});
	}

	onScopeChanged(event: ScopeChangedEvent | undefined): void {
		const s = this._state;
		if (event == null) {
			s.scope.set(undefined);
			this._datasetResource.cancel();
			this._datasetResource.mutate(undefined);
			s.repository.set(undefined);
			this.unwatchWip();
			return;
		}

		// Skip if same URI and same type (type change on same URI is a real scope change)
		const currentScope = s.scope.get();
		if (currentScope?.uri === event.uri && currentScope?.type === event.type) return;

		// head/base are left undefined — host enriches them in getDataset()
		s.scope.set({
			type: event.type,
			uri: event.uri,
			relativePath: '',
		});
		void this.fetchTimeline();
	}

	onRepoChanged(e: RepositoryChangeEventData): void {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		// Only act on changes to the repo we're currently viewing
		// Compare URIs (not paths) to avoid Windows path separator and encoding issues
		if (currentScope.uri !== e.repoUri && !currentScope.uri.startsWith(`${e.repoUri}/`)) return;

		// Skip change types that don't affect chart data
		if (!e.changes.some(c => !irrelevantTimelineChanges.has(c))) return;

		void this.fetchTimeline();
	}

	pushTelemetryContext(): void {
		this._pushTelemetryContext({
			'context.period': this._state.period.get(),
			'context.showAllBranches': this._state.showAllBranches.get(),
			'context.sliceBy': this._state.sliceBy.get(),
		});
	}

	private sendConfigChangedTelemetry(): void {
		fireAndForget(
			Promise.resolve(this._services.telemetry).then(t =>
				t.sendEvent('timeline/config/changed', {
					period: this._state.period.get(),
					showAllBranches: this._state.showAllBranches.get(),
					sliceBy: this._state.sliceBy.get(),
				}),
			),
			'timeline config changed telemetry',
		);
	}

	changePeriod(period: TimelinePeriod): void {
		this._state.period.set(period);
		this.sendConfigChangedTelemetry();
		void this.fetchTimeline();
	}

	changeSliceBy(sliceBy: TimelineSliceBy): void {
		const s = this._state;
		s.sliceBy.set(sliceBy);
		// sliceBy=branch requires showAllBranches
		if (sliceBy === 'branch' && !s.showAllBranches.get()) {
			s.showAllBranches.set(true);
		}
		this.sendConfigChangedTelemetry();
		void this.fetchTimeline();
	}

	changeShowAllBranches(checked: boolean): void {
		this._state.showAllBranches.set(checked);
		this.sendConfigChangedTelemetry();
		void this.fetchTimeline();
	}

	async chooseBaseRef(): Promise<void> {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		const result = await this._timeline.chooseRef({
			scope: currentScope,
			type: 'base',
			showAllBranches: s.showAllBranches.get(),
		});
		if (result?.ref == null) return;

		// Update scope with new base
		s.scope.set({ ...currentScope, base: result.ref });
		void this.fetchTimeline();
	}

	async chooseHeadRef(location: string | null): Promise<void> {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		const result = await this._timeline.chooseRef({
			scope: currentScope,
			type: 'head',
			showAllBranches: s.showAllBranches.get(),
		});

		// null ref = "All Branches" selected
		if (result?.ref === null) {
			if (!s.showAllBranches.get()) {
				s.showAllBranches.set(true);
				void this.fetchTimeline();
			}
			return;
		}
		if (result?.ref == null) return;

		if (location === 'config') {
			// Config head pick: keep showAllBranches setting, just update head
			const base = s.showAllBranches.get() ? undefined : currentScope.base;
			s.scope.set({ ...currentScope, head: result.ref, base: base as any });
			void this.fetchTimeline();
			return;
		}

		// Breadcrumb head pick: set head, clear base, turn off showAllBranches
		s.scope.set({ ...currentScope, head: result.ref, base: undefined });
		if (s.showAllBranches.get()) {
			s.showAllBranches.set(false);
		}
		void this.fetchTimeline();
	}

	/**
	 * Show file/folder picker and navigate or open in editor.
	 * @param openInEditor - If true, open picked path in editor instead of navigating
	 */
	async choosePath(openInEditor: boolean): Promise<void> {
		const s = this._state;
		const repo = s.repository.get();
		const currentScope = s.scope.get();
		if (repo == null || currentScope == null) return;

		const result = await this._timeline.choosePath({
			repoUri: repo.uri,
			ref: s.head.get(),
			title: 'Select a File or Folder to Visualize',
			initialPath: currentScope.type === 'file' ? dirname(currentScope.relativePath) : currentScope.relativePath,
		});
		if (result?.picked == null) return;

		if (openInEditor) {
			this._timeline.openInEditor({
				...currentScope,
				type: result.picked.type,
				relativePath: result.picked.relativePath,
			});
			return;
		}

		s.scope.set({
			...currentScope,
			type: result.picked.type,
			relativePath: result.picked.relativePath,
		});
		void this.fetchTimeline();
	}

	/**
	 * Navigate breadcrumb scope or open in editor.
	 * @param type - The scope type from the breadcrumb item
	 * @param value - The path value from the breadcrumb item (null for repo type)
	 * @param openInEditor - If true, open scope in editor instead of navigating
	 */
	changeScope(type: TimelineScopeType, value: string | null | undefined, openInEditor: boolean): void {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		if (type === 'repo') {
			if (openInEditor) {
				this._timeline.openInEditor({ ...currentScope, type: 'repo', relativePath: '' });
				return;
			}

			// Repo-to-repo: need picker
			if (currentScope.type === 'repo') {
				void this.pickAndNavigateRepo();
				return;
			}

			// Navigate to repo scope
			s.scope.set({
				...currentScope,
				type: 'repo',
				relativePath: '',
			});
			void this.fetchTimeline();
			return;
		}

		if (value == null) return;

		if (openInEditor) {
			this._timeline.openInEditor({
				...currentScope,
				type: type,
				relativePath: value,
			});
			return;
		}

		s.scope.set({
			...currentScope,
			type: type,
			relativePath: value,
		});
		void this.fetchTimeline();
	}

	async pickAndNavigateRepo(): Promise<void> {
		const s = this._state;
		const result = await this._timeline.chooseRepo();
		if (result == null) return;

		// head/base are left undefined — host enriches them in getDataset()
		s.scope.set({
			type: result.type,
			uri: result.uri,
			relativePath: '',
		});
		void this.fetchTimeline();
	}

	selectDataPoint(detail: CommitEventDetail): void {
		const s = this._state;
		if (s.scope.get() == null) return;

		this._fireSelectDataPointDebounced ??= debounce(
			(e: CommitEventDetail) => {
				const scope = s.scope.get();
				if (scope == null) return;
				this._timeline.selectDataPoint({ scope: scope, ...e });
			},
			250,
			{ maxWait: 500 },
		);
		this._fireSelectDataPointDebounced(detail);
	}
}
