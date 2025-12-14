import { createContext } from '@lit/context';
import type {
	GraphSearchResults,
	GraphSearchResultsError,
	GraphSelectedRows,
	State,
} from '../../../plus/graph/protocol';

export interface AppState extends State {
	state: State;
	activeDay: number | undefined;
	activeRow: string | undefined;
	isBusy: boolean;
	loading: boolean;
	mcpBannerCollapsed?: boolean | undefined;
	navigating: 'next' | 'previous' | false;
	searching: boolean;
	searchMode: 'filter' | 'normal';
	searchResultsResponse: GraphSearchResults | GraphSearchResultsError | undefined;
	searchResults: GraphSearchResults | undefined;
	searchResultsError: GraphSearchResultsError | undefined;
	selectedRows: GraphSelectedRows | undefined;
	visibleDays: { top: number; bottom: number } | undefined;
}

export const graphStateContext = createContext<AppState>('graph-state-context');
