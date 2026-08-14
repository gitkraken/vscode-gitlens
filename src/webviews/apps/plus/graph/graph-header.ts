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
import { getPullRequestNumberFromUrl } from '@gitlens/git/utils/pullRequest.utils.js';
import { parseSearchQuery } from '@gitlens/git/utils/search.utils.js';
import { debounce } from '@gitlens/utils/decorators/debounce.js';
import { hasTruthyKeys } from '@gitlens/utils/object.js';
import { wait } from '@gitlens/utils/promise.js';
import type { BranchGitCommandArgs } from '../../../../commands/git/branch.js';
import type { RepositoryShape } from '../../../../git/models/repositoryShape.js';
import { createCommandLink } from '../../../../system/commands.js';
import type {
	GraphColumnName,
	GraphExcludedRef,
	GraphExcludeRefs,
	GraphRefOptData,
	GraphSearchResults,
	GraphSelectedRows,
	GraphWipState,
	State,
} from '../../../plus/graph/protocol.js';
import {
	ChooseRepositoryCommand,
	createWipRowId,
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
import { providerIconName } from '../../shared/git-utils.js';
import { emitTelemetrySentEvent } from '../../shared/telemetry.js';
import { ruleStyles } from '../shared/components/vscode.css.js';
import { getDisplayedMode, isGraphFiltered } from './components/gl-graph-scope-popover.js';
import type { GlGraphScopePopover } from './components/gl-graph-scope-popover.js';
import { graphStateContext } from './context.js';
import { getEffectiveDisplayMode } from './displayMode.js';
import type { GraphNavigationOptions, GraphNavigationResult } from './graph-wrapper/graph-wrapper.js';
import { compareGraphRefOpts, getHiddenRefLabel } from './hiddenRefs.utils.js';
import { sidebarActionsContext } from './sidebar/sidebarContext.js';
import type { SidebarActions } from './sidebar/sidebarState.js';
import { isGraphSearchResultsError, shouldRestoreSearchQuery } from './stateProvider.js';
import { actionButton, linkBase } from './styles/graph.css.js';
import { graphHeaderControlStyles, titlebarStyles } from './styles/header.css.js';
import { getSelectedRepoPath } from './utils/repository.utils.js';
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
import '../../shared/components/actions/action-nav.js';
import '../../shared/components/rich/issue-pull-request.js';
import '../../shared/components/search/search-box.js';
import './actions/gitActionsButtons.js';
import './components/gl-graph-launchpad-indicator.js';
import './components/gl-graph-account-indicator.js';
import './components/gl-graph-header-promo.js';

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

			/* Search is meaningless in Timeline mode — visually dim it and let inert block focus
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

	// The wrapper-owned load/select/reveal boundary, passed from graph-app. It resolves only after the
	// selected row's rendered visibility is current, so search never needs to poll graph state.
	navigateToCommit?: (sha: string, options?: GraphNavigationOptions) => Promise<GraphNavigationResult>;

	@property({ type: Boolean, attribute: 'details-visible' })
	detailsVisible = false;

	/** The resolved details side (`right`/`bottom`) from `GraphApp.effectiveDetailsLocation` — already
	 *  accounts for `auto` width resolution, so the toggle reflects where the panel actually is. */
	@property({ attribute: 'details-effective-location' })
	detailsEffectiveLocation: 'right' | 'bottom' = 'right';

	@property({ type: Boolean, attribute: 'minimap-visible' })
	minimapVisible = false;

	@property({ type: Boolean, attribute: 'has-selected-commit' })
	hasSelectedCommit = false;

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

	/** Whether the live scope is focused on the current branch — the state that makes a plain
	 *  jump-to-ref click unfocus rather than focus. Identity by `branchRef`, the one scope field the
	 *  anchor resolver never rewrites (it backfills the merge base and tip SHAs). Detached HEAD never
	 *  matches: `setScope` rejects detached scopes, so there's nothing to unfocus. An unknown branch id
	 *  reads as "not focused" so the click focuses rather than matching on `undefined`. */
	private get isScopedToCurrentBranch(): boolean {
		const { scope, branch } = this.graphState;
		if (scope == null || branch == null || branch.detached || branch.id == null) return false;

		return scope.branchRef === branch.id;
	}

	// Local search query state (not in global context)
	private _searchQuery: SearchQuery = { query: '' };

	@state()
	private _searchResultHidden = false;

	private _lastNavigationRepoPath: string | undefined;

	override updated(changedProperties: PropertyValues): void {
		this.aiAllowed = (this.graphState.config?.aiEnabled ?? true) && (this.graphState.orgSettings?.ai ?? true);

		const currentRepoPath = this.graphState.selectedRepository;
		if (this._lastNavigationRepoPath !== currentRepoPath) {
			this._lastNavigationRepoPath = currentRepoPath;
			this._pendingNavigation = undefined;
			this.cancelActiveSearchNavigation();
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
			this._pendingNavigation = undefined;
			this.cancelActiveSearchNavigation();
			this._searchQuery = restored;
			this.searchEl?.setExternalSearchQuery(restored);
			this.updateActiveFilterColumns();
		}

		super.updated(changedProperties);
	}

	override disconnectedCallback(): void {
		this.cancelActiveSearchNavigation();
		super.disconnectedCallback?.();
	}

	setExternalSearchQuery(query: SearchQuery) {
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
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
	 * currently present into graph state, which drives each column's filter affordance.
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

	private handleJumpToRef(e: MouseEvent) {
		// Alt: open the scope menu into the Focus Branch pane so the user can pick a branch to focus.
		if (e.altKey) {
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: true } });
			void this.scopePopoverEl?.openToFocusBranch();
			return;
		}

		// Plain: toggle the graph's focus (scope) on the current branch. Unfocus only when the live scope
		// IS the current branch — the button names the current branch, so a scope on any other branch
		// retargets to it instead of clearing. `clearScope` reports the unfocus itself
		// (`graph/scope/cleared`), so `jumpTo` stays reserved for clicks that focus. Only record the
		// action when it actually proceeds — a no-op click (e.g. detached HEAD, no current branch)
		// shouldn't count.
		if (this.isScopedToCurrentBranch) {
			this.graphState.clearScope();
			return;
		}

		if (this.scopeToCurrentBranch()) {
			this._telemetry.sendEvent({ name: 'graph/action/jumpTo', data: { alt: false } });
		}
	}

	private scopeToCurrentBranch(): boolean {
		const branch = this.graphState.branch;
		// Detached HEAD has no branch to focus: scoping on the synthesized `(sha…)` name builds a
		// `branchRef` matching no row and no branch id, so the view doesn't visibly scope AND the primary
		// WIP row goes away (`shouldShowPrimaryWipRow`). No-op, so the caller skips telemetry too.
		// The host's flag, not a name test — `(release)` is a legal branch name.
		if (branch == null || branch.detached) return false;

		this.dispatchEvent(
			new CustomEvent('gl-graph-scope-to-branch', {
				detail: {
					branchName: branch.name,
					upstreamName: branch.upstream?.missing ? undefined : branch.upstream?.name,
				},
				bubbles: true,
				composed: true,
			}),
		);
		return true;
	}

	private onOpenPullRequest(pr: NonNullable<NonNullable<State['branchState']>['pr']>): void {
		this.dispatchEvent(
			new CustomEvent('gl-graph-show-pr-sheet', {
				detail: { number: getPullRequestNumberFromUrl(pr.url) ?? pr.id, url: pr.url },
				bubbles: true,
				composed: true,
			}),
		);
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

	/** The graph's own worktree's entry in the row-keyed hot WIP plane — what the header's WIP badge
	 *  and jump-to-WIP affordance render from. */
	private get primaryWipState(): GraphWipState | undefined {
		const repoPath = getSelectedRepoPath(this.graphState);
		return repoPath != null ? this.graphState.wipStateById?.[createWipRowId(repoPath)] : undefined;
	}

	get searchValid() {
		return (this._searchQuery.query?.length ?? 0) > 2;
	}

	private cancelSearch(preserveResults: boolean) {
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
		// Don't eagerly clear local state — the host sends a clear notification as part of
		// processing the cancel (or starting a new search). Eagerly clearing causes a flash
		// where old results/errors disappear briefly before the new state arrives.
		this._ipc.sendCommand(SearchCancelCommand, { preserveResults: preserveResults });
	}

	private async waitForSearchComplete(
		timeoutMs: number = 30000,
		shouldContinue: () => boolean = () => true,
	): Promise<void> {
		if (!this.graphState.searching) return;

		const deadline = performance.now() + timeoutMs;
		while (this.graphState.searching && shouldContinue() && performance.now() < deadline) {
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
			void this.navigateToSearchResult(firstSha);
		}
	}

	private async startSearch() {
		if (!this.searchValid) {
			this.cancelSearch(false);
			return;
		}

		// Raise `searching` here rather than waiting for the host's first notification — that round-trip
		// is a visible delay for anything keyed off it (the search spinner, and the minimap's auto-show,
		// which is supposed to be up before results start streaming in). Every exit path below, plus the
		// notification reducer, drives it back down.
		this.graphState.searching = true;
		// A new search session starts here, not when the host answers — see `searchSession`. Resume and
		// result-navigation issue their own `SearchRequest`s without coming through here, so they
		// correctly leave the session (and any per-search UI state scoped to it) alone.
		this.graphState.searchSession++;

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
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
		// Cancel any existing search before starting a new one
		if (this.graphState.searching) {
			this.cancelSearch(false);
		}

		this._searchQuery = e.detail;
		this.updateActiveFilterColumns();
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

	/** Load-more for search navigation — the caller reads the results as locals, so nothing lands in state. */
	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			return await this._ipc.sendRequest(SearchRequest, {
				search: search,
				limit: options?.limit,
				more: options?.more,
			});
		} catch {
			return undefined;
		}
	}

	private _pendingNavigation: SearchNavigationEventDetail['direction'] | undefined;
	private _isNavigating = false;
	private _activeNavigationAbort?: AbortController;
	private _searchNavigationGeneration = 0;

	private cancelActiveSearchNavigation(): void {
		this._searchNavigationGeneration++;
		this._activeNavigationAbort?.abort();
		this._activeNavigationAbort = undefined;
	}

	private async navigateToSearchResult(id: string): Promise<GraphNavigationResult | undefined> {
		this._activeNavigationAbort?.abort();
		const abort = new AbortController();
		this._activeNavigationAbort = abort;
		try {
			return await this.navigateToCommit?.(id, {
				source: 'search',
				// Search can legitimately contain a WIP row excluded by the active view. Unlike a
				// scope/overview jump, it must skip that result rather than wait for a synthesis that
				// cannot occur until the user changes the view.
				deferSynthetic: false,
				signal: abort.signal,
				// A landing: stepping results is driven from the search box in the header, so each hit needs
				// to announce where it put you rather than rely on you having watched the rows.
				flash: true,
				// This call already has its own hidden-result affordance — a generic toast on top would
				// double-report the same miss.
				feedback: false,
			});
		} finally {
			if (this._activeNavigationAbort === abort) {
				this._activeNavigationAbort = undefined;
			}
		}
	}

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

		const repoPath = this.graphState.selectedRepository;
		const searchQuery = this._searchQuery;
		const navigationGeneration = this._searchNavigationGeneration;
		const isCurrent = (): boolean =>
			this.graphState.selectedRepository === repoPath &&
			this._searchQuery === searchQuery &&
			this._searchNavigationGeneration === navigationGeneration;
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
			({ index: searchIndex, id } = this.getClosestSearchResultIndex(searchResults, { ...searchQuery }, next));
		}

		// For jump-to-last while search is running, wait for search to complete first
		if (direction === 'last' && this.graphState.searching) {
			await this.waitForSearchComplete(30000, isCurrent);
			if (!isCurrent()) return;

			// Refresh searchResults after waiting
			searchResults = this.graphState.searchResults;
			if (searchResults == null || isGraphSearchResultsError(searchResults)) return;

			count = searchResults.count;
		}

		// Avoid infinite loops (max 1000 iterations)
		for (let iterations = 0; iterations < 1000; iterations++) {
			// Handle boundary case - need to load more results
			if (searchIndex === -1) {
				if (!searchQuery.query) break;

				// If no more results to load, jump to the last known result
				if (!searchResults.hasMore) {
					searchIndex = count - 1;
					continue;
				}

				let moreResults;
				try {
					// For 'last', load all results at once; otherwise load incrementally
					const limit = direction === 'last' ? 0 : undefined;
					moreResults = await this.onSearchPromise({ ...searchQuery }, { limit: limit, more: true });
				} catch {
					break;
				}
				if (!isCurrent()) return;

				if (
					!moreResults?.results ||
					isGraphSearchResultsError(moreResults.results) ||
					count >= moreResults.results.count
				) {
					break;
				}

				const priorCount = count;
				searchResults = moreResults.results;
				count = searchResults.count;
				searchIndex = direction === 'last' ? count - 1 : priorCount;
				continue;
			}

			// Get the ID for the current search index
			id = id ?? getSearchResultIdByIndex(searchResults, searchIndex);

			if (id != null) {
				// One wrapper-owned operation handles both the already-loaded and targeted-load paths,
				// including latest-intent cancellation and waiting for the rendered visibility result.
				const result = await this.navigateToSearchResult(id);
				if (!isCurrent()) return;

				if (result?.status === 'selected') {
					this._searchResultHidden = result.row.hidden === true;
					break;
				}
				// A click, repo switch, or newer navigation superseded this request. Stop instead of
				// continuing the search loop and overwriting that newer user intent.
				if (result?.status === 'cancelled') return;

				// Clear id to get next index
				id = undefined;
			}

			// No ID at this index - check if we should load more or stop
			if (id == null) {
				if (next && searchIndex >= count - 1 && searchQuery.query && searchResults.hasMore) {
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
				...searchQuery,
			});
			id = undefined;

			// Stop if we didn't move (at boundary with no more results)
			if (searchIndex === prevIndex) break;
		}
	}

	handleSearchModeChanged(e: CustomEvent) {
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
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

	focusSearch(): boolean {
		const searchEl = this.searchEl;
		if (searchEl == null || searchEl.inert) return false;

		searchEl.focus();
		return true;
	}

	@query('gl-graph-scope-popover')
	private readonly scopePopoverEl!: GlGraphScopePopover | null;

	override render() {
		const repo = this.graphState.repositories?.find(repo => repo.id === this.graphState.selectedRepository);

		return cache(
			html`<header class="titlebar graph-app__header">
				<progress-indicator min-visible="300" ?active="${this.graphState.isBusy}"></progress-indicator>
				<div class="titlebar__row titlebar__row--promo">
					<gl-graph-header-promo></gl-graph-header-promo>
				</div>
				${this.renderTitlebarHeaderRow(repo)} ${this.renderTitlebarSearchRow(repo)}
			</header>`,
		);
	}

	private renderTitlebarHeaderRow(repo: RepositoryShape | undefined) {
		const hasMultipleRepositories = (this.graphState.repositories?.length ?? 0) > 1;

		const { allowed, branch, branchState, config, lastFetched, loading } = this.graphState;
		// Names what a plain jump-to-ref click will do, so the label can't drift from the behavior.
		const focusLabel = this.isScopedToCurrentBranch ? 'Unfocus Current Branch' : 'Focus on Current Branch';

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
						<span><code-icon icon="chevron-right"></code-icon></span>${when(branchState?.pr, pr => {
							const prNumber = getPullRequestNumberFromUrl(pr.url) ?? pr.id;
							return html`
								<gl-popover placement="bottom">
									<button
										slot="anchor"
										type="button"
										class="action-button"
										@click=${() => this.onOpenPullRequest(pr)}
									>
										<issue-pull-request
											type="pr"
											identifier=${`#${prNumber}`}
											status=${pr.state}
											.stack=${pr.stack}
											compact
										></issue-pull-request>
									</button>
									<div slot="content">
										<issue-pull-request
											type="pr"
											name=${pr.title}
											url=${pr.url}
											identifier=${`#${prNumber}`}
											status=${pr.state}
											.stack=${pr.stack}
											.author=${pr.author?.name}
											date-label="updated"
											.date=${pr.updatedDate}
											.dateFormat=${config?.dateFormat}
											.dateStyle=${config?.dateStyle}
										>
										</issue-pull-request>
									</div>
								</gl-popover>
							`;
						})}
						<gl-ref-button
							href=${this._webview.createCommandLink('gitlens.switchToAnotherBranch:')}
							icon
							.ref=${branch}
							?worktree=${branchState?.worktree}
						>
							<div slot="tooltip">
								Switch Branch...
								<hr />
								<gl-branch-name .name=${branch?.name}></gl-branch-name>${
									branchState?.worktree ? html`<i> (in a worktree)</i> ` : ''
								}
							</div>
						</gl-ref-button>
						<gl-button
							class="jump-to-ref"
							appearance="toolbar"
							aria-label=${focusLabel}
							@click=${this.handleJumpToRef}
						>
							<code-icon icon="target"></code-icon>
							<span slot="tooltip">
								${
									this._modifiers.altKey
										? html`Focus on a Branch...`
										: html`${focusLabel}<br />[${getAltKeySymbol()}] Focus on a Branch...`
								}
							</span>
						</gl-button>
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
							.wipState=${this.primaryWipState}
							.state=${this.graphState}
						></gl-git-actions-buttons>
					`,
				)}
			</div>
			<div class="titlebar__group">
				${this.renderStartMenu()}
				<gl-graph-launchpad-indicator></gl-graph-launchpad-indicator>
				<gl-graph-account-indicator></gl-graph-account-indicator>
			</div>
		</div>`;
	}

	private renderStartMenu() {
		// Source shapes mirror the WIP details actions (detailsActions.ts): startWork takes a bare
		// `source`, startReview takes a nested `{ source }`.
		// `bottom-end` (vs Create's `bottom-start`) because Start lives in the right-side group near
		// the viewport edge — right-aligning the dropdown keeps it on-screen.
		// `reference: branch` preserves the prior single-button behavior — create from the branch
		// currently shown in the graph, not a generic picker default.
		const branch = this.graphState.branch;
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
				<menu-divider></menu-divider>
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

	private renderHiddenRefs(excludeRefs: GraphExcludeRefs | undefined) {
		if (!hasTruthyKeys(excludeRefs)) return nothing;

		const refs = this.excludeRefs;
		const countLabel = `${refs.length} hidden ${refs.length === 1 ? 'branch or tag' : 'branches and tags'}`;

		return html`<gl-popover
			appearance="menu"
			placement="bottom-start"
			trigger="click focus"
			?arrow=${false}
			.distance=${0}
		>
			<gl-tooltip placement="top" slot="anchor">
				<button type="button" class="action-button" aria-haspopup="true" aria-label=${countLabel}>
					<code-icon icon="eye-closed"></code-icon>
					${refs.length}
					<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
				</button>
				<span slot="content">${countLabel}</span>
			</gl-tooltip>
			<div slot="content">
				<menu-label>Hidden Branches / Tags</menu-label>
				${repeat(
					refs,
					ref => ref.id,
					ref => this.renderHiddenRef(ref),
				)}
				<menu-divider></menu-divider>
				<menu-item
					@click=${(event: CustomEvent) => {
						this.handleOnToggleRefsVisibilityClick(event, refs, true);
					}}
				>
					Show All
				</menu-item>
			</div>
		</gl-popover>`;
	}

	private renderHiddenRef(ref: GraphRefOptData) {
		const { owner, name, suffix } = getHiddenRefLabel(ref);

		return html`<menu-item
			class="hidden-ref"
			@click=${(event: CustomEvent) => {
				this.handleOnToggleRefsVisibilityClick(event, [ref], true);
			}}
		>
			${this.renderHiddenRefIcon(ref)}
			<span class="hidden-ref__label"
				>${owner ? html`<span class="hidden-ref__owner">${owner}</span>` : nothing}${name}${
					suffix ? html` <span class="hidden-ref__suffix">· ${suffix}</span>` : nothing
				}</span
			>
			<code-icon class="hidden-ref__show" icon="eye" aria-hidden="true"></code-icon>
		</menu-item>`;
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
					<gl-graph-scope-popover .repo=${repo}></gl-graph-scope-popover>
					${this.renderHiddenRefs(excludeRefs)}
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
					<action-nav class="button-group" role="toolbar" aria-label="Graph layout">
						${when(
							config?.sidebar,
							() => html`
								<gl-button
									appearance="toolbar"
									tooltip=${
										(this.graphState.sidebar?.visible ?? false) &&
										this.graphState.sidebar?.activePanel != null
											? 'Hide Side Bar'
											: 'Show Side Bar'
									}
									aria-label=${
										(this.graphState.sidebar?.visible ?? false) &&
										this.graphState.sidebar?.activePanel != null
											? 'Hide Side Bar'
											: 'Show Side Bar'
									}
									@click=${this.handleSidebarToggled}
								>
									<code-icon
										icon=${
											(this.graphState.sidebar?.visible ?? false) &&
											this.graphState.sidebar?.activePanel != null
												? 'layout-sidebar-left'
												: 'layout-sidebar-left-off'
										}
									></code-icon>
								</gl-button>
							`,
						)}
						${when(
							config?.minimap ?? true,
							() => html`
								<gl-button
									appearance="toolbar"
									tooltip=${this.minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
									aria-label=${this.minimapVisible ? 'Hide Minimap' : 'Show Minimap'}
									@click=${() => this.handleMinimapToggled()}
								>
									<code-icon
										class="minimap-toggle-icon"
										icon=${this.minimapVisible ? 'layout-panel' : 'layout-panel-off'}
									></code-icon>
								</gl-button>
							`,
						)}
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
									icon=${
										isBottom
											? this.detailsVisible || this._modifiers.altKey
												? 'layout-panel'
												: 'layout-panel-off'
											: this.detailsVisible || this._modifiers.altKey
												? 'layout-sidebar-right'
												: 'layout-sidebar-right-off'
									}
								></code-icon>
							</gl-button>`;
						})()}
					</action-nav>
				</div>
			</div>
		`;
	}

	/** The leading glyph on a hidden-ref row. Decorative: the row's own text names the ref, so an alt/label
	 *  here would only announce it twice (and a remote-wide hide's raw name is a bare `*`). A remote entry
	 *  takes its provider's font glyph — same rendering as the side bar's remotes panel, never an avatar
	 *  image (a fixed-color raster neither matches the theme nor scales at glyph size). */
	private renderHiddenRefIcon(refOptData: GraphRefOptData) {
		const icon =
			refOptData.type === 'remote' ? providerIconName(refOptData.providerIcon) : getRemoteIcon(refOptData.type);
		return html`<code-icon class="hidden-ref__icon" icon=${icon}></code-icon>`;
	}
}
