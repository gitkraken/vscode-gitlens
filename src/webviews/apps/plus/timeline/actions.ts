/**
 * Actions for the Timeline webview.
 *
 * This module contains all RPC calls, state mutations, and business logic
 * for the Timeline view. The Lit component delegates to these methods
 * after parsing DOM events.
 *
 * Patterns used:
 * - Resource: `datasetResource` handles fetch/cancel/staleness for the chart dataset
 * - Auto-persistence: persisted signals are auto-saved via `startAutoPersist()` (no manual persistState)
 * - Telemetry dedup: `pushTelemetryContext` only sends when context changes
 * - Debounced selection: `selectDataPoint` debounces rapid chart clicks
 */
import type { Remote } from '@eamodio/supertalk';
import { setAbbreviatedShaLength } from '../../../../git/utils/revision.utils.js';
import type { Deferrable } from '../../../../system/function/debounce.js';
import { debounce } from '../../../../system/function/debounce.js';
import { dirname } from '../../../../system/path.js';
import type {
	ScopeChangedEvent,
	TimelineDatasetResult,
	TimelinePeriod,
	TimelineScopeSerialized,
	TimelineScopeType,
	TimelineServices,
	TimelineSliceBy,
} from '../../../plus/timeline/protocol.js';
import type { RepositoryChangeEventData } from '../../../rpc/services/types.js';
import { createTelemetryContextUpdater } from '../../shared/actions/telemetry.js';
import type { Resource } from '../../shared/state/resource.js';
import type { CommitEventDetail } from './components/chart.js';
import type { TimelineState } from './state.js';

export class TimelineActions {
	private readonly _services: Remote<TimelineServices>;
	private readonly _state: TimelineState;
	private readonly _datasetResource: Resource<TimelineDatasetResult | undefined>;

	// Telemetry dedup: only push when context changes
	private readonly _pushTelemetryContext: (context: Record<string, string | number | boolean | undefined>) => void;

	// Debounced chart selection
	private _fireSelectDataPointDebounced: Deferrable<(e: CommitEventDetail) => void> | undefined;

	constructor(
		state: TimelineState,
		services: Remote<TimelineServices>,
		datasetResource: Resource<TimelineDatasetResult | undefined>,
	) {
		this._state = state;
		this._services = services;
		this._datasetResource = datasetResource;

		const telemetry = Promise.resolve(services.telemetry);
		this._pushTelemetryContext = createTelemetryContextUpdater(
			context => void telemetry.then(t => t.updateContext(context)),
		);
	}

	/** Cancel any pending debouncers. Call from disconnectedCallback. */
	dispose(): void {
		this._fireSelectDataPointDebounced?.cancel?.();
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

	// ============================================================
	// Lifecycle
	// ============================================================

	/**
	 * Fetch initial context and populate state.
	 * Called once from `_onRpcReady` after subscriptions are set up.
	 */
	async populateInitialState(): Promise<void> {
		const s = this._state;
		const ctx = await this._services.getInitialContext();

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

		// Persisted scope takes priority — it reflects the user's most recent navigation
		// (e.g., choosePath, breadcrumb navigation). Host scope is fallback for first open.
		const scope = s.scope.get() ?? ctx.scope;
		if (scope != null) {
			s.scope.set(scope);
			await this.fetchTimeline();
		}
	}

	// ============================================================
	// Data fetching
	// ============================================================

	/**
	 * Fetch the timeline dataset. The resource handles cancel-previous and
	 * staleness detection internally. Side-effect signals (scope, repository,
	 * repositories, access) are updated from the result.
	 */
	async fetchTimeline(): Promise<void> {
		const s = this._state;
		if (s.scope.get() == null) return;

		await this._datasetResource.fetch();

		// Update side-effect signals from the result (only if fetch succeeded)
		if (this._datasetResource.status.get() === 'success') {
			const result = this._datasetResource.value.get();
			if (result != null) {
				// Update scope with enriched version from host (has relativePath, head, base)
				s.scope.set(result.scope);
				s.repository.set(result.repository);
				s.repositories.set(result.repositoryCounts);
				s.access.set(result.access);
			}
		}
	}

	async fetchDisplayConfig(): Promise<void> {
		const s = this._state;
		// Re-fetch initial context to get updated display config from host settings
		const ctx = await this._services.getInitialContext();
		s.displayConfig.set({
			dateFormat: ctx.displayConfig.dateFormat,
			shortDateFormat: ctx.displayConfig.shortDateFormat,
			abbreviatedShaLength: ctx.displayConfig.abbreviatedShaLength,
		});
		setAbbreviatedShaLength(ctx.displayConfig.abbreviatedShaLength);
	}

	async fetchRepoCount(): Promise<void> {
		const s = this._state;
		const git = await this._services.git;
		const repos = await git.getRepositories();
		s.repositories.set({
			count: repos.length,
			openCount: repos.filter(r => !r.closed).length,
		});
	}

	// ============================================================
	// Event handlers (called by subscriptions)
	// ============================================================

	onScopeChanged(event: ScopeChangedEvent | undefined): void {
		const s = this._state;
		if (event == null) {
			s.scope.set(undefined);
			this._datasetResource.mutate(undefined);
			s.repository.set(undefined);
			return;
		}

		// Skip if same URI
		const currentScope = s.scope.get();
		if (currentScope?.uri === event.uri) return;

		// Create new scope — head/base will be enriched by getDataset on the host
		// head/base undefined here — host enriches them in getDataset()
		s.scope.set({
			type: event.type,
			uri: event.uri,
			head: undefined as any,
			base: undefined as any,
			relativePath: '',
		} as TimelineScopeSerialized);
		void this.fetchTimeline();
	}

	onRepoChanged(e: RepositoryChangeEventData): void {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		// Only act on changes to the repo we're currently viewing
		// Compare URIs (not paths) to avoid Windows path separator and encoding issues
		if (currentScope.uri !== e.repoUri && !currentScope.uri.startsWith(`${e.repoUri}/`)) return;

		void this.fetchTimeline();
	}

	pushTelemetryContext(): void {
		this._pushTelemetryContext({
			'context.period': this._state.period.get(),
			'context.showAllBranches': this._state.showAllBranches.get(),
			'context.sliceBy': this._state.sliceBy.get(),
		});
	}

	// ============================================================
	// Config changes
	// ============================================================

	changePeriod(period: TimelinePeriod): void {
		this._state.period.set(period);
		void this.fetchTimeline();
	}

	changeSliceBy(sliceBy: TimelineSliceBy): void {
		const s = this._state;
		s.sliceBy.set(sliceBy);
		// sliceBy=branch requires showAllBranches
		if (sliceBy === 'branch' && !s.showAllBranches.get()) {
			s.showAllBranches.set(true);
		}
		void this.fetchTimeline();
	}

	changeShowAllBranches(checked: boolean): void {
		this._state.showAllBranches.set(checked);
		void this.fetchTimeline();
	}

	// ============================================================
	// User actions (require host RPC)
	// ============================================================

	async chooseBaseRef(): Promise<void> {
		const s = this._state;
		const currentScope = s.scope.get();
		if (currentScope == null) return;

		const result = await this._services.chooseRef({
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

		const result = await this._services.chooseRef({
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
		s.scope.set({ ...currentScope, head: result.ref, base: undefined as any });
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

		const result = await this._services.choosePath({
			repoUri: repo.uri,
			ref: s.head.get(),
			title: 'Select a File or Folder to Visualize',
			initialPath: currentScope.type === 'file' ? dirname(currentScope.relativePath) : currentScope.relativePath,
		});
		if (result?.picked == null) return;

		if (openInEditor) {
			void this._services.openInEditor({
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
				void this._services.openInEditor(currentScope);
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
			void this._services.openInEditor({
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
		const result = await this._services.chooseRepo();
		if (result == null) return;

		// head/base undefined here — host enriches them in getDataset()
		s.scope.set({
			type: result.type,
			uri: result.uri,
			head: undefined as any,
			base: undefined as any,
			relativePath: '',
		} as TimelineScopeSerialized);
		void this.fetchTimeline();
	}

	selectDataPoint(detail: CommitEventDetail): void {
		const s = this._state;
		if (s.scope.get() == null) return;

		this._fireSelectDataPointDebounced ??= debounce((e: CommitEventDetail) => {
			const scope = s.scope.get();
			if (scope == null) return;
			void this._services.selectDataPoint({ scope: scope, ...e });
		}, 250);
		this._fireSelectDataPointDebounced(detail);
	}
}
