/**
 * Subscriptions for the Commit Details webview.
 *
 * This module sets up event subscriptions from the backend via RPC.
 * The webview subscribes to events and decides how to react.
 *
 * All functions receive the `CommitDetailsState` instance as a parameter — no
 * module-level singletons. The root component passes the state it owns.
 *
 * Event Flow:
 * 1. Backend fires event (e.g., commit selected in graph)
 * 2. RPC delivers event to subscribed callback
 * 3. Callback updates local state via signals
 * 4. UI reacts to signal changes
 *
 * Events are co-located with their domain services:
 * - inspect.onCommitSelected (view-specific commit selection)
 * - inspect.onShowWip (host requests WIP mode)
 * - repositories.onRepositoryChanged (workspace-level repo changes)
 * - config.onConfigChanged
 * - integrations.onIntegrationsChanged
 *
 * Note: subscription events (onSubscriptionChanged, onOrgSettingsChanged) are handled
 * via signal bridges — see commitDetails.ts _onRpcReady.
 */
import type { Remote } from '@eamodio/supertalk';
import type {
	CommitDetailsServices,
	CommitSelectionEvent,
	ShowWipEvent,
} from '../../commitDetails/commitDetailsService.js';
import type { RepositoryChangeEventData, Unsubscribe } from '../../rpc/services/types.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import type { CommitDetailsActions } from './actions.js';
import type { CommitDetailsState } from './state.js';

/**
 * Resolved domain services needed for event subscriptions.
 */
interface SubscriptionServices {
	readonly inspect: Awaited<Remote<CommitDetailsServices>['inspect']>;
	readonly repositories: Awaited<Remote<CommitDetailsServices>['repositories']>;
	readonly config: Awaited<Remote<CommitDetailsServices>['config']>;
	readonly integrations: Awaited<Remote<CommitDetailsServices>['integrations']>;
}

/**
 * Set up all event subscriptions from the backend.
 * Accepts state instance, resolved domain services, and actions.
 * Returns a cleanup function that unsubscribes from all events.
 */
export function setupSubscriptions(
	state: CommitDetailsState,
	services: SubscriptionServices,
	actions: CommitDetailsActions,
): Promise<Unsubscribe> {
	return subscribeAll([
		() =>
			services.inspect.onCommitSelected((event: CommitSelectionEvent) =>
				handleCommitSelected(state, event, actions),
			),
		() =>
			services.repositories.onRepositoryChanged((event: RepositoryChangeEventData) =>
				handleRepositoryChanged(state, event, actions),
			),
		() => services.config.onConfigChanged(() => handleConfigChanged(actions)),
		// Note: onSubscriptionChanged removed — hasAccount signal bridged from host
		// Note: onOrgSettingsChanged removed — orgSettings signal bridged from host
		() =>
			services.integrations.onIntegrationsChanged(data => handleIntegrationsChanged(state, data.hasAnyConnected)),
		// Host requests WIP mode on an already-live webview (Launchpad, deep links, etc.)
		() => services.inspect.onShowWip((event: ShowWipEvent) => handleShowWip(state, event, actions)),
	]);
}

// ============================================================
// Event Handlers
// ============================================================

/**
 * Handle commit selection event.
 * Fired when a commit is selected elsewhere (graph, editor line, etc.).
 */
function handleCommitSelected(
	state: CommitDetailsState,
	event: CommitSelectionEvent,
	actions: CommitDetailsActions,
): void {
	const isPinned = state.pinned.get();

	// If pinned and this is a passive selection, ignore it
	if (isPinned && event.passive) return;

	// Clear stale search metadata when the new selection is not coming from search.
	state.searchContext.set(event.searchContext);

	// Host requested a specific mode (graph-attached panels only).
	// Graph Details auto-switches between WIP and commit tabs based on selection.
	if (event.requestedMode != null && !isPinned) {
		if (event.requestedMode === 'wip') {
			if (state.mode.get() !== 'wip') {
				actions.switchMode('wip');
			} else {
				// Already in WIP mode — refetch for potentially different repo
				void actions.fetchWipState(event.repoPath);
			}
			return;
		}

		// requestedMode === 'commit' — switch from WIP to commit if needed
		if (state.mode.get() !== 'commit') {
			actions.switchMode('commit');
		}
	}

	// Only fetch when in commit mode — avoids unnecessary network round-trip while in WIP mode
	if (state.mode.get() === 'commit') {
		void actions.fetchCommit(event.repoPath, event.sha);
	}
}

/**
 * Handle repository change event (generic, fires for all repos).
 * Filters by change type to decide what to refresh.
 *
 * - WIP mode: Index/Head changes for the current WIP repo trigger a WIP refetch
 *   (FS-level changes are handled separately via `onRepositoryWorkingChanged` in actions)
 * - Commit mode: Head/Heads changes clear stale reachability data
 */
function handleRepositoryChanged(
	state: CommitDetailsState,
	event: RepositoryChangeEventData,
	actions: CommitDetailsActions,
): void {
	// WIP mode: refetch on Index/Head changes for the current WIP repo
	if (state.mode.get() === 'wip') {
		const wipRepoPath = state.wipState.get()?.repo?.path;
		if (event.repoPath === wipRepoPath) {
			const hasWipChanges = event.changes.some(c => c === 'index' || c === 'head');
			if (hasWipChanges) {
				void actions.fetchWipState(event.repoPath);
			}
		}
	}

	// Clear stale reachability on significant repo changes (Head/Heads)
	const currentCommit = state.currentCommit.get();
	if (currentCommit?.repoPath === event.repoPath) {
		const isSignificant = event.changes.some(c => c === 'head' || c === 'heads');
		if (isSignificant) {
			actions.clearReachability();
		}
	}
}

/**
 * Handle configuration change event.
 */
function handleConfigChanged(actions: CommitDetailsActions): void {
	// Re-fetch preferences when config changes
	void actions.fetchPreferences();
}

/**
 * Handle integrations change event.
 */
function handleIntegrationsChanged(state: CommitDetailsState, hasConnected: boolean): void {
	state.capabilities.hasIntegrationsConnected = hasConnected;
}

/**
 * Handle host requesting WIP mode on an already-live webview.
 * Fired when Launchpad, deep links, or code review opens WIP in the existing Inspect panel.
 */
function handleShowWip(state: CommitDetailsState, event: ShowWipEvent, actions: CommitDetailsActions): void {
	state.mode.set('wip');
	state.inReview.set(event.inReview);
	state.draftState.set({ inReview: event.inReview });
	void actions.fetchWipState(event.repoPath);
}
