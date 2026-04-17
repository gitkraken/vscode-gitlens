import type { Remote } from '@eamodio/supertalk';
import type { ScopeChangedEvent, TimelineServices } from '../../../plus/timeline/protocol.js';
import type { RepositoryChangeEventData, Unsubscribe } from '../../../rpc/services/types.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';

/**
 * Resolved domain services needed for event subscriptions.
 */
interface ResolvedServices {
	readonly timeline: Awaited<Remote<TimelineServices>['timeline']>;
	readonly repositories: Awaited<Remote<TimelineServices>['repositories']>;
	readonly subscription: Awaited<Remote<TimelineServices>['subscription']>;
	readonly config: Awaited<Remote<TimelineServices>['config']>;
}

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
 * Accepts resolved domain services (including the timeline sub-service).
 * Returns a cleanup function that unsubscribes from all events.
 */
export function setupSubscriptions(resolved: ResolvedServices, actions: SubscriptionActions): Promise<Unsubscribe> {
	return subscribeAll([
		// ============================================================
		// View-specific events — from timeline sub-service
		// ============================================================

		// Scope changed (active tab, file selection)
		() => resolved.timeline.onScopeChanged((event: ScopeChangedEvent | undefined) => actions.onScopeChanged(event)),

		// ============================================================
		// Domain events — from domain service classes
		// ============================================================

		// Repository data changes — filter by current repo in handler
		() => resolved.repositories.onRepositoryChanged((e: RepositoryChangeEventData) => actions.onRepoChanged(e)),
		// Subscription changes — access might change
		() => resolved.subscription.onSubscriptionChanged(() => actions.onDataChanged()),
		// Config changes — date format etc.
		() => resolved.config.onConfigChanged(() => actions.onConfigChanged()),
		// Repositories added/removed
		() => resolved.repositories.onRepositoriesChanged(() => actions.onRepoCountChanged()),
	]);
}
