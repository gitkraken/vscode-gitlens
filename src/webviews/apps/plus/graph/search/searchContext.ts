import { createContext } from '@lit/context';
import type { SearchActions } from './searchActions.js';

export const searchActionsContext = createContext<SearchActions>('graph-search-actions-context');
