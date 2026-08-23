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
 * - repositories.onRepositoryChanged (workspace-level repo changes)
 * - config.onConfigChanged
 * - integrations.onIntegrationsChanged
 *
 * Note: subscription events (onSubscriptionChanged, onOrgSettingsChanged) are handled
 * via signal bridges — see commitDetails.ts _onRpcReady.
 */
import type { Connection, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { CommitDetailsServices, CommitSelectionEvent } from '../../commitDetails/commitDetailsService.js';
import type { RepositoryChangeEventData } from '../../rpc/services/types.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import type { CommitDetailsActions } from './actions.js';
import type { CommitDetailsState } from './state.js';

/**
 * Set up all event subscriptions from the backend.
 * Accepts the RPC connection, state instance, and actions.
 * The library re-runs the subscriber on every successful handshake (including reconnects),
 * so it re-resolves sub-services and re-subscribes each time.
 */
export function setupSubscriptions(
	connection: Connection,
	state: CommitDetailsState,
	actions: CommitDetailsActions,
): Subscription {
	return subscribe<CommitDetailsServices>(connection, async services => {
		const [inspect, repositories, config, integrations, ai] = await Promise.all([
			services.inspect,
			services.repositories,
			services.config,
			services.integrations,
			services.ai,
		]);

		return subscribeAll([
			() =>
				inspect.onCommitSelected((event: CommitSelectionEvent) => handleCommitSelected(state, event, actions)),
			() =>
				repositories.onRepositoryChanged((event: RepositoryChangeEventData) =>
					handleRepositoryChanged(state, event, actions),
				),
			() => config.onConfigChanged(() => handleConfigChanged(actions)),
			// Note: onSubscriptionChanged/onOrgSettingsChanged removed — the bridged hasAccount and
			// orgSettings signals are kept fresh by SubscriptionService's eager listeners (#5513)
			() => integrations.onIntegrationsChanged(data => handleIntegrationsChanged(state, data.hasAnyConnected)),
			() => ai.onModelChanged(model => state.aiModel.set(model)),
		]);
	});
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

	void actions.fetchCommit(event.repoPath, event.sha);
}

/**
 * Handle repository change event (generic, fires for all repos).
 * Filters by change type to decide what to refresh.
 *
 * - Head/Heads changes clear stale reachability data for the current commit
 */
function handleRepositoryChanged(
	state: CommitDetailsState,
	event: RepositoryChangeEventData,
	actions: CommitDetailsActions,
): void {
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
