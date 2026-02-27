/**
 * Subscriptions for the Timeline webview.
 *
 * This module sets up event subscriptions from the backend via RPC.
 * The webview subscribes to events and decides how to react.
 *
 * Event Flow:
 * 1. Backend fires event (e.g., scope changed, repo updated)
 * 2. RPC delivers event to subscribed callback
 * 3. Callback triggers actions (refetch, state update)
 * 4. UI reacts to signal changes
 *
 * Events are co-located with their domain services:
 * - git.onRepositoryChanged, git.onRepositoriesChanged
 * - subscription.onSubscriptionChanged
 * - config.onConfigChanged
 * View-specific events (scope changes) come from TimelineServices root.
 */
import type { Remote } from '@eamodio/supertalk';
import type { ScopeChangedEvent, TimelineServices } from '../../../plus/timeline/protocol.js';
import type { RepositoryChangeEventData } from '../../../rpc/services/types.js';
import type { Unsubscribe } from '../../shared/events/subscriptions.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';

/**
 * Resolved domain services needed for event subscriptions.
 */
interface SubscriptionServices {
	readonly git: Awaited<Remote<TimelineServices>['git']>;
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
 * Accepts the root services proxy (for `onScopeChanged`) and resolved domain services.
 * Returns a cleanup function that unsubscribes from all events.
 */
export function setupSubscriptions(
	services: Remote<TimelineServices>,
	resolved: SubscriptionServices,
	actions: SubscriptionActions,
): Promise<Unsubscribe> {
	return subscribeAll([
		// ============================================================
		// View-specific events — from TimelineServices root
		// ============================================================

		// Scope changed (active tab, file selection)
		() => services.onScopeChanged(event => actions.onScopeChanged(event)),

		// ============================================================
		// Domain events — from domain service classes
		// ============================================================

		// Repository data changes — filter by current repo in handler
		() => resolved.git.onRepositoryChanged(e => actions.onRepoChanged(e)),
		// Subscription changes — access might change
		() => resolved.subscription.onSubscriptionChanged(() => actions.onDataChanged()),
		// Config changes — date format etc.
		() => resolved.config.onConfigChanged(() => actions.onConfigChanged()),
		// Repositories added/removed
		() => resolved.git.onRepositoriesChanged(() => actions.onRepoCountChanged()),
	]);
}
