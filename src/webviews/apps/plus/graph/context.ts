import { createContext } from '@lit/context';
import type {
	GetOverviewWipResponse,
	GraphScope,
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	State,
} from '../../../plus/graph/protocol.js';
import type { GetOverviewEnrichmentResponse } from '../../../shared/overviewBranches.js';

export interface AppState extends State {
	state: State;
	activeDay: number | undefined;
	activeRow: string | undefined;
	isBusy: boolean;
	loading: boolean;
	mcpBannerCollapsed?: boolean | undefined;
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

	/** Fetch enrichment for a branch not covered by the overview — used by the header scope popover. */
	ensureEnrichmentForBranch(branchId: string): Promise<void>;
}

export const graphStateContext = createContext<AppState>('graph-state-context');

export const graphServicesContext = createContext<
	import('@eamodio/supertalk').Remote<import('../../../plus/graph/graphService.js').GraphServices> | undefined
>('graph-services-context');
