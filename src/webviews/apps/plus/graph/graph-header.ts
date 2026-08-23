import { computed, SignalWatcher } from '@lit-labs/signals';
import { consume } from '@lit/context';
import type { PropertyValues } from 'lit';
import { css, html, LitElement, nothing, svg } from 'lit';
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
	GraphWipState,
	State,
} from '../../../plus/graph/protocol.js';
import { createWipRowId } from '../../../plus/graph/protocol.js';
import { notifyService } from '../../shared/actions/rpc.js';
import type { GlPopover } from '../../shared/components/overlays/popover.js';
import type { RepoButtonGroupClickEvent } from '../../shared/components/repo-button-group.js';
import type { GlSearchBox } from '../../shared/components/search/search-box.js';
import type {
	SearchModeChangeEventDetail,
	SearchNavigationEventDetail,
} from '../../shared/components/search/search-input.js';
import { inlineCode } from '../../shared/components/styles/lit/base.css.js';
import type { SubscriptionContextState } from '../../shared/contexts/subscription.js';
import { subscriptionContext } from '../../shared/contexts/subscription.js';
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
import { graphServicesContext, graphStateContext } from './context.js';
import { getEffectiveDisplayMode } from './displayMode.js';
import type { GraphNavigationOptions, GraphNavigationResult } from './graph-wrapper/graph-wrapper.js';
import { compareGraphRefOpts, getHiddenRefLabel } from './hiddenRefs.utils.js';
import type { SearchActions } from './search/searchActions.js';
import { searchActionsContext } from './search/searchContext.js';
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

	@consume({ context: telemetryContext as { __context__: TelemetryContext } })
	private _telemetry!: TelemetryContext;

	@consume({ context: graphServicesContext, subscribe: true })
	private _services?: typeof graphServicesContext.__context__;

	@consume({ context: graphStateContext, subscribe: true })
	private graphState!: typeof graphStateContext.__context__;

	@consume({ context: subscriptionContext, subscribe: true })
	private _subscription!: SubscriptionContextState;

	@consume({ context: sidebarActionsContext, subscribe: true })
	private _sidebarActions?: SidebarActions;

	@consume({ context: searchActionsContext, subscribe: true })
	private _searchActions!: SearchActions;

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

	/** The configured details location (raw setting; `auto` also when unset). */
	@property({ attribute: 'details-location' })
	detailsLocation: 'auto' | 'right' | 'bottom' = 'auto';

	/** The width-driven side `auto` would pick right now — independent of any explicit pin, so the
	 *  popover's Auto option previews what choosing it would do. */
	@property({ attribute: 'details-auto-location' })
	detailsAutoLocation: 'right' | 'bottom' = 'right';

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
	/** The user's own filter-toggle state from before an NL search forced filter mode, so clearing that
	 *  search restores it — an explicit toggle click clears this (the user's choice supersedes it). */
	private _nlForcedFilterRestore: boolean | undefined;
	/** A full search cancel has been sent but the host's clearing notification hasn't landed yet. In that
	 *  window the box is empty while `graphState.searchQuery`/results still hold the old search — the
	 *  exact signature the reboot-restore effect in `updated()` looks for, so it must stand down or it
	 *  restores the search the user just cleared. Cleared once the state reflects the cancel. */
	private _searchCancelInFlight = false;

	@state()
	private _searchResultHidden = false;

	private _lastNavigationRepoPath: string | undefined;

	override updated(changedProperties: PropertyValues): void {
		this.aiAllowed = (this.graphState.config?.aiEnabled ?? true) && this._subscription.orgSettings.get().ai;

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
		if (this._searchCancelInFlight && this.graphState.searchQuery == null) {
			this._searchCancelInFlight = false;
		}

		if (
			!this._searchCancelInFlight &&
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
		this._nlForcedFilterRestore = undefined;
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
		this._searchActions.openInView({ ...this._searchQuery });
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

	/** Shared tail of the NL-forced-filter restore: applies `restore` to the search mode and the search
	 *  box's filter toggle, and clears the forced-filter bookkeeping. Takes the value as a parameter —
	 *  never reads `this._nlForcedFilterRestore` — so each call site controls its own `_searchQuery`
	 *  write (in-place mutation vs. wholesale rebuild) around the call. */
	private applyNlForcedFilterRestore(restore: boolean): void {
		this.graphState.searchMode = restore ? 'filter' : 'normal';
		this.searchEl?.setExternalFilter(restore);
		this._nlForcedFilterRestore = undefined;
	}

	private cancelSearch(preserveResults: boolean) {
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
		if (!preserveResults) {
			this._searchCancelInFlight = true;
		}

		// An NL-forced filter mode ends with its search — restore the user's own toggle state, and ONLY
		// the toggle. This runs synchronously inside the box's own clear sequence (the box emits
		// `gl-search-cancel`, then re-reads its props to emit the empty change) — funneling the full
		// query through `setExternalSearchQuery` here resurrected the just-cleared text into the box,
		// and the trailing change emission then re-ran it as a live search.
		if (!preserveResults && this._nlForcedFilterRestore != null) {
			const restore = this._nlForcedFilterRestore;
			this._searchQuery.filter = restore;
			this.applyNlForcedFilterRestore(restore);
		}
		// Don't eagerly clear local state — the host's cleared snapshot (or the next search's) lands via
		// `onDidChange`. Eagerly clearing causes a flash where old results/errors disappear briefly before
		// the new state arrives.
		if (preserveResults) {
			this._searchActions.cancel();
			// The host answers an aborted search with nothing — right for a supersede, where the newer
			// search's snapshots own the state, but a pause has no successor: nothing else will ever drop
			// `searching` (the spinner, the header progress bar, and the graph's search-active styling all
			// key off it) or surface the resume affordance. Settle both here; the host's own settled state
			// (paused cursor included) already agrees — it just never emits for an abort.
			this.graphState.searching = false;
			const currentResults = this.graphState.searchResultsResponse;
			if (currentResults != null && !isGraphSearchResultsError(currentResults)) {
				this.graphState.searchResultsResponse = { ...currentResults, hasMore: true };
			}
		} else {
			this._searchActions.clear();
		}
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
	private revealFirstSearchMatch(revealSha: string | undefined): void {
		if (revealSha != null) {
			void this.navigateToSearchResult(revealSha);
		}
	}

	private async startSearch() {
		// A freshly-initiated search supersedes any stale cancel bookkeeping — otherwise a clear
		// immediately followed by a new search can skip the null transition `updated()` watches for
		// (Lit batches; save-last RPC replay collapses), leaving the flag stuck and suppressing the
		// reconnect box-restore.
		this._searchCancelInFlight = false;

		if (!this.searchValid) {
			this.cancelSearch(false);
			return;
		}

		// Captured BEFORE the request: the response's forced-filter detection must compare against the
		// toggle state the user submitted with — by response time `_searchQuery.filter` may already have
		// been rewritten by notification-driven syncs.
		const preSearchFilter = this._searchQuery.filter ?? false;

		// Raise `searching` here rather than waiting for the host's first snapshot — that round-trip is a
		// visible delay for anything keyed off it (the search spinner, and the minimap's auto-show, which
		// is supposed to be up before results start streaming in). Every exit path below, plus every
		// snapshot `_searchActions` applies, drives it back down.
		this.graphState.searching = true;
		// A new search session starts here, not when the host answers — see `searchSession`. Resume and
		// result-navigation issue their own searches without coming through here, so they correctly leave
		// the session (and any per-search UI state scoped to it) alone.
		this.graphState.searchSession++;

		try {
			const rsp = await this._searchActions.search({ search: { ...this._searchQuery } });

			// Log whenever we have a search — the NL error message and "Query: <processed>" chip live
			// inside logSearch, so a failed or zero-result NL search still needs it. Only a match
			// (count > 0) is allowed into search history.
			if (rsp?.state.query) {
				const results = rsp.state.results;
				const matched = results != null && !('error' in results) && results.count > 0;
				this.searchEl?.logSearch(rsp.state.query, { store: matched });
			}

			// A superseded/aborted search resolves `undefined` — nothing more to do; the search that
			// superseded it owns the state from here.
			if (rsp == null) return;

			// `applySearchState` already applied `rsp.state` (including `searchMode`) — only the
			// header-local bookkeeping remains here.
			//
			// NL search can force filter mode server-side (see `updateSearchMode` in
			// graphSearchService.ts) — sync the local query from the response so the toggle reflects it
			// and subsequent requests (paging/navigation) carry the routed value forward instead of
			// reverting to whatever the toggle showed before this search. The forced mode lasts only as
			// long as its search: remember the user's own toggle state so clearing the search restores
			// it (see `cancelSearch`).
			const nlMode =
				typeof rsp.state.query.naturalLanguage === 'object' ? rsp.state.query.naturalLanguage.mode : undefined;
			if (nlMode === 'filter' && rsp.state.query.filter && !preSearchFilter) {
				this._nlForcedFilterRestore ??= preSearchFilter;
			}

			this._searchQuery.filter = rsp.state.query.filter;

			// The selection itself arrives on the rows plane; this only says where to scroll.
			if (rsp.revealSha != null) {
				if (nlMode === 'select') {
					// "Take me to X" phrasing — jump the viewport deliberately through the same
					// queued navigation path 'first'/'last' use, instead of the plain reveal below
					// (avoids a double-jump from also calling revealFirstSearchMatch).
					this._pendingNavigation = 'first';
					if (!this._isNavigating) {
						void this.processNavigation();
					}
				} else {
					this.revealFirstSearchMatch(rsp.revealSha);
				}
			}
		} catch {
			this.graphState.searchResultsResponse = undefined;
			this.graphState.searching = false;
		}
	}

	private handleOnToggleRefsVisibilityClick(_event: any, refs: GraphExcludedRef[], visible: boolean) {
		const services = this._services;
		if (services == null) return;

		notifyService(services.filters, 'filters/refs', svc => svc.setRefsVisibility(refs, visible));
	}

	private handleSearch() {
		void this.startSearch();
	}

	private handleSearchInput(e: CustomEvent<SearchQuery>) {
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();
		// Captured before the cancel below can consume it: a replacing query ends any NL-forced filter
		// (the force lasts exactly its own search's lifetime), but the event's `filter` was built from
		// the box's still-forced toggle — so the new search must take the user's own mode instead of
		// inheriting the forced one.
		const nlForcedRestore = this._nlForcedFilterRestore;

		// Cancel any existing search before starting a new one
		if (this.graphState.searching) {
			this.cancelSearch(false);
		}

		if (nlForcedRestore != null) {
			this._searchQuery = { ...e.detail, filter: nlForcedRestore };
			this.applyNlForcedFilterRestore(nlForcedRestore);
		} else {
			this._searchQuery = e.detail;
		}

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

		// Preserve current search results but ensure hasMore is true — the host resumes from the paused
		// cursor and won't ship its own snapshot until the next batch lands.
		// Read from searchResultsResponse (the source) not searchResults (the derived value)
		const currentResults = this.graphState.searchResultsResponse;
		if (currentResults != null && !isGraphSearchResultsError(currentResults)) {
			this.graphState.searchResultsResponse = {
				...currentResults,
				hasMore: true,
			};
		}

		// Resume a paused search by requesting more results. The response is deliberately discarded
		// (void) — `_searchActions.search` applies the resulting snapshot itself via `applySearchState`,
		// and a superseded/aborted resume resolves `undefined` and touches nothing.
		void this._searchActions.search({ search: this._searchQuery, more: true });
	}

	/** Load-more for search navigation — the caller reads the results as locals, so nothing lands in state
	 *  here (`_searchActions.search` still applies the snapshot for the rest of the app). */
	private async onSearchPromise(search: SearchQuery, options?: { limit?: number; more?: boolean }) {
		try {
			return await this._searchActions.search({ search: search, limit: options?.limit, more: options?.more });
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
					!moreResults?.state.results ||
					isGraphSearchResultsError(moreResults.state.results) ||
					count >= moreResults.state.results.count
				) {
					break;
				}

				const priorCount = count;
				searchResults = moreResults.state.results;
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

	handleSearchModeChanged(e: CustomEvent<SearchModeChangeEventDetail>) {
		// An NL on/off toggle reports the CURRENT filter state, which may be NL-forced — persist only
		// the NL preference; the mode was not chosen, so it must neither become the sticky default nor
		// supersede a pending forced-filter restore.
		if (!e.detail.explicitMode) {
			this._searchActions.setMode(undefined, e.detail.useNaturalLanguage);
			return;
		}

		// Only an explicit user mode change cancels queued/in-flight navigation — a non-user state report
		// (e.g. search-input's willUpdate dropping NL when aiAllowed flips) must not cancel it.
		this._pendingNavigation = undefined;
		this.cancelActiveSearchNavigation();

		// An explicit mode choice supersedes any NL-forced filter restore
		this._nlForcedFilterRestore = undefined;
		// Update local state immediately for responsive UI
		this.graphState.searchMode = e.detail.searchMode;

		// Update the search query's filter property so it's included in the next search
		this._searchQuery.filter = e.detail.searchMode === 'filter';

		this._searchActions.setMode(e.detail.searchMode, e.detail.useNaturalLanguage);
	}

	handleMinimapToggled() {
		this.dispatchEvent(new CustomEvent('toggle-minimap', { bubbles: true, composed: true }));
	}

	@debounce(250)
	private onRepositorySelectorClicked(e: CustomEvent<RepoButtonGroupClickEvent>) {
		switch (e.detail.part) {
			case 'label': {
				const services = this._services;
				if (services == null) break;

				notifyService(services.pickers, 'pickers/chooseRepository', svc => svc.chooseRepository());
				break;
			}

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

	@query('.split-toolbar__popover')
	private readonly detailsPlacementPopoverEl!: GlPopover | null;

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
			searchFallback,
			searchRelaxations,
			searchMode,
			searchResults,
			searchResultsError,
			useNaturalLanguageSearch,
		} = this.graphState;

		const scoped = getDisplayedMode(this.graphState) === 'scoped';
		const filtered = isGraphFiltered(this.graphState);
		const rowClass = scoped ? 'titlebar__row--scoped' : filtered ? 'titlebar__row--filtered' : '';

		// Mid-typing an incomplete regex (e.g. `fix(`) silently matches literally instead of erroring — the
		// toggle stays checked but dims, and only once the search has fully settled (not still streaming
		// in) with zero matches do we offer the "Match literally" escape hatch.
		const fallbackActive = searchFallback != null;
		const settledWithNoResults = !searching && (searchResults?.count ?? 0) === 0;
		const showFallbackHelper = fallbackActive && settledWithNoResults;
		const showRelaxationsHelper = settledWithNoResults && (searchRelaxations?.length ?? 0) > 0;

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
						?errorCalm=${
							searchResultsError?.reason === 'invalidRef' ||
							searchResultsError?.reason === 'aiUnavailable'
						}
						?fallbackActive=${fallbackActive}
						fallbackDetail=${searchFallback?.detail ?? ''}
						?showFallbackHelper=${showFallbackHelper}
						.relaxations=${searchRelaxations ?? []}
						?showRelaxationsHelper=${showRelaxationsHelper}
						?showSearchAsTextHelper=${searchResultsError?.reason === 'aiUnavailable'}
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
						${this.renderDetailsToggle()}
					</action-nav>
				</div>
			</div>
		`;
	}

	/** The details toggle as a split control: the main half toggles show/hide (and, per Alt+Click,
	 *  pins the panel to the opposite side) and never writes configuration; the chevron half opens a
	 *  popover of placement thumbnails that persist a pick. */
	private renderDetailsToggle() {
		// Source the side from the resolved effective location (handles `auto`); Alt+Click
		// pins to the opposite side, so the alt preview/label use that opposite.
		const currentLocation = this.detailsEffectiveLocation;
		const altLocation = currentLocation === 'bottom' ? 'right' : 'bottom';
		const previewLocation = this._modifiers.altKey ? altLocation : currentLocation;
		const isBottom = previewLocation === 'bottom';
		const baseLabel = this.detailsVisible ? 'Hide Details Panel' : 'Show Details Panel';
		const altLabel = `Show Details Panel on ${altLocation === 'bottom' ? 'Bottom' : 'Right'}`;
		const tooltip = this._modifiers.altKey ? altLabel : `${baseLabel}\n[${getAltKeySymbol()}] ${altLabel}`;

		return html`<span class="split-toolbar">
			<gl-button
				class="split-toolbar__main"
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
			</gl-button>
			<gl-popover
				class="split-toolbar__popover"
				placement="bottom-end"
				trigger="click focus"
				?arrow=${false}
				.distance=${0}
			>
				<gl-button
					slot="anchor"
					class="split-toolbar__chevron"
					appearance="toolbar"
					aria-label="Details Panel Placement"
					aria-haspopup="menu"
				>
					<code-icon icon="chevron-down"></code-icon>
				</gl-button>
				<div slot="content" class="details-placement" role="menu" aria-label="Details Panel Placement">
					${this.renderDetailsPlacementOption('auto')} ${this.renderDetailsPlacementOption('right')}
					${this.renderDetailsPlacementOption('bottom')}
				</div>
			</gl-popover>
		</span>`;
	}

	private renderDetailsPlacementOption(location: 'auto' | 'right' | 'bottom') {
		const checked = this.detailsLocation === location;
		const label = location === 'auto' ? 'Auto' : location === 'right' ? 'Right' : 'Bottom';
		const description =
			location === 'auto'
				? `Picks a side to fit the window's shape — currently ${this.detailsAutoLocation}`
				: location === 'right'
					? 'Always docked to the right'
					: 'Always docked at the bottom';

		return html`<gl-tooltip placement="bottom">
			<button
				type="button"
				class="details-placement__option"
				role="menuitemradio"
				aria-checked=${checked}
				aria-label=${label}
				@click=${() => this.handleSelectDetailsLocation(location)}
			>
				${this.renderDetailsPlacementThumbnail(location)}
				<span>${label}</span>
			</button>
			<span slot="content">${description}</span>
		</gl-tooltip>`;
	}

	private renderDetailsPlacementThumbnail(location: 'auto' | 'right' | 'bottom') {
		const panelSide = location === 'auto' ? this.detailsAutoLocation : location;
		const panelOpacity = location === 'auto' ? 0.45 : 1;
		const panelD =
			panelSide === 'right'
				? 'M33 2 h16 a2 2 0 0 1 2 2 v28 a2 2 0 0 1 -2 2 h-16 z'
				: 'M2 21 h48 v11 a2 2 0 0 1 -2 2 h-44 a2 2 0 0 1 -2 -2 z';

		return svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 36" aria-hidden="true">
			<rect
				x="1"
				y="1"
				width="50"
				height="34"
				rx="3"
				stroke="var(--vscode-descriptionForeground)"
				stroke-width="1.4"
				fill="none"
			></rect>
			<path d=${panelD} fill="color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent)" opacity=${panelOpacity}></path>
			${
				location === 'auto'
					? svg`<text
						x=${panelSide === 'right' ? 20 : 26}
						y=${panelSide === 'right' ? 22 : 15}
						text-anchor="middle"
						font-size="13"
						fill="currentColor"
					>A</text>`
					: nothing
			}
		</svg>`;
	}

	private handleSelectDetailsLocation(location: 'auto' | 'right' | 'bottom') {
		this.dispatchEvent(
			new CustomEvent('select-details-location', {
				detail: { location: location },
				bubbles: true,
				composed: true,
			}),
		);
		void this.detailsPlacementPopoverEl?.hide();
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
