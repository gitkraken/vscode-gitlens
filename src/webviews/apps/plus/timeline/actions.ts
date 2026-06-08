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
import { periodToMs } from '../../../plus/timeline/utils/period.js';
import type { RepositoryChange, RepositoryChangeEventData } from '../../../rpc/services/types.js';
import { fireAndForget } from '../../shared/actions/rpc.js';
import { createTelemetryContextUpdater } from '../../shared/actions/telemetry.js';
import type { Resource } from '../../shared/state/resource.js';
import { isPseudoCommitDatum } from './components/chart/timelineData.js';
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

	/** Each `gl-load-more` extends the loaded span by `period * extensionChunkRatio`, clamped
	 *  to `[extensionChunkMinMs, extensionChunkMaxMs]`. At 0.25, a 1-year period extends in
	 *  3-month bites; the clamps keep extreme periods sane (a 1-day period would otherwise
	 *  page in 6-hour chunks → many round-trips, and a 4-year period would page in 1-year
	 *  chunks → very large single fetches). */
	private static readonly extensionChunkRatio = 0.25;
	/** Floor for the extension chunk size (~1 week). Without this, tiny periods (1 day, 1
	 *  week) extend in fractions of a day per request — every pan past the loaded edge fires
	 *  another RPC for a sliver of history, dominating the user's experience with latency
	 *  rather than data. */
	private static readonly extensionChunkMinMs = 7 * 24 * 60 * 60 * 1000;
	/** Ceiling for the extension chunk size (~1 year). Without this, large periods (2 year, 4
	 *  year) extend in 6-month / 1-year bites — single chunks become long-running fetches
	 *  that block the user from seeing any progress. */
	private static readonly extensionChunkMaxMs = 365 * 24 * 60 * 60 * 1000;
	/** Initial fetch covers `period * (1 + initialBufferRatio)` so the chart's view (one
	 *  period span) has 25% buffer to the left of the loaded data — prevents the chart's
	 *  near-edge `gl-load-more` from auto-firing the moment the initial render happens. */
	private static readonly initialBufferRatio = 0.25;
	/** Length of the previous successful dataset; compared after each fetch to detect
	 *  end-of-history (extension fetch returned no new rows). */
	private _lastResolvedDataLength = 0;

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

		this._pushTelemetryContext = createTelemetryContextUpdater(
			context => void services.telemetry.then(t => t.updateContext(context)),
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
				// Working-tree change → patch only the WIP row, NOT a full `fetchTimeline()`.
				// A full refetch would re-walk contributors and run the per-commit branch
				// loop in `computeTimelineDataset` for every file save, which is also why
				// other timeline instances watching the same repo would visibly spin in
				// lockstep on every keystroke-saved file.
				void this.refreshWip();
			})) as unknown as (() => void) | undefined;
			if (typeof unsubscribe !== 'function') return;
			if (this._wipWatchRepoPath !== repoPath) {
				unsubscribe();
				return;
			}

			this._wipWatchUnsubscribe = unsubscribe;
		})();
	}

	/**
	 * Patch only the leading WIP pseudo-commit(s) of the current dataset with fresh
	 * working-tree status. Cheap: one host call (`getWip`) instead of the full dataset RPC.
	 * No-op when there is no current dataset (initial load handles WIP itself).
	 *
	 * Race guard: re-checks scope identity (uri + type) and resource value identity after the
	 * `getWip` await. If a scope change or a fresh fetch has landed during our await, we bail
	 * without mutating — otherwise we'd restore the prior scope's dataset onto the new scope,
	 * or clobber a fresher dataset with our stale patch. Doesn't share `_runFetch`'s
	 * `generationId` mechanism because they have asymmetric authority — a fresh fetch should
	 * always win over a WIP patch, but a WIP patch shouldn't supersede a fresh fetch.
	 */
	async refreshWip(): Promise<void> {
		const s = this._state;
		const scope = s.scope.get();
		if (scope == null) return;

		const result = this._datasetResource.value.get();
		if (result == null || result.dataset.length === 0) return;

		const timeline = await this._services.timeline;
		const newWip = await timeline.getWip(scope);

		// `onScopeChanged` always assigns a new scope object, so compare uri + type, not refs.
		const currentScope = s.scope.get();
		if (currentScope?.uri !== scope.uri || currentScope?.type !== scope.type) return;
		// A fresh fetch or another refreshWip during our await would have replaced the
		// resource value via `_runFetch`'s `result` capture or this method's `mutate`. If
		// the value isn't the same reference we captured, drop our patch.
		if (this._datasetResource.value.get() !== result) return;

		const dataset = result.dataset;
		let leadingWipCount = 0;
		while (leadingWipCount < dataset.length && isPseudoCommitDatum(dataset[leadingWipCount])) {
			leadingWipCount++;
		}

		// Dedup: if the WIP rows are unchanged (same shape + same per-row stats), skip the
		// mutate so the chart doesn't churn on every file save. Same length + matching stats
		// is sufficient — message/date/etc. are deterministic for a given working-tree state.
		if (leadingWipCount === newWip.length) {
			let same = true;
			for (let i = 0; i < newWip.length; i++) {
				const a = dataset[i];
				const b = newWip[i];
				if (
					a.sha !== b.sha ||
					a.additions !== b.additions ||
					a.deletions !== b.deletions ||
					a.files !== b.files
				) {
					same = false;
					break;
				}
			}
			if (same) return;
		}

		// New WIP rows are all timestamped at "now" so they remain at the head; non-WIP rows
		// after them are already sorted newest-first from the prior fetch. No re-sort needed.
		const next = dataset.slice();
		next.splice(0, leadingWipCount, ...newWip);

		this._datasetResource.mutate({ ...result, dataset: next });
		this._lastResolvedDataLength = next.length;
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
			currentUserNameStyle: ctx.displayConfig.currentUserNameStyle,
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
	/**
	 * Fetch the timeline dataset for the current scope/period/sliceBy/etc. — a "fresh" fetch
	 * that replaces whatever is on screen. Used on initial load, scope change, period change,
	 * sliceBy/showAllBranches change, repo change, etc. Resets the progressive-load state
	 * (`loadedSpanMs`, `hasMore`, `loadingMore`) so the next user-driven `extendTimeline`
	 * starts from the period-derived span.
	 *
	 * For paginated load-more (chart's `gl-load-more`), call `extendTimeline` instead — that
	 * preserves the existing dataset and extends backwards in history.
	 */
	async fetchTimeline(): Promise<void> {
		const s = this._state;
		if (s.scope.get() == null) return;

		// Reset progressive-load state — this fetch is for a different (scope, period, …)
		// combination than whatever is on screen. Force-clear `loadingMore` in case a stale
		// `extendTimeline` was racing, so the chart goes back to its full-spinner affordance
		// for the duration of this fresh fetch.
		// Pre-set `loadedSpanMs` to `period × (1 + initialBufferRatio)` so the host's resource
		// fetcher reads it and loads the buffered span on the first fetch — without this, the
		// host defaults to `since = today - period` and the chart hits the loaded edge the
		// moment the user pans past the windowed default. `'all'` period collapses to undefined
		// (loadedSpanMs stays null → host fetches unbounded).
		const baseSpan = periodToMs(s.period.get());
		const bufferedSpan = baseSpan != null ? baseSpan * (1 + TimelineActions.initialBufferRatio) : null;
		s.loadedSpanMs.set(bufferedSpan);
		s.hasMore.set(true);
		s.loadingMore.set(false);
		this._lastResolvedDataLength = 0;

		await this._runFetch(false);
	}

	/**
	 * Chart asks for older history (user zoomed past the loaded oldest). Extends the loaded
	 * span by a chunk (`period * extensionChunkRatio`) and re-fetches — the host returns a
	 * wider dataset, the chart sees the same newest commit + more rows, and preserves the
	 * user's zoom/scroll via its extension-detection.
	 */
	extendTimeline(): void {
		const s = this._state;
		if (s.scope.get() == null) return;
		// Guard against re-entry while a load-more is in flight, and skip when we've already
		// reached end-of-history.
		if (!s.hasMore.get() || s.loadingMore.get()) return;

		const baseSpan = periodToMs(s.period.get());
		if (baseSpan == null) return; // 'all' period — already unbounded

		const chunkSpan = Math.min(
			TimelineActions.extensionChunkMaxMs,
			Math.max(TimelineActions.extensionChunkMinMs, baseSpan * TimelineActions.extensionChunkRatio),
		);
		// `loadedSpanMs` is always set after `fetchTimeline`, but be defensive: if it ever
		// races to null (e.g., a scope change wiped state between the prior fetch and now),
		// fall back to the assumed-initial buffer so the next chunk lands at the right edge.
		const currentSpan = s.loadedSpanMs.get() ?? baseSpan * (1 + TimelineActions.initialBufferRatio);
		s.loadingMore.set(true);
		s.loadedSpanMs.set(currentSpan + chunkSpan);
		void this._runFetch(true);
	}

	/**
	 * @param isLoadMore - extension-only post-fetch behaviors: end-of-history detection
	 *   and clearing `loadingMore`.
	 *
	 * Bails when a later fetch has overtaken us (the resource cancels the RPC but the
	 * awaiter still resumes; without the gen-id check it'd clobber the latest scope's state).
	 */
	private async _runFetch(isLoadMore: boolean): Promise<void> {
		const s = this._state;
		const previousLength = this._lastResolvedDataLength;
		const expectedGenAfter = this._datasetResource.generationId.get() + 1;

		try {
			await this._datasetResource.fetch();

			if (this._datasetResource.generationId.get() !== expectedGenAfter) return;

			if (this._datasetResource.status.get() === 'success') {
				const result = this._datasetResource.value.get();
				if (result != null) {
					// Update scope with enriched version from host (has relativePath, head, base)
					s.scope.set(result.scope);
					s.repository.set(result.repository);
					s.access.set(result.access);
					s.allowRepoSwitch.set(result.allowRepoSwitch ?? false);
					s.error.set(undefined);
					// Start/switch WIP watch for the enriched repo so file saves refresh the pseudo-commit row
					if (result.repository?.path) {
						this.watchWip(result.repository.path);
					}

					const currentLength = result.dataset.length;
					// End-of-history detection: a load-more that didn't grow the dataset means
					// we've reached the start of the scope's history — stop offering load-more.
					if (isLoadMore && currentLength <= previousLength) {
						s.hasMore.set(false);
					}
					this._lastResolvedDataLength = currentLength;
				}
			} else if (this._datasetResource.status.get() === 'error') {
				s.error.set(this._datasetResource.error.get());
			}
		} finally {
			// Clear `loadingMore` unconditionally — including when the gen-mismatch early-return
			// fires above (a fresh fetch overtook us). Without this, an extend that gets
			// preempted strands `loadingMore = true`, and `extendTimeline`'s `if (loadingMore)
			// return` guard then blocks every subsequent load-more, freezing the chart's edge
			// indicator with no way for the user to recover. Fresh fetches handle their own
			// `loadingMore` reset in `fetchTimeline`'s setup, so double-clearing here is safe.
			if (isLoadMore) {
				s.loadingMore.set(false);
			}
		}
	}

	async fetchDisplayConfig(): Promise<void> {
		const config = await this._services.config;
		const [dateFormat, shortDateFormat, abbreviatedShaLength, currentUserNameStyle] = await config.getMany(
			'defaultDateFormat',
			'defaultDateShortFormat',
			'advanced.abbreviatedShaLength',
			'defaultCurrentUserNameStyle',
		);
		this._state.displayConfig.set({
			dateFormat: dateFormat ?? '',
			shortDateFormat: shortDateFormat ?? '',
			abbreviatedShaLength: abbreviatedShaLength,
			currentUserNameStyle: currentUserNameStyle ?? 'nameAndYou',
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
			s.loadedSpanMs.set(null);
			s.hasMore.set(true);
			this._lastResolvedDataLength = 0;
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
			this._services.telemetry.then(t =>
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
		const s = this._state;
		const prevPeriod = s.period.get();
		if (prevPeriod === period) return;

		s.period.set(period);
		this.sendConfigChangedTelemetry();

		const newSpanMs = periodToMs(period);
		if (newSpanMs == null) {
			// Switching TO 'all' — always refetch (we don't know if everything is loaded yet).
			void this.fetchTimeline();
			return;
		}

		// Use the actual dataset extent (newest commit's ts − oldest commit's ts) — more
		// reliable than `loadedSpanMs` after various period transitions (e.g., `loadedSpanMs`
		// is null after `'all'` despite the dataset covering everything).
		const result = this._datasetResource.value.get();
		const data = result?.dataset;
		const loadedExtentMs = data != null && data.length > 1 ? data[0].sort - data.at(-1)!.sort : 0;

		// Target = `newPeriod × 1.25` (matches the buffer the host would deliver on a fresh
		// fetch). If we already have that much loaded, skip the host trip — the chart's
		// `_zoomRange` re-anchors to the new windowSpanMs and narrows the view.
		const newTargetSpan = newSpanMs * (1 + TimelineActions.initialBufferRatio);
		if (newTargetSpan <= loadedExtentMs) return;

		// Widening past what's loaded — extend rather than refetch. Sizing the FIRST chunk to
		// fill the gap (`newTargetSpan - loadedExtent`) means the user gets a fully-buffered
		// view on the new period in a single host trip instead of a fresh-dataset reset that
		// would drop the user's zoom/scroll/selection. Subsequent `extendTimeline` calls
		// resume at `newPeriod × extensionChunkRatio` chunks for any further pan into older
		// history.
		s.loadingMore.set(true);
		s.loadedSpanMs.set(newTargetSpan);
		void this._runFetch(true);
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
			s.scope.set({ ...currentScope, head: result.ref, base: base });
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

		s.scope.set({ ...currentScope, type: result.picked.type, relativePath: result.picked.relativePath });
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
				const repoUri = s.repository.get()?.uri ?? currentScope.uri;
				this._timeline.openInEditor({ ...currentScope, type: 'repo', uri: repoUri, relativePath: '' });
				return;
			}

			// Repo-to-repo: need picker
			if (currentScope.type === 'repo') {
				void this.pickAndNavigateRepo();
				return;
			}

			// Navigate to repo scope. Reset uri to the repo's uri so the host's enrichment
			// (which rebuilds relativePath from uri vs repo.uri) yields '' instead of the
			// previous file/folder path — otherwise the path breadcrumbs would re-appear and
			// make it look like the filter wasn't cleared.
			const repoUri = s.repository.get()?.uri ?? currentScope.uri;
			s.scope.set({ ...currentScope, type: 'repo', uri: repoUri, relativePath: '' });
			void this.fetchTimeline();
			return;
		}

		if (value == null) return;

		if (openInEditor) {
			this._timeline.openInEditor({ ...currentScope, type: type, relativePath: value });
			return;
		}

		s.scope.set({ ...currentScope, type: type, relativePath: value });
		void this.fetchTimeline();
	}

	async pickAndNavigateRepo(): Promise<void> {
		const s = this._state;
		const result = await this._timeline.chooseRepo();
		if (result == null) return;

		// head/base are left undefined — host enriches them in getDataset()
		s.scope.set({ type: result.type, uri: result.uri, relativePath: '' });
		void this.fetchTimeline();
	}

	selectDataPoint(detail: CommitEventDetail): void {
		const s = this._state;
		if (s.scope.get() == null) return;

		// Interim selections come from mid-drag slider scrub — useful for visual feedback in the
		// chart but the editor diff would churn through every tick. Skip the host RPC for those;
		// the slider's release event re-fires with `interim: false` and that's what opens the diff.
		// Auto selections are the chart's first-paint highlight — never open a diff editor unprompted.
		if (detail.interim || detail.auto) return;

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
