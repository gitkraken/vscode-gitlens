import type { Connection, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import type { ScopeChangedEvent, TimelineServices } from '../../../plus/timeline/protocol.js';
import type { RepositoryChangeEventData } from '../../../rpc/services/types.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';

/**
 * Callback interface for actions that subscriptions trigger.
 */
export interface SubscriptionActions {
	/** Called when the host scope (active tab, file selection) changes. */
	onScopeChanged(event: ScopeChangedEvent | undefined): void;
	/** Called when a repository's data changes (index, head, etc.). */
	onRepoChanged(event: RepositoryChangeEventData): void;
	/** Called when subscription/access state changes (refetch timeline). */
	onDataChanged(): void;
	/** Called when config changes (date format, etc.). */
	onConfigChanged(): void;
	/** Called when repositories are added or removed. */
	onRepoCountChanged(): void;
}

/**
 * Set up all event subscriptions from the backend.
 * Accepts the RPC connection and actions. The library re-runs the subscriber on every
 * successful handshake (including reconnects), so it re-resolves sub-services and
 * re-subscribes each time.
 */
export function setupSubscriptions(connection: Connection, actions: SubscriptionActions): Subscription {
	return subscribe<TimelineServices>(connection, async services => {
		const [timeline, repositories, subscription, config] = await Promise.all([
			services.timeline,
			services.repositories,
			services.subscription,
			services.config,
		]);

		return subscribeAll([
			// ============================================================
			// View-specific events — from timeline sub-service
			// ============================================================

			// Scope changed (active tab, file selection)
			() => timeline.onScopeChanged((event: ScopeChangedEvent | undefined) => actions.onScopeChanged(event)),

			// ============================================================
			// Domain events — from domain service classes
			// ============================================================

			// Repository data changes — filter by current repo in handler
			() => repositories.onRepositoryChanged((e: RepositoryChangeEventData) => actions.onRepoChanged(e)),
			// Subscription changes — access might change
			() => subscription.onSubscriptionChanged(() => actions.onDataChanged()),
			// Config changes — date format etc.
			() => config.onConfigChanged(() => actions.onConfigChanged()),
			// Repositories added/removed
			() => repositories.onRepositoriesChanged(() => actions.onRepoCountChanged()),
		]);
	});
}
