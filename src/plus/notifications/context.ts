import type { NotificationsContext } from '@gitlens/notifications/context.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ServerConnection } from '../gk/serverConnection.js';

/**
 * Builds the {@link NotificationsContext} the `@gitlens/notifications` package runs against in GitLens.
 * `fetchGkApi` replaces the GK API requests (the DEBUG notifications simulator's fake server).
 */
export function createNotificationsContext(
	connection: ServerConnection,
	fetchGkApi?: NotificationsContext['fetchGkApi'],
): NotificationsContext {
	return {
		productType: 'gitlens',
		// Background requests: polling must never toast GK errors or trip the too-many-failures breaker
		fetchGkApi:
			fetchGkApi ??
			((path, init, query) =>
				connection.fetchGkApi(path, init, { background: true, query: query?.toString() || undefined })),
		log: {
			debug: message => Logger.debug(`Notifications: ${message}`),
			warn: message => Logger.warn(`Notifications: ${message}`),
			error: (ex, message) => Logger.error(ex, message != null ? `Notifications: ${message}` : 'Notifications'),
		},
	};
}
