import type { Signal } from '@lit-labs/signals';
import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { RemoteNotificationsService } from '../../../rpc/services/notifications.js';
import type { NotificationsInboxState } from '../../../rpc/services/types.js';

/**
 * Shared GitKraken notifications inbox state for the Graph webview (the header's bell). Owned by `gl-graph-app`:
 * seeded from the host's `notificationsState` and kept fresh from `onNotificationsChanged` (see
 * `AccountLaunchpadController.initNotifications`), so the bell never fetches on its own. Provided via
 * {@link graphNotificationsContext}.
 */
export interface GraphNotificationsState {
	/** `undefined` until the host's inbox state first arrives */
	readonly inbox: Signal.State<NotificationsInboxState | undefined>;
	/** The notifications RPC service for actions (mark read, open a CTA, ...); `undefined` until it resolves */
	readonly service: Signal.State<RemoteNotificationsService | undefined>;
}

export function createGraphNotificationsState(): GraphNotificationsState {
	return {
		inbox: litSignal<NotificationsInboxState | undefined>(undefined),
		service: litSignal<RemoteNotificationsService | undefined>(undefined),
	};
}

export const graphNotificationsContext = createContext<GraphNotificationsState>('graph-notifications-context');
