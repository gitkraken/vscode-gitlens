import type { NotificationsContext } from './context.js';
import { NotificationsApiError } from './errors.js';
import type { GkNotification, NotificationSettings, NotificationsPage } from './models.js';
import { isRecord, parseNotification } from './parse.js';

export const notificationsPageSize = 50;

/** A thin client over the `notifications-service-v2` v1 API. */
export class NotificationsApi {
	constructor(private readonly context: NotificationsContext) {}

	/** Loads one page (1-based), newest first. Invalid notifications are dropped (and logged). */
	async list(page: number, pageSize: number = notificationsPageSize): Promise<NotificationsPage> {
		const query = new URLSearchParams({
			productType: this.context.productType,
			page: String(page),
			pageSize: String(pageSize),
		});
		const data = await this.request('list', 'v1/notifications', { method: 'GET' }, query);

		const results = isRecord(data) && Array.isArray(data.results) ? (data.results as unknown[]) : [];
		const items: GkNotification[] = [];
		for (const raw of results) {
			const notification = parseNotification(raw, this.context.log);
			if (notification != null) {
				items.push(notification);
			}
		}

		return {
			items: items,
			hasMore: isRecord(data) && data.hasMore === true,
			page: isRecord(data) && typeof data.page === 'number' ? data.page : page,
		};
	}

	async markRead(ids: readonly string[]): Promise<void> {
		await this.request('markRead', 'v1/notifications/read', {
			method: 'POST',
			body: JSON.stringify({ notificationIds: ids }),
		});
	}

	async markUnread(ids: readonly string[]): Promise<void> {
		await this.request('markUnread', 'v1/notifications/unread', {
			method: 'POST',
			body: JSON.stringify({ notificationIds: ids }),
		});
	}

	async delete(ids: readonly string[]): Promise<void> {
		await this.request('delete', 'v1/notifications', {
			method: 'DELETE',
			body: JSON.stringify({ notificationIds: ids }),
		});
	}

	async getSettings(): Promise<NotificationSettings> {
		const data = await this.request('getSettings', 'v1/notifications/user-settings', { method: 'GET' });
		const settings = isRecord(data) ? data : {};
		// A missing flag means the service default, which is opted in
		return {
			marketingEnabled: settings.marketingEnabled !== false,
			helpEnabled: settings.helpEnabled !== false,
			securityEnabled: settings.securityEnabled !== false,
		};
	}

	async updateSettings(settings: NotificationSettings): Promise<void> {
		await this.request('updateSettings', 'v1/notifications/user-settings', {
			method: 'POST',
			body: JSON.stringify({
				marketingEnabled: settings.marketingEnabled,
				helpEnabled: settings.helpEnabled,
				securityEnabled: settings.securityEnabled,
			} satisfies NotificationSettings),
		});
	}

	/** Sends the request and returns the unwrapped `data` envelope (or `undefined` for an empty body). */
	private async request(
		operation: string,
		path: string,
		init: RequestInit,
		query?: URLSearchParams,
	): Promise<unknown> {
		const rsp = await this.context.fetchGkApi(
			path,
			{
				...init,
				headers: { 'Content-Type': 'application/json' },
			},
			query,
		);
		if (!rsp.ok) throw new NotificationsApiError(rsp.status, operation, rsp.statusText);

		const text = await rsp.text();
		if (!text) return undefined;

		let json: unknown;
		try {
			json = JSON.parse(text);
		} catch (ex) {
			throw new NotificationsApiError(rsp.status, operation, 'invalid JSON response', { cause: ex });
		}
		return isRecord(json) ? (json.data ?? json) : json;
	}
}
