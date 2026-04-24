import { createContext } from '@lit/context';
import type { DetailsActions } from './detailsActions.js';
import type { DetailsState } from './detailsState.js';
import type { DetailsWorkflowController } from './detailsWorkflowController.js';

export const detailsStateContext = createContext<DetailsState>('graph-details-state');
export const detailsActionsContext = createContext<DetailsActions>('graph-details-actions');
/**
 * Exposes the workflow state machine to descendant components so they can invoke typed
 * intent calls (mode transitions, forward/back snapshots) directly instead of bubbling
 * events up through the details panel. Sub-panels SHOULD prefer this over
 * `detailsActionsContext` for workflow-level operations; `detailsActionsContext` remains
 * for everything else (file operations, capabilities, etc.).
 */
export const detailsWorkflowContext = createContext<DetailsWorkflowController>('graph-details-workflow');
