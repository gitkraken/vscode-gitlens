import { createContext } from '@lit/context';
import type { SidebarActions } from './sidebarState.js';

export const sidebarActionsContext = createContext<SidebarActions>('graph-sidebar-actions-context');
