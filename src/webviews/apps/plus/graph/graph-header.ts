import { computed, SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { cache } from 'lit/directives/cache.js';
import { repeat } from 'lit/directives/repeat.js';
import { when } from 'lit/directives/when.js';
import { getAltKeySymbol } from '@env/platform.js';
import type { SearchOperatorsLongForm, SearchQuery } from '@gitlens/git/models/search.js';
import { parseSearchQuery } from '@gitlens/git/utils/search.utils.js';
import { debounce } from '@gitlens/utils/decorators/debounce.js';
import { hasTruthyKeys } from '@gitlens/utils/object.js';
import { wait } from '@gitlens/utils/promise.js';
import type { BranchGitCommandArgs } from '../../../../commands/git/branch.js';
import { GlyphChars } from '../../../../constants.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import { createCommandLink } from '../../../../system/commands.js';
import type {
	DidChooseRefParams,
	GraphColumnName,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphRefOptData,
	GraphSearchResults,
	GraphSelectedRows,
	ReadonlyGraphRow,
	SelectCommitsOptions,
	State,
} from '../../../plus/graph/protocol.js';
import {
	ChooseRefRequest,
	ChooseRepositoryCommand,
	CloseGraphWalkthroughBannerCommand,
	EnsureRowRequest,
	JumpToHeadRequest,
	OpenPullRequestDetailsCommand,
	SearchCancelCommand,
	SearchOpenInViewCommand,
	SearchRequest,
	UpdateGraphSearchModeCommand,
	UpdateRefsVisibilityCommand,
} from '../../../plus/graph/protocol.js';
import type { RepoButtonGroupClickEvent } from '../../shared/components/repo-button-group.js';
import type { GlSearchBox } from '../../shared/components/search/search-box.js';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-input.js';
import { inlineCode } from '../../shared/components/styles/lit/base.css.js';
import { ipcContext } from '../../shared/contexts/ipc.js';
import type { TelemetryContext } from '../../shared/contexts/telemetry.js';
import { telemetryContext } from '../../shared/contexts/telemetry.js';
import type { WebviewContext } from '../../shared/contexts/webview.js';
import { webviewContext } from '../../shared/contexts/webview.js';
import { ModifierKeysController } from '../../shared/controllers/modifier-keys.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import { ruleStyles } from '../shared/components/vscode.css.js';
import { getDisplayedMode, isGraphFiltered } from './components/gl-graph-scope-popover.js';
import { graphStateContext } from './context.js';
import { getEffectiveDisplayMode } from './displayMode.js';
import { sidebarActionsContext } from './sidebar/sidebarContext.js';
import type { SidebarActions } from './sidebar/sidebarState.js';
import { isGraphSearchResultsError, shouldRestoreSearchQuery } from './stateProvider.js';
import { actionButton, linkBase } from './styles/graph.css.js';
import { graphHeaderControlStyles, titlebarStyles } from './styles/header.css.js';
import '../shared/components/account-chip.js';
import '../shared/components/integrations-chip.js';
import '../../shared/components/branch-name.js';
import '../../shared/components/button.js';
import '../../shared/components/code-icon.js';
import '../../shared/components/menu/menu-divider.js';
import '../../shared/components/menu/menu-item.js';
import '../../shared/components/menu/menu-label.js';
import '../../shared/components/progress.js';
import '../../shared/components/overlays/popover.js';
import '../../shared/components/overlays/tooltip.js';
import '../../shared/components/radio/radio.js';
import '../../shared/components/radio/radio-group.js';
import '../../shared/components/ref-button.js';
import '../../shared/components/repo-button-group.js';
import '../../shared/components/rich/issue-pull-request.js';
import '../../shared/components/search/search-box.js';
import '../../shared/components/shoelace-stub.js';
import './actions/gitActionsButtons.js';
import './components/gl-graph-launchpad-indicator.js';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-header': GlGraphHeader;
	}
}

function getRemoteIcon(type: number | string) {
	switch (type) {
		case 'head':
			return 'vm';
		case 'remote':
			return 'cloud';
		case 'tag':
			return 'tag';
		default:
			return '';
	}
}

function getSearchResultIdByIndex(results: GraphSearchResults, index: number): string | undefined {
	// Loop through the search results without using Object.entries or Object.keys and return the id at the specified index
	const { ids } = results;
	for (const id in ids) {
		if (!Object.hasOwn(ids, id)) continue;

		if (ids[id].i === index) return id;
	}
	return undefined;
}

// Search operator → graph column. Operators not listed (`type:`, `change:`) have no
// corresponding column and don't flip any header filter state. `since:`/`until:` are
// normalized by the parser to `after:`/`before:`, so they're already covered here.
const operatorToColumn: Partial<Record<SearchOperatorsLongForm, GraphColumnName>> = {
	'ref:': 'ref',
	'message:': 'message',
	'author:': 'author',
	'file:': 'changes',
	'after:': 'datetime',
	'before:': 'datetime',
	'commit:': 'sha',
};

@customElement('gl-graph-header')
export class GlGraphHeader extends SignalWatcher(LitElement) {
	static override styles = [
		inlineCode,
		linkBase,
		ruleStyles,
		actionButton,
		titlebarStyles,
		graphHeaderControlStyles,
		css`
			:focus,
			:focus-within,
			:focus-visible {
				outline-color: var(--vscode-focusBorder);
			}

			progress-indicator {
				top: 0;
			}

			.inline-chip {
				flex: none;
				align-self: center;
			}

			.mcp-tooltip::part(body),
			.hooks-tooltip::part(body) {
				--max-width: 320px;
			}

			.graph-walkthrough-tooltip::part(body) {
				--max-width: 400px;
			}

			.mcp-tooltip__content a,
			.hooks-tooltip__content a,
			.graph-walkthrough-tooltip__content a {
				color: var(--vscode-textLink-foreground);
			}

			.action-button--mcp,
			.action-button--hooks {
				background: var(--gl-gradient-brand-subtle);
				border: var(--gl-border-width) solid var(--vscode-panel-border);
			}

			.action-button--graph-walkthrough {
				color: var(--vscode-button-foreground);
				background: var(--vscode-button-background);
				border: var(--gl-border-width) solid var(--vscode-button-background);
			}

			.action-button--graph-walkthrough:hover {
				background: var(--vscode-button-hoverBackground);
			}

			.preview-badge {
				font-size: 0.8em;
				color: var(--color-foreground--65);
			}

			.graph-walkthrough-tooltip__title {
				display: flex;
				gap: 1ch;
				align-items: center;
				justify-content: space-between;
				margin-block-end: var(--gl-space-4);
			}

			.graph-walkthrough-tooltip__actions {
				display: flex;
				gap: var(--gl-space-8);
				align-items: center;
				margin-block-start: var(--gl-space-8);
			}

			/* Search is meaningless in Timeline mode — visually dim it and let \\\`inert\\\` block focus
	   + interactions natively (instead of removing it from the row entirely). */
			.search-box--disabled {
				cursor: not-allowed;
				opacity: 0.5;
			}

			.minimap-toggle-icon {
				transform: rotate(180deg);
			}

			/* Create/Start menu rows: icon + label as an inline-flex pair. Color is inherited so the
			   icon follows the menu-item's hover/selection foreground (no override). */
			.action-menu__item {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
			}
		`,
	];

	@consume({ context: ipcContext })
	private _ipc!: typeof ipcContext.__context__;

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	private _telemetry!: TelemetryContext;

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@consume({ context: webviewContext })
	private _webview!: WebviewContext;

	@state() private aiAllowed = true;

	private readonly _modifiers = new ModifierKeysController(this);

	// Function to get commits without modifying selection, passed from graph-app
	getCommits?: (shas: string[]) => ReadonlyGraphRow[];
	// Function to select commits on the graph, passed from graph-app
	selectCommits?: (shas: string[], options?: SelectCommitsOptions) => ReadonlyGraphRow[];
	// Awaits the graph flushing pending renders (so post-load visibility reads are accurate), from graph-app
	ensureGraphRendered?: () => Promise<void>;

	@property({ type: Boolean, attribute: 'details-visible' })
	detailsVisible = false;

	/** The resolved details side (`right`/`bottom`) from `GraphApp.effectiveDetailsLocation` — already
	 *  accounts for `auto` width resolution, so the toggle reflects where the panel actually is. */
	@property({ attribute: 'details-effective-location' })
	detailsEffectiveLocation: 'right' | 'bottom' = 'right';

	@property({ type: Boolean, attribute: 'minimap-visible' })
	minimapVisible = true;

	@property({ type: Boolean, attribute: 'has-selected-commit' })
	hasSelectedCommit = false;

	/** When set, the account/integrations chips render inline at the end of the header's right group
	 *  instead of the standalone account bar row above (issue #5449). Driven by GraphApp's
	 *  height-based mode tracking; only ever true while the experimental home header is enabled. */
	@property({ type: Boolean, attribute: 'account-bar-inline' })
	accountBarInline = false;

	get hasFilters() {
		// Scope mode forces first-parent rendering, so it always counts as a filter.
		if (this.graphState.scope != null) return true;
		if (this.graphState.config?.onlyFollowFirstParent) return true;
		if (this.graphState.excludeTypes == null) return false;

		return Object.values(this.graphState.excludeTypes).includes(true);
	}

	get excludeRefs() {
		return Object.values(this.graphState.excludeRefs ?? {}).sort(compareGraphRefOpts);
	}

	// Local search query state (not in global context)
	private _searchQuery: SearchQuery = { query: '' };

	@state()
	private _searchResultHidden = false;

	private _lastRepoPath: string | undefined;

	override updated(changedProperties: PropertyValues): void {
		this.aiAllowed = (this.graphState.config?.aiEnabled ?? true) && (this.graphState.orgSettings?.ai ?? true);

		// Clear navigation caches when repository changes
		const currentRepo = this.graphState.selectedRepository;
		if (this._lastRepoPath !== currentRepo) {
			this._lastRepoPath = currentRepo;
			this.ensuredIds.clear();
			this.pendingEnsureRequests.clear();
		}

		// Restore the search box after a reboot/reconnect where an active search's query didn't reach the
		// box (the host carries it on `graphState.searchQuery`). Set the box display via the element's own
		// `setExternalSearchQuery` — NOT the header's same-named method, which also RE-RUNS the search. The
		// guard fires only when the local box is empty and the search is live (results present OR still
		// searching), so it never clobbers an in-progress user query nor revives a just-cancelled search.
		if (
			shouldRestoreSearchQuery(
				this._searchQuery?.query,
				this.graphState.searchQuery,
				this.graphState.searchResults != null,
				this.graphState.searching,
			)
		) {
			const restored = this.graphState.searchQuery!;
			this._searchQuery = restored;
			this.searchEl?.setExternalSearchQuery(restored);
			this.updateActiveFilterColumns();
		}

		super.updated(changedProperties);
	}

	setExternalSearchQuery(query: SearchQuery) {
		this._searchQuery = query;
		this.searchEl?.setExternalSearchQuery(query);
		this.updateActiveFilterColumns();

		// Trigger the search
		void this.startSearch();
	}

	async pickAuthors(): Promise<void> {
		await this.searchEl?.pickAuthors();
	}

	async pickRefs(): Promise<void> {
		await this.searchEl?.pickRefs();
	}

	async pickFiles(): Promise<void> {
		await this.searchEl?.pickFiles();
	}

	insertSearchOperator(operator: string): void {
		this.searchEl?.insertSearchOperator(operator);
	}

	/**
	 * Parses the current search query and writes the set of columns whose operator is
	 * currently present into graph state. Consumed by gl-graph.react.tsx to flip each
	 * column's `isFilterActive` flag before passing settings to GraphContainer.
	 *
	 * Long-form normalization (per searchOperatorsToLongFormMap): `since:`→`after:`,
	 * `until:`→`before:`. Both map to the datetime column.
	 */
	private updateActiveFilterColumns(): void {
		const active = new Set<GraphColumnName>();
		const query = this._searchQuery?.query;
		if (query) {
			const { operations } = parseSearchQuery(this._searchQuery);
			for (const [op, values] of operations) {
				if (values.size === 0) continue;

				const column = operatorToColumn[op];
				if (column != null) {
					active.add(column);
				}
			}
		}
		this.graphState.activeFilterColumns = active;
	}

	private async onJumpToRefPromise(alt: boolean): Promise<DidChooseRefParams | undefined> {
		try {
			const repoName = this.graphState.repositories?.[0]?.name ?? '';
			const rsp: DidChooseRefParams = alt
				? await this._ipc.sendRequest(ChooseRefRequest, {
						title: `Jump to Reference ${GlyphChars.Dot} ${repoName}`,
						placeholder: 'Choose a reference to jump to',
					})
				: await this._ipc.sendRequest(JumpToHeadRequest, undefined);
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: alt } });
			return rsp;
		} catch {
			return undefined;
		}
	}

	private handleSidebarToggled() {
		this.dispatchEvent(new CustomEvent('toggle-sidebar', { bubbles: true, composed: true }));
	}

	private handleToggleDetails(e: MouseEvent) {
		this.dispatchEvent(
			new CustomEvent('toggle-details', {
				detail: { altKey: e.altKey },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private async handleJumpToRef(e: MouseEvent) {
		const ref = await this.onJumpToRefPromise(e.altKey);
		if (ref != null) {
			await this.jumpToSha(ref.sha);
		}
	}

	private async jumpToSha(sha: string) {
		const id = await this.ensureSearchResultRow(sha);
		if (id == null) return;

		const rows = this.selectCommits?.([id], { ensureVisible: true });
		if (rows?.[0]?.hidden) {
			this._searchResultHidden = true;
		}
	}

	private onGraphWalkthroughBannerDismiss(e: Event): void {
		e.preventDefault();
		this._ipc.sendCommand(CloseGraphWalkthroughBannerCommand, {});
	}

	private onGraphWalkthroughBannerButtonClick(e: Event): void {
		e.preventDefault();
		this._ipc.sendCommand(CloseGraphWalkthroughBannerCommand, { openWelcome: true });
	}

	private onOpenPullRequest(pr: NonNullable<NonNullable<State['branchState']>['pr']>): void {
		this._ipc.sendCommand(OpenPullRequestDetailsCommand, { id: pr.id, providerId: pr.provider?.id });
	}

	private onSearchOpenInView() {
		this._ipc.sendCommand(SearchOpenInViewCommand, { search: { ...this._searchQuery } });
	}

	private _activeRowInfoCache: { row: string; info: { date: number; id: string } } | undefined;

	private getActiveRowInfo(): { date: number; id: string } | undefined {
		const { activeRow } = this.graphState;
		if (activeRow == null) return undefined;
		if (this._activeRowInfoCache?.row === activeRow) return this._activeRowInfoCache?.info;

		const index = activeRow.indexOf('|');

		const info = { date: Number(activeRow.substring(index + 1)), id: activeRow.substring(0, index) };
		this._activeRowInfoCache = { row: activeRow, info: info };
		return info;
	}

	private getNextOrPreviousSearchResultIndex(
		index: number,
		next: boolean,
		results: GraphSearchResults,
		query: SearchQuery | undefined,
	) {
		if (next) {
			if (index < results.count - 1) {
				index++;
			} else if (query != null && results.hasMore) {
				index = -1; // Indicates a boundary that we should load more results
			}
			// else: at the end with no more results - stay at current index
		} else if (index > 0) {
			index--;
		} else if (query != null && results.hasMore) {
			index = -1; // Indicates a boundary that we should load more results
		}
		// else: at the beginning with no more results - stay at current index
		return index;
	}

	private getClosestSearchResultIndex(
		results: GraphSearchResults,
		query: SearchQuery | undefined,
		next: boolean = true,
	): { index: number; id: string | undefined } {
		if (results.ids == null) return { index: 0, id: undefined };

		const activeInfo = this.getActiveRowInfo();
		const activeId = activeInfo?.id;
		if (activeId == null) return { index: 0, id: undefined };

		let index: number | undefined;
		let nearestId: string | undefined;
		let nearestIndex: number | undefined;

		const data = results.ids[activeId];
		if (data != null) {
			index = data.i;
			nearestId = activeId;
			nearestIndex = index;
		}

		if (index == null) {
			const activeDate = activeInfo?.date != null ? activeInfo.date + (next ? 1 : -1) : undefined;
			if (activeDate == null) return { index: 0, id: undefined };

			// Loop through the search results and:
			//  try to find the active id
			//  if next=true find the nearest date before the active date
			//  if next=false find the nearest date after the active date

			let date;
			let entry;
			let i;
			let nearestDate: number | undefined;

			const { ids } = results;
			for (const id in ids) {
				if (!Object.hasOwn(ids, id)) continue;

				entry = ids[id];
				({ date, i } = entry);

				if (next) {
					if (date < activeDate && (nearestDate == null || date > nearestDate)) {
						nearestId = id;
						nearestDate = date;
						nearestIndex = i;
					}
				} else if (date > activeDate && (nearestDate == null || date <= nearestDate)) {
					nearestId = id;
					nearestDate = date;
					nearestIndex = i;
				}
			}

			// If no nearest result found:
			// - When next=true: we're after all results, wrap to last result
			// - When next=false: we're before all results, use -1 to indicate this
			if (nearestIndex == null) {
				index = next ? results.count - 1 : -1;
			} else {
				index = nearestIndex + (next ? -1 : 1);
			}
		}

		index = this.getNextOrPreviousSearchResultIndex(index, next, results, query);

		return index === nearestIndex ? { index: index, id: nearestId } : { index: index, id: undefined };
	}

	private _searchPositionSignal = computed(() => {
		const { searchResults } = this.graphState;
		if (searchResults?.ids == null || !this._searchQuery.query) return 0;

		const id = this.getActiveRowInfo()?.id;
		let searchIndex = id ? searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			// Get the closest search result for display purposes
			// We want to show which result we're at or have passed, not the next one
			({ index: searchIndex } = this.getClosestSearchResultIndex(
				searchResults,
				{
					...this._searchQuery,
				},
				false,
			)); // Use false to get the result we're at/past, not the next one
		}
		// If searchIndex is negative, we're before the first result - show 0
		return searchIndex < 0 ? 0 : searchIndex + 1;
	});

	private get searchPosition(): number {
		return this._searchPositionSignal.get();
	}

	get searchValid() {
		return (this._searchQuery.query?.length ?? 0) > 2;
	}

	private cancelSearch(preserveResults: boolean) {
		// Don't eagerly clear local state — the host sends a clear notification as part of
		// processing the cancel (or starting a new search). Eagerly clearing causes a flash
		// where old results/errors disappear briefly before the new state arrives.
		this._ipc.sendCommand(SearchCancelCommand, { preserveResults: preserveResults });
	}

	private async waitForSearchComplete(timeoutMs: number = 30000): Promise<void> {
		if (!this.graphState.searching) return;

		const deadline = performance.now() + timeoutMs;
		while (this.graphState.searching && performance.now() < deadline) {
			// Wait for the next Lit render cycle — SignalWatcher triggers a
			// re-render when `searching` changes, so updateComplete resolves
			// once the new signal value is reflected.
			await this.updateComplete;
			if (!this.graphState.searching) return;

			// Yield one frame to avoid a tight loop if updateComplete resolves
			// synchronously (e.g., no actual DOM changes in this cycle)
			await new Promise(r => requestAnimationFrame(r));
		}
	}

	// Auto-reveal the first search match (new-search entry point only — next/prev navigation already
	// reveals its own target via executeNavigation, so calling this there would double-reveal).
	private revealFirstSearchMatch(selectedRows: GraphSelectedRows | undefined): void {
		const firstSha = selectedRows != null ? Object.keys(selectedRows)[0] : undefined;
		if (firstSha != null) {
			this.selectCommits?.([firstSha], { ensureVisible: true });
		}
	}

	private async startSearch() {
		if (!this.searchValid) {
			this.cancelSearch(false);
			return;
		}

		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, { search: { ...this._searchQuery } });

			// Only log successful searches with at least 1 result
			if (rsp.search && rsp.results && !('error' in rsp.results) && rsp.results.count > 0) {
				this.searchEl.logSearch(rsp.search);
			}

			// Guard: only update state if this response is still for the current search.
			// Progressive notifications already handle results via searchId filtering,
			// but error results only come through the IPC response.
			if (rsp.searchId === this.graphState.currentSearchId) {
				this.graphState.searchResultsResponse = rsp.results;
				// The IPC response means the host-side search handler has completed —
				// mark searching as done. For successful searches this is redundant
				// (the final notification already set it), but for errors it's the
				// only path that clears the searching state.
				this.graphState.searching = false;
				this.graphState.searchMode = this._searchQuery.filter ? 'filter' : 'normal';
				if (rsp.selectedRows != null) {
					this.graphState.selectedRows = rsp.selectedRows;
					this.revealFirstSearchMatch(rsp.selectedRows);
				}
			}
		} catch {
			this.graphState.searchResultsResponse = undefined;
			this.graphState.searching = false;
		}
	}

	private handleOnToggleRefsVisibilityClick(_event: any, refs: GraphExcludedRef[], visible: boolean) {
		this._ipc.sendCommand(UpdateRefsVisibilityCommand, { refs: refs, visible: visible });
	}

	private handleSearch() {
		void this.startSearch();
	}

	private handleSearchInput(e: CustomEvent<SearchQuery>) {
		// Cancel any existing search before starting a new one
		if (this.graphState.searching) {
			this.cancelSearch(false);
		}

		this._searchQuery = e.detail;
		this.updateActiveFilterColumns();
		this.ensuredIds.clear();
		void this.startSearch();
	}

	private handleSearchCancel(e: CustomEvent<{ preserveResults: boolean }>) {
		this.cancelSearch(e.detail.preserveResults);
	}

	private handleSearchPause() {
		// Pause the search by cancelling with preserveResults=true
		this.cancelSearch(true);
	}

	private handleSearchResume() {
		// Set searching state immediately for responsive UI
		this.graphState.searching = true;

		// Capture current searchId before async gap to detect staleness
		const currentSearchId = this.graphState.currentSearchId;

		// Preserve current search results but ensure hasMore is true
		// Read from searchResultsResponse (the source) not searchResults (the derived value)
		const currentResults = this.graphState.searchResultsResponse;
		if (currentResults != null && !isGraphSearchResultsError(currentResults)) {
			// Only update if we're still on the same search
			if (this.graphState.currentSearchId === currentSearchId) {
				this.graphState.searchResultsResponse = {
					...currentResults,
					hasMore: true,
				};
			}
		}

		// Resume a paused search by requesting more results.
		// The response is deliberately discarded (void) — progressive notifications
		// handle state updates. The host's searchId guard in processSearchStream
		// protects against stale processing if a new search starts before this completes.
		void this._ipc.sendRequest(SearchRequest, {
			search: this._searchQuery,
			more: true,
		});
	}

	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			const rsp = await this._ipc.sendRequest(SearchRequest, {
				search: search,
				limit: options?.limit,
				more: options?.more,
			});

			// Don't update state for resume operations - progressive notifications handle it.
			// For non-resume paths, guard with searchId check to prevent stale overwrites.
			// Note: the `more: true` path (from executeNavigation) returns to the caller
			// which uses the results as local variables, so no guard needed there.
			if (!options?.more && rsp.searchId === this.graphState.currentSearchId) {
				this.graphState.searchResultsResponse = rsp.results;
				if (rsp.selectedRows != null) {
					this.graphState.selectedRows = rsp.selectedRows;
					this.revealFirstSearchMatch(rsp.selectedRows);
				}
			}

			return rsp;
		} catch {
			return undefined;
		}
	}

	private _pendingNavigation: SearchNavigationEventDetail['direction'] | undefined;
	private _isNavigating = false;

	/**
	 * Handles search navigation requests (next/previous/first/last)
	 * Uses a queuing mechanism to batch rapid keyboard navigation
	 */
	private handleSearchNavigation(e: CustomEvent<SearchNavigationEventDetail>) {
		const direction = e.detail?.direction ?? 'next';

		// Store the latest navigation request
		this._pendingNavigation = direction;

		// If already navigating, the pending request will be picked up when current navigation completes
		if (this._isNavigating) return;

		// Start navigation loop
		void this.processNavigation();
	}

	/**
	 * Processes navigation requests in a loop to handle rapid keyboard navigation
	 * Waits 50ms after each navigation to catch keyboard repeat events, allowing users to see each step when holding down a navigation key
	 */
	private async processNavigation() {
		this._isNavigating = true;
		try {
			while (this._pendingNavigation != null) {
				const direction = this._pendingNavigation;
				this._pendingNavigation = undefined;

				// Set navigation direction for UI feedback (bounce animation)
				this.graphState.navigating = direction === 'next' || direction === 'last' ? 'next' : 'previous';

				await this.executeNavigation(direction);

				// Wait 50ms to catch keyboard repeat events (typically 30-50ms between repeats)
				await wait(50);
			}
		} finally {
			this._isNavigating = false;
			this.graphState.navigating = false;
		}
	}

	/**
	 * Executes a single navigation operation to find and select the next/previous/first/last search result
	 * Handles loading rows on demand and skipping filtered-out results
	 */
	private async executeNavigation(direction: SearchNavigationEventDetail['direction']) {
		let { searchResults } = this.graphState;
		if (searchResults == null) return;

		let count = searchResults.count;
		let searchIndex: number;
		let id: string | undefined;
		const next = direction !== 'previous' && direction !== 'first';

		// Determine starting position
		if (direction === 'first') {
			searchIndex = 0;
		} else if (direction === 'last') {
			searchIndex = -1;
		} else {
			({ index: searchIndex, id } = this.getClosestSearchResultIndex(
				searchResults,
				{ ...this._searchQuery },
				next,
			));
		}

		// Track last visible result to maintain stable position during async loading
		const lastVisibleId: string | undefined = this.getActiveRowInfo()?.id;

		// For jump-to-last while search is running, wait for search to complete first
		if (direction === 'last' && this.graphState.searching) {
			await this.waitForSearchComplete();

			// Refresh searchResults after waiting
			searchResults = this.graphState.searchResults;
			if (searchResults == null || isGraphSearchResultsError(searchResults)) return;

			count = searchResults.count;
		}

		// Avoid infinite loops (max 1000 iterations)
		for (let iterations = 0; iterations < 1000; iterations++) {
			// Handle boundary case - need to load more results
			if (searchIndex === -1) {
				if (!this._searchQuery?.query) break;

				// If no more results to load, jump to the last known result
				if (!searchResults.hasMore) {
					searchIndex = count - 1;
					continue;
				}

				let moreResults;
				try {
					// For 'last', load all results at once; otherwise load incrementally
					const limit = direction === 'last' ? 0 : undefined;
					moreResults = await this.onSearchPromise({ ...this._searchQuery }, { limit: limit, more: true });
				} catch {
					break;
				}

				if (
					!moreResults?.results ||
					isGraphSearchResultsError(moreResults.results) ||
					count >= moreResults.results.count
				) {
					break;
				}

				searchResults = moreResults.results;
				count = searchResults.count;
				searchIndex = direction === 'last' ? count - 1 : count - (moreResults.results.count - count);
				continue;
			}

			// Get the ID for the current search index
			id = id ?? getSearchResultIdByIndex(searchResults, searchIndex);

			if (id != null) {
				// Check if row is loaded without modifying selection
				const rows = this.getCommits?.([id]);
				const isHidden = rows?.[0]?.hidden;

				if (isHidden === false) {
					// Row is loaded and visible - select it and done!
					this.selectCommits?.([id], { ensureVisible: true });
					this._searchResultHidden = false;
					break;
				}

				if (isHidden === true) {
					// Row is loaded but hidden from graph - select it anyway and show warning
					this.selectCommits?.([id], { ensureVisible: true });
					this._searchResultHidden = true;
					break;
				}

				// Row not loaded yet - need to load it
				// Re-select last visible to keep position stable during loading
				if (lastVisibleId != null) {
					this.selectCommits?.([lastVisibleId], { ensureVisible: true });
				}

				// Load the row
				const ensuredId = await this.ensureSearchResultRow(id);

				if (ensuredId != null) {
					// Row loaded - select it and check if filtered out
					const rows = this.selectCommits?.([ensuredId], { ensureVisible: true });
					if (rows?.[0]?.hidden) {
						this._searchResultHidden = true;
					} else {
						this._searchResultHidden = false;
					}

					// Done either way
					break;
				}

				// Row couldn't be loaded - re-select last visible and try next
				if (lastVisibleId != null) {
					this.selectCommits?.([lastVisibleId], { ensureVisible: true });
				}

				// Clear id to get next index
				id = undefined;
			}

			// No ID at this index - check if we should load more or stop
			if (id == null) {
				if (next && searchIndex >= count - 1 && this._searchQuery?.query && searchResults.hasMore) {
					// For 'last', we've already loaded all results, so don't trigger another load
					// Instead, fall through to move to previous index
					if (direction !== 'last') {
						// At/past last result - trigger load on next iteration
						searchIndex = -1;
						continue;
					}
				} else if (!next && searchIndex <= 0) {
					// For 'first', we've already at the first result, so don't stop
					// Instead, fall through to move to next index
					if (direction !== 'first') break;
				}
			}

			// Move to next/previous search result
			const prevIndex = searchIndex;
			searchIndex = this.getNextOrPreviousSearchResultIndex(searchIndex, next, searchResults, {
				...this._searchQuery,
			});
			id = undefined;

			// Stop if we didn't move (at boundary with no more results)
			if (searchIndex === prevIndex) break;
		}
	}

	private async onEnsureRowPromise(id: string, select: boolean) {
		try {
			return await this._ipc.sendRequest(EnsureRowRequest, { id: id, select: select });
		} catch {
			return undefined;
		}
	}

	// Cache of ensured rows to avoid redundant IPC calls
	private readonly ensuredIds = new Set<string>();
	private readonly pendingEnsureRequests = new Map<string, Promise<string | undefined>>();

	/**
	 * Ensures a search result row is loaded in the graph.
	 * Returns the ID if successfully loaded, undefined if couldn't be loaded.
	 *
	 * Optimizations:
	 * - Caches results to avoid redundant IPC calls
	 * - Deduplicates concurrent requests for the same row
	 * - Shows loading indicator only if operation takes >250ms
	 * - Waits for row data to be processed before returning (fixes race condition)
	 *
	 * Note: This only ensures the row is loaded. Use selectCommits to check if it's filtered out.
	 *
	 * @returns ID if row was loaded, undefined if couldn't be loaded
	 */
	private async ensureSearchResultRow(id: string): Promise<string | undefined> {
		if (this.ensuredIds.has(id)) return id;

		let promise = this.pendingEnsureRequests.get(id);
		if (promise == null) {
			let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
				timeout = undefined;
				this.graphState.loading = true;
			}, 250);

			const ensureCore = async () => {
				const e = await this.onEnsureRowPromise(id, false);
				if (timeout == null) {
					this.graphState.loading = false;
				} else {
					clearTimeout(timeout);
				}

				if (e?.id === id) {
					// Wait for row data to be loaded
					await this.ensureRowLoadedInGraph(id);

					// Row is loaded - cache it
					this.ensuredIds.add(id);
					return id;
				}

				// Row couldn't be loaded
				return undefined;
			};

			promise = ensureCore();
			void promise.finally(() => this.pendingEnsureRequests.delete(id));

			this.pendingEnsureRequests.set(id, promise);
		}

		return promise;
	}

	/**
	 * Waits for a row to be processed and available in the graph -- to avoid race conditions where we are trying to access the row before it's available.
	 *
	 * Returns as soon as the row is loaded, regardless of whether it's filtered out.
	 * Polls every 50ms using getCommits to check availability without modifying selection.
	 *
	 * @returns Array of ReadonlyGraphRow objects, or undefined on timeout
	 */
	private async ensureRowLoadedInGraph(
		id: string,
		maxWaitMs: number = 1000,
	): Promise<ReadonlyGraphRow[] | undefined> {
		const startTime = performance.now();

		while (performance.now() - startTime < maxWaitMs) {
			const rows = this.getCommits?.([id]);
			if (rows != null && rows.length > 0) {
				// Flush the graph's pending render before returning, so a follow-up visibility read
				// (getCommits/selectCommits → isRowDisplayed) sees the just-paged row, not a stale displayRows.
				await this.ensureGraphRendered?.();
				return rows;
			}

			await wait(50);
		}

		debugger;
		return undefined;
	}

	handleSearchModeChanged(e: CustomEvent) {
		// Update local state immediately for responsive UI
		this.graphState.searchMode = e.detail.searchMode;

		// Update the search query's filter property so it's included in the next search
		this._searchQuery.filter = e.detail.searchMode === 'filter';

		this._ipc.sendCommand(UpdateGraphSearchModeCommand, {
			searchMode: e.detail.searchMode,
			useNaturalLanguage: e.detail.useNaturalLanguage,
		});
	}

	handleMinimapToggled() {
		this.dispatchEvent(new CustomEvent('toggle-minimap', { bubbles: true, composed: true }));
	}

	@debounce(250)
	private onRepositorySelectorClicked(e: CustomEvent<RepoButtonGroupClickEvent>) {
		switch (e.detail.part) {
			case 'label':
				this._ipc.sendCommand(ChooseRepositoryCommand);
				break;

			case 'icon':
				emitTelemetrySentEvent<'graph/action/openRepoOnRemote'>(e.target!, {
					name: 'graph/action/openRepoOnRemote',
					data: {},
				});
				break;
		}
	}

	@query('gl-search-box')
	private readonly searchEl!: GlSearchBox;

	override render() {
		const repo = this.graphState.repositories?.find(repo => repo.id === this.graphState.selectedRepository);

		return cache(
			html`<header class="titlebar graph-app__header">
				<progress-indicator min-visible="300" ?active="${this.graphState.isBusy}"></progress-indicator>
				${this.renderTitlebarHeaderRow(repo)} ${this.renderTitlebarSearchRow(repo)}
			</header>`,
		);
	}

	private renderTitlebarHeaderRow(repo: RepositoryShape | undefined) {
		const hasMultipleRepositories = (this.graphState.repositories?.length ?? 0) > 1;

		const { allowed, branch, branchState, config, lastFetched, loading, state } = this.graphState;

		return html`<div class="titlebar__row titlebar__row--wrap">
			<div class="titlebar__group">
				<gl-repo-button-group
					?disabled=${loading || !hasMultipleRepositories}
					.hasMultipleRepositories=${hasMultipleRepositories}
					.repository=${repo}
					.source=${{ source: 'graph' } as const}
					@gl-click=${this.onRepositorySelectorClicked}
					><span slot="tooltip">
						Switch to Another Repository...
						<hr />
						${repo?.name}
					</span></gl-repo-button-group
				>
				${when(
					allowed && repo,
					() => html`
						<span><code-icon icon="chevron-right"></code-icon></span>${when(
							branchState?.pr,
							pr => html`
								<gl-popover placement="bottom">
									<button slot="anchor" type="button" class="action-button">
										<issue-pull-request
											type="pr"
											identifier=${`#${pr.id}`}
											status=${pr.state}
											compact
										></issue-pull-request>
									</button>
									<div slot="content">
										<issue-pull-request
											type="pr"
											name=${pr.title}
											url=${pr.url}
											identifier=${`#${pr.id}`}
											status=${pr.state}
											.date=${pr.updatedDate}
											.dateFormat=${config?.dateFormat}
											.dateStyle=${config?.dateStyle}
											details
											@gl-issue-pull-request-details=${() => {
												this.onOpenPullRequest(pr);
											}}
										>
										</issue-pull-request>
									</div>
								</gl-popover>
							`,
						)}
						<gl-ref-button
							href=${this._webview.createCommandLink('gitlens.switchToAnotherBranch:')}
							icon
							.ref=${branch}
							?worktree=${branchState?.worktree}
						>
							<div slot="tooltip">
								Switch Branch...
								<hr />
								<gl-branch-name .name=${branch?.name}></gl-branch-name>${branchState?.worktree
									? html`<i> (in a worktree)</i> `
									: ''}
							</div>
						</gl-ref-button>
						<gl-button class="jump-to-ref" appearance="toolbar" @click=${this.handleJumpToRef}>
							<code-icon icon="target"></code-icon>
							<span slot="tooltip">
								${this._modifiers.altKey
									? html`Jump to Reference...`
									: html`Jump to HEAD<br />[${getAltKeySymbol()}] Jump to Reference...`}
							</span>
						</gl-button>
						${this.renderCreateMenu()}
					`,
				)}
			</div>
			<div class="titlebar__group">
				${when(
					allowed && repo,
					() => html`
						<gl-git-actions-buttons
							.branchName=${branch?.name}
							.branchState=${branchState}
							.lastFetched=${lastFetched}
							.workingTreeStats=${this.graphState.workingTreeStats}
							.state=${this.graphState}
						></gl-git-actions-buttons>
					`,
				)}
			</div>
			<div class="titlebar__group">
				${when(
					!(state.mcpBannerCollapsed ?? true),
					() => html`
						<gl-popover class="mcp-tooltip" placement="bottom" trigger="click focus hover">
							<a
								class="action-button action-button--mcp"
								href=${createCommandLink('gitlens.ai.mcp.install', { source: 'graph' })}
								slot="anchor"
							>
								<code-icon class="action-button__icon" icon="mcp"></code-icon>
							</a>
							<div class="mcp-tooltip__content" slot="content">
								<strong>Install GitKraken MCP for GitLens</strong> <br />
								Leverage Git and Integration information from GitLens in AI chat.
								<a href="https://help.gitkraken.com/mcp/mcp-getting-started">Learn more</a>
								${when(
									state.canInstallClaudeHook,
									() => html`
										<br /><br />
										<a href=${createCommandLink('gitlens.agents.installClaudeHook')}
											>Install Claude Code Hooks</a
										>
										to see and manage your parallel agent work from GitLens.
									`,
								)}
							</div>
						</gl-popover>
					`,
				)}
				${when(
					(state.mcpBannerCollapsed ?? true) &&
						(state.canInstallClaudeHook ?? false) &&
						!(state.hooksBannerCollapsed ?? true),
					() => html`
						<gl-popover class="hooks-tooltip" placement="bottom" trigger="click focus hover">
							<button type="button" class="action-button action-button--hooks" slot="anchor">
								<code-icon class="action-button__icon" icon="robot"></code-icon>
							</button>
							<div class="hooks-tooltip__content" slot="content">
								<strong>Install Claude Code Hooks</strong><br />
								Configure Claude to send status updates to GitLens so you can see and manage your
								parallel agent work.
								<br /><br />
								<a href=${createCommandLink('gitlens.agents.installClaudeHook')}>Install</a>
								&middot;
								<a href=${createCommandLink('gitlens.agents.uninstallClaudeHook')}>Uninstall</a>
								&middot;
								<a
									href=${createCommandLink('gitlens.onboarding.dismiss', {
										id: 'hooks:banner',
									})}
									>Dismiss</a
								>
							</div>
						</gl-popover>
					`,
				)}
				${this.renderGraphWalkthroughBanner(state)} ${this.renderStartMenu()}
				<gl-graph-launchpad-indicator></gl-graph-launchpad-indicator>
				${when(
					this.accountBarInline,
					// Last in the RIGHT group on purpose: when the row is also width-constrained, the row's
					// overflow policy (see titlebar__row--wrap in header.css.ts) pushes trailing content past
					// the right edge — the chips clip away first (whole, reappearing when widened) rather
					// than displacing the header's primary controls. Accepted degradation; verified live.
					() => html`<gl-account-chip class="inline-chip" compact></gl-account-chip>
						<gl-integrations-chip class="inline-chip" compact></gl-integrations-chip>`,
				)}
			</div>
		</div>`;
	}

	private renderGraphWalkthroughBanner(state: State) {
		const dismissed = (state.graphWalkthroughBannerCollapsed ?? true) || (state.graphWalkthroughComplete ?? false);

		if (dismissed) {
			return nothing;
		}

		const highlighted = !(state.graphWalkthroughStarted ?? false);

		return html`
			<gl-popover class="graph-walkthrough-tooltip" placement="bottom" trigger="hover focus" ?open=${highlighted}>
				<button
					type="button"
					class="action-button ${highlighted ? 'action-button--graph-walkthrough' : ''}"
					slot="anchor"
					@click=${this.onGraphWalkthroughBannerButtonClick}
				>
					<code-icon class="action-button__icon" icon="megaphone"></code-icon>
				</button>
				<div class="graph-walkthrough-tooltip__content" slot="content">
					<span class="graph-walkthrough-tooltip__title">
						<strong>Try the All-New Commit Graph</strong>
						<span class="preview-badge">PREVIEW</span>
					</span>
					Where your development and agentic workflows come together. Go beyond history visualization to
					manage, execute, and parallelize your entire Git workflow.
					<div class="graph-walkthrough-tooltip__actions">
						<gl-button @click=${this.onGraphWalkthroughBannerButtonClick}>See what's new</gl-button>
						<a href="#" @click=${this.onGraphWalkthroughBannerDismiss}>Dismiss</a>
					</div>
				</div>
			</gl-popover>
		`;
	}

	private renderCreateMenu() {
		// `reference: branch` preserves the prior single-button behavior — create from the branch
		// currently shown in the graph, not a generic picker default.
		const branch = this.graphState.branch;
		return html`<gl-popover
			appearance="menu"
			placement="bottom-start"
			trigger="click focus"
			?arrow=${false}
			.distance=${0}
		>
			<gl-tooltip slot="anchor" placement="bottom">
				<button type="button" class="action-button" aria-haspopup="true" aria-label="Create">
					<code-icon icon="add"></code-icon>
					<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
				</button>
				<span slot="content">Create</span>
			</gl-tooltip>
			<div slot="content">
				<menu-item
					href=${createCommandLink<BranchGitCommandArgs>('gitlens.git.branch', {
						command: 'branch',
						confirm: true,
						state: { subcommand: 'create', reference: branch },
					})}
				>
					<span class="action-menu__item"><code-icon icon="git-branch"></code-icon>Create Branch…</span>
				</menu-item>
				<menu-item href=${createCommandLink('gitlens.views.createWorktree')}>
					<span class="action-menu__item"><code-icon icon="gl-worktree"></code-icon>Create Worktree…</span>
				</menu-item>
				<menu-divider></menu-divider>
				<menu-item
					href=${createCommandLink('gitlens.stashesApply', { repoPath: this.graphState.selectedRepository })}
				>
					<span class="action-menu__item"><code-icon icon="gl-stash-pop"></code-icon>Apply / Pop Stash…</span>
				</menu-item>
			</div>
		</gl-popover>`;
	}

	private renderStartMenu() {
		// Source shapes mirror the WIP details actions (detailsActions.ts): startWork takes a bare
		// `source`, startReview takes a nested `{ source }`.
		// `bottom-end` (vs Create's `bottom-start`) because Start lives in the right-side group near
		// the viewport edge — right-aligning the dropdown keeps it on-screen.
		return html`<gl-popover
			appearance="menu"
			placement="bottom-end"
			trigger="click focus"
			?arrow=${false}
			.distance=${0}
		>
			<gl-tooltip slot="anchor" placement="bottom">
				<button type="button" class="action-button" aria-haspopup="true" aria-label="Start New">
					<code-icon icon="gl-start-new"></code-icon>
					<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
				</button>
				<span slot="content">Start New</span>
			</gl-tooltip>
			<div slot="content">
				<menu-item href=${createCommandLink('gitlens.startWork', { source: 'graph-header' })}>
					<span class="action-menu__item"><code-icon icon="issues"></code-icon>Start Work on an Issue…</span>
				</menu-item>
				<menu-item href=${createCommandLink('gitlens.startReview', { source: { source: 'graph-header' } })}>
					<span class="action-menu__item"
						><code-icon icon="git-pull-request"></code-icon>Start Review on a PR…</span
					>
				</menu-item>
			</div>
		</gl-popover>`;
	}

	private renderHiddenRefs(excludeRefs: GraphExcludeRefs | undefined) {
		if (!hasTruthyKeys(excludeRefs)) return nothing;

		return html`<gl-popover
			class="popover"
			placement="bottom-start"
			trigger="click focus"
			?arrow=${false}
			.distance=${0}
		>
			<gl-tooltip placement="top" slot="anchor">
				<button type="button" id="hiddenRefs" class="action-button">
					<code-icon icon=${`eye-closed`}></code-icon>
					${Object.values(excludeRefs ?? {}).length}
					<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
				</button>
				<span slot="content">Hidden Branches / Tags</span>
			</gl-tooltip>
			<div slot="content">
				<menu-label>Hidden Branches / Tags</menu-label>
				${when(
					this.excludeRefs.length > 0,
					() => html`
						${repeat(
							this.excludeRefs,
							ref => html`
								<menu-item
									@click=${(event: CustomEvent) => {
										this.handleOnToggleRefsVisibilityClick(event, [ref], true);
									}}
									class="flex-gap"
								>
									${this.renderRemoteAvatarOrIcon(ref)}
									<span>${ref.name}</span>
								</menu-item>
							`,
						)}
						<menu-item
							@click=${(event: CustomEvent) => {
								this.handleOnToggleRefsVisibilityClick(event, this.excludeRefs, true);
							}}
						>
							Show All
						</menu-item>
					`,
				)}
			</div>
		</gl-popover>`;
	}

	private renderTitlebarSearchRow(repo: RepositoryShape | undefined) {
		if (!this.graphState.allowed) return nothing;

		const {
			config,
			excludeRefs,
			searching,
			searchMode,
			searchResults,
			searchResultsError,
			useNaturalLanguageSearch,
		} = this.graphState;

		const scoped = getDisplayedMode(this.graphState) === 'scoped';
		const filtered = isGraphFiltered(this.graphState);
		const rowClass = scoped ? 'titlebar__row--scoped' : filtered ? 'titlebar__row--filtered' : '';

		// Search applies to the graph rows; any alternate display mode (visualizations, kanban)
		// hides the graph body and shouldn't accept search input — typing would silently scroll
		// a graph the user can't see and Prev/Next on results would jump the invisible viewport.
		// Use the EFFECTIVE mode so a persisted `'kanban'` state that's been gated off (experimental
		// flag toggled off after the user entered kanban) reads as `'graph'` here and the search
		// box re-enables for the now-visible graph body.
		const displayMode = getEffectiveDisplayMode(this.graphState);
		const isAlternateMode = displayMode !== 'graph';
		return html`
			<div class="titlebar__row titlebar__row--search ${rowClass}">
				<div class="titlebar__group">
					<gl-graph-scope-popover .repo=${repo}></gl-graph-scope-popover> ${this.renderHiddenRefs(
						excludeRefs,
					)}
					<gl-search-box
						class=${isAlternateMode ? 'search-box--disabled' : ''}
						?inert=${isAlternateMode}
						aria-disabled=${isAlternateMode ? 'true' : 'false'}
						?aiAllowed=${this.aiAllowed}
						errorMessage=${searchResultsError?.error ?? ''}
						?filter=${searchMode === 'filter'}
						?naturalLanguage=${Boolean(useNaturalLanguageSearch)}
						.navigating=${this.graphState.navigating}
						?resultsHasMore=${searchResults?.hasMore ?? false}
						?resultHidden=${this._searchResultHidden}
						?resultsLoaded=${searchResults != null}
						?searching=${searching}
						?showAutocompleteOnFocus=${this.graphState.config?.searchAutocompleteOnFocus ?? true}
						step=${this.searchPosition}
						total=${searchResults?.count ?? 0}
						?valid=${this.searchValid}
						value=${this._searchQuery.query ?? ''}
						@gl-search-cancel=${this.handleSearchCancel}
						@gl-search-inputchange=${this.handleSearchInput}
						@gl-search-modechange=${this.handleSearchModeChanged}
						@gl-search-navigate=${this.handleSearchNavigation}
						@gl-search-openinview=${this.onSearchOpenInView}
						@gl-search-pause=${this.handleSearchPause}
						@gl-search-resume=${this.handleSearchResume}
					></gl-search-box>
					${when(
						searchResults != null || searching,
						() => html`
							<span>
								<span class="action-divider"></span>
							</span>
						`,
					)}
					<span class="button-group">
						${when(
							config?.sidebar,
							() => html`
								<gl-button
									appearance="toolbar"
									tooltip=${(this.graphState.sidebar?.visible ?? false) &&
									this.graphState.sidebar?.activePanel != null
										? 'Hide Side Bar'
										: 'Show Side Bar'}
									aria-label=${(this.graphState.sidebar?.visible ?? false) &&
									this.graphState.sidebar?.activePanel != null
										? 'Hide Side Bar'
										: 'Show Side Bar'}
									@click=${this.handleSidebarToggled}
								>
									<code-icon
										icon=${(this.graphState.sidebar?.visible ?? false) &&
										this.graphState.sidebar?.activePanel != null
											? 'layout-sidebar-left'
											: 'layout-sidebar-left-off'}
									></code-icon>
								</gl-button>
							`,
						)}
						<gl-button
							appearance="toolbar"
							tooltip=${config?.minimap && this.minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
							aria-label=${config?.minimap && this.minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
							@click=${() => this.handleMinimapToggled()}
						>
							<code-icon
								class="minimap-toggle-icon"
								icon=${config?.minimap && this.minimapVisible ? 'layout-panel' : 'layout-panel-off'}
							></code-icon>
						</gl-button>
						${(() => {
							// Source the side from the resolved effective location (handles `auto`); Alt+Click
							// pins to the opposite side, so the alt preview/label use that opposite.
							const currentLocation = this.detailsEffectiveLocation;
							const altLocation = currentLocation === 'bottom' ? 'right' : 'bottom';
							const previewLocation = this._modifiers.altKey ? altLocation : currentLocation;
							const isBottom = previewLocation === 'bottom';
							const baseLabel = this.detailsVisible ? 'Hide Details Panel' : 'Show Details Panel';
							const altLabel = `Show Details Panel on ${altLocation === 'bottom' ? 'Bottom' : 'Right'}`;
							const tooltip = this._modifiers.altKey
								? altLabel
								: `${baseLabel}\n[${getAltKeySymbol()}] ${altLabel}`;
							return html`<gl-button
								appearance="toolbar"
								tooltip=${tooltip}
								aria-label=${baseLabel}
								@click=${this.handleToggleDetails}
							>
								<code-icon
									icon=${isBottom
										? this.detailsVisible || this._modifiers.altKey
											? 'layout-panel'
											: 'layout-panel-off'
										: this.detailsVisible || this._modifiers.altKey
											? 'layout-sidebar-right'
											: 'layout-sidebar-right-off'}
								></code-icon>
							</gl-button>`;
						})()}
					</span>
				</div>
			</div>
		`;
	}

	private renderRemoteAvatarOrIcon(refOptData: GraphRefOptData) {
		if (refOptData.avatarUrl) {
			return html`<img class="branch-menu__avatar" alt=${refOptData.name} src=${refOptData.avatarUrl} />`;
		}
		return html`<code-icon class="branch-menu__icon" icon=${getRemoteIcon(refOptData.type)}></code-icon>`;
	}
}

export function compareGraphRefOpts(a: GraphRefOptData, b: GraphRefOptData): number {
	const comparationResult = a.name.localeCompare(b.name);
	if (comparationResult === 0) {
		// If names are equals
		if (a.type === 'remote') {
			return -1;
		}
	}
	return comparationResult;
}
