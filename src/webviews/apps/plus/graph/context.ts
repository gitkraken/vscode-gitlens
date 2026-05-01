import { createContext } from '@lit/context';
import type { AgentSessionState } from '../../../../agents/models/agentSessionState.js';
import type {
	GetOverviewWipResponse,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	State,
} from '../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse, OverviewBranchMergeTarget } from '../../../shared/overviewBranches.js';

export interface AppState extends State {
	state: State;
	activeDay: number | undefined;
	activeRow: string | undefined;
	agentSessions: AgentSessionState[];
	isBusy: boolean;
	loading: boolean;
	mcpBannerCollapsed?: boolean | undefined;
	hooksBannerCollapsed?: boolean | undefined;
	canInstallClaudeHook?: boolean | undefined;
	navigating: 'next' | 'previous' | false;
	overviewWip?: GetOverviewWipResponse;
	overviewEnrichment?: GetOverviewEnrichmentResponse;
	scope: GraphScope | undefined;
	searching: boolean;
	searchMode: 'filter' | 'normal';
	searchResultsResponse: GraphSearchResults | GraphSearchResultsError | undefined;
	searchResults: GraphSearchResults | undefined;
	searchResultsError: GraphSearchResultsError | undefined;
	currentSearchId: number | undefined;
	selectedRows: GraphSelectedRows | undefined;
	visibleDays: { top: number; bottom: number } | undefined;

	/**
	 * Publish a lazily-fetched merge target into `overviewEnrichment` for the given branchId. The graph
	 * overview's enrichment IPC skips merge-target fetching; the overview card and click-to-scope path
	 * fetch via `BranchesService.getMergeTargetStatus` and call this so the scope-anchor's
	 * `reconcileScopeMergeTarget` hook backfills the tip SHA.
	 */
	mergeMergeTargetIntoEnrichment(branchId: string, mergeTarget: OverviewBranchMergeTarget | undefined): void;

	/**
	 * Fetch enrichment for the overview's active/recent branches. Called lazily by consumers such as
	 * the scope popover (on open) and the overview sidebar (on mount), rather than eagerly at bootstrap.
	 * Deduped via a fingerprint of the branch ids — repeat calls for the same overview are a no-op.
	 */
	ensureOverviewEnrichmentFetched(overview: State['overview']): void;

	/**
	 * Resolve the authoritative `mergeBase` for a scope and patch it onto the current scope signal.
	 * Called by pickers (scope popover, overview card) at the moment of selection so the concern of
	 * "completing" a scope lives with whoever picks it rather than with downstream consumers. Cheap
	 * on re-picks due to session caching (webview-side + server-side).
	 */
	resolveScopeMergeBase(scope: GraphScope): Promise<void>;

	/**
	 * Defer clearing the current scope until the next `DidChangeRefsVisibilityNotification` lands —
	 * coalesces the scope clear with the filter visibility update so a mode/filter change produces
	 * a single coordinated re-render instead of a minimap reset followed by a separate filter update.
	 */
	deferScopeClear(): void;
}

export const graphStateContext = createContext<AppState>('graph-state-context');

export const graphServicesContext = createContext<
	import('@eamodio/supertalk').Remote<import('../../../plus/graph/graphService.js').GraphServices> | undefined
>('graph-services-context');
