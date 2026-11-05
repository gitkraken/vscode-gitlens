import type { UnifiedDisposable } from '@gitlens/utils/disposable.js';
import type { Event } from '@gitlens/utils/event.js';
import { Emitter } from '@gitlens/utils/event.js';
import { NotificationsApi } from './api.js';
import type { NotificationsContext } from './context.js';
import { NotificationsApiError } from './errors.js';
import type {
	GkNotification,
	NotificationSettings,
	NotificationsSnapshot,
	NotificationsState,
	NotificationsStatus,
} from './models.js';
import { isToastEligible } from './presentation.js';

/**
 * How far before the newest previously-held notification's `createdAt` a notification may fall and still count as
 * newly arrived in {@link NotificationsService.refresh}'s result. Both sides are server timestamps; the margin only
 * covers concurrent inserts committing out of `created_at` order on the server.
 */
export const newToastableSkewMargin = 5 * 60 * 1000; // 5 minutes

/** At most this many pages are re-fetched by a refresh; anything paged in beyond them is dropped until loaded again */
const maxRefreshPages = 5;

/** A change an action made locally that a refresh must keep until the server is known to reflect it */
type Override = ((n: GkNotification) => GkNotification) | 'deleted';

/**
 * Holds the user's notifications for one product and keeps them in sync with `notifications-service-v2`.
 * Read/unread/delete and settings changes apply optimistically and roll back if the request fails (a 404 on
 * read/unread/delete means the notifications are already gone, so it isn't a failure). The service never polls on
 * its own: the host decides when to {@link refresh}, and each refresh reports which notices newly arrived and
 * should toast; how (and whether) to show them stays the host's call.
 */
export class NotificationsService implements UnifiedDisposable {
	private readonly _onDidChange = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly api: NotificationsApi;
	private _items: GkNotification[] = [];
	private _hasMore = false;
	/** The last page loaded, 1-based; 0 before the first load. */
	private _page = 0;
	private _status: NotificationsStatus = 'idle';
	private _lastSyncedAt: number | undefined;
	private _settings: NotificationSettings | undefined;
	/** The settings the server last acknowledged (fetched, or successfully saved) */
	private _confirmedSettings: NotificationSettings | undefined;
	private _settingsPost: Promise<NotificationSettings> | undefined;
	private _settingsFollowUp: Promise<NotificationSettings> | undefined;
	private _refreshing: Promise<GkNotification[]> | undefined;
	private _loadingMore: Promise<void> | undefined;
	/**
	 * Actions in flight (or settled while a refresh that started before them was still fetching), by id. A refresh
	 * re-applies them so data fetched before the server saw an action doesn't undo it.
	 */
	private readonly _overrides = new Map<string, Override>();
	/** For items a refresh re-applied an override to: the override's output → which override and the server's item */
	private readonly _overridden = new WeakMap<GkNotification, { override: Override; server: GkNotification }>();

	constructor(private readonly context: NotificationsContext) {
		this.api = new NotificationsApi(context);
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	get unreadCount(): number {
		return this._items.reduce((count, n) => (n.readAt == null ? count + 1 : count), 0);
	}

	getState(): NotificationsState {
		return {
			items: this._items,
			hasMore: this._hasMore,
			status: this._status,
			lastSyncedAt: this._lastSyncedAt,
			settings: this._settings,
			unreadCount: this.unreadCount,
		};
	}

	/**
	 * Re-fetches every page already loaded (up to {@link maxRefreshPages}), so read state, deletions and expiry
	 * from elsewhere reach them without collapsing a list the user paged through. Expired items are pruned and
	 * local actions still in flight are kept. Never throws: on failure the cached items stay and the status
	 * becomes `error`.
	 *
	 * Resolves to the notices to toast: the unread, toast-eligible ones that newly arrived with this refresh,
	 * newest first. Empty when the refresh failed, when nothing had synced before it (no backfill: the first load
	 * for an account is the existing inbox, not news; a restored snapshot with a `lastSyncedAt` does count as
	 * synced, so what arrived while the host was closed still toasts), or when nothing is new. New means its id
	 * wasn't held before the refresh AND it was created after the newest of those held, less
	 * {@link newToastableSkewMargin}. Only server timestamps are compared, so the client's clock can't hide a
	 * notice. The id check keeps a notice already seen from toasting again; the time check keeps an old one that
	 * only now shifts into the first page (after a deletion, or a page boundary moving) from toasting as if it
	 * were new. With nothing held before there is no cutoff.
	 *
	 * Concurrent calls share one request and resolve to the same list, so the result is for ONE caller to act on
	 * once (the host's refresh loop); other callers should ignore it.
	 */
	refresh(): Promise<GkNotification[]> {
		this._refreshing ??= this.refreshCore().finally(() => {
			this._refreshing = undefined;
		});
		return this._refreshing;
	}

	private async refreshCore(): Promise<GkNotification[]> {
		this.setStatus('loading');
		// A Load More in flight would otherwise land after this read the page count, and be dropped by the commit.
		// (No deadlock: a running `loadMoreCore` is already past its own wait on `_refreshing`.)
		await this._loadingMore?.catch(() => undefined);

		// What was held before this refresh, to tell what newly arrived with it
		const previous = this._items;
		const previouslySynced = this._lastSyncedAt != null;

		let arrived: GkNotification[] = [];
		try {
			// Re-fetch every page already loaded (capped), so read state, deletions and expiry on the server reach
			// them too, without collapsing a list the user has paged through
			const pages = Math.min(Math.max(this._page, 1), maxRefreshPages);
			const items: GkNotification[] = [];
			const seen = new Set<string>();
			// Counted locally: the loop must end even if the server's own page numbering doesn't advance
			let page = 0;
			let hasMore = true;
			while (hasMore && page < pages) {
				page++;
				const next = await this.api.list(page);
				for (const n of next.items) {
					if (!seen.has(n.id)) {
						seen.add(n.id);
						items.push(n);
					}
				}
				hasMore = next.hasMore;
			}

			this._items = sortNewestFirst(this.pruneExpired(this.applyOverrides(items)));
			this._hasMore = hasMore;
			this._page = page;
			this._lastSyncedAt = this.now();
			this._status = 'ready';
			if (previouslySynced) {
				arrived = this.newToastableSince(previous);
			}
		} catch (ex) {
			this.context.log?.error?.(ex, 'Unable to refresh notifications');
			this._status = 'error';
		}

		this.fireChange();
		return arrived;
	}

	/**
	 * Loads the next page, after any refresh in flight (which may change which page is next). Throws on failure,
	 * leaving the loaded items as they were. Concurrent calls share one request.
	 */
	loadMore(): Promise<void> {
		this._loadingMore ??= this.loadMoreCore().finally(() => {
			this._loadingMore = undefined;
		});
		return this._loadingMore;
	}

	private async loadMoreCore(): Promise<void> {
		if (this._refreshing != null) {
			await this._refreshing;
		}
		if (!this._hasMore) return;

		const page = this._page + 1;
		const next = await this.api.list(page);

		const ids = new Set(this._items.map(n => n.id));
		const added = this.applyOverrides(next.items.filter(n => !ids.has(n.id)));
		this._items = sortNewestFirst(this.pruneExpired([...this._items, ...added]));
		this._page = page;
		this._hasMore = next.hasMore;
		this.fireChange();
	}

	markRead(ids: readonly string[]): Promise<void> {
		const readAt = this.now();
		return this.updateOptimistically(
			ids,
			n => (n.readAt == null ? { ...n, readAt: readAt } : n),
			() => this.api.markRead(ids),
		);
	}

	markUnread(ids: readonly string[]): Promise<void> {
		return this.updateOptimistically(
			ids,
			n => {
				if (n.readAt == null) return n;

				const { readAt: _, ...unread } = n;
				return unread;
			},
			() => this.api.markUnread(ids),
		);
	}

	async delete(ids: readonly string[]): Promise<void> {
		if (!ids.length) return;

		const deleting = new Set(ids);
		const removed = this._items.filter(n => deleting.has(n.id));
		this._items = this._items.filter(n => !deleting.has(n.id));
		const release = this.trackOverrides(ids, 'deleted');
		this.fireChange();

		try {
			await this.api.delete(ids);
			release(true);
		} catch (ex) {
			// The server drops ids it can no longer find and only answers 404 when none remain: already deleted
			if (NotificationsApiError.is(ex) && ex.status === 404) {
				release(true);
				return;
			}

			release(false);
			// Put back what was removed, without resurrecting anything a concurrent refresh already returned
			const present = new Set(this._items.map(n => n.id));
			this._items = sortNewestFirst([...this._items, ...removed.filter(n => !present.has(n.id))]);
			this.fireChange();
			throw ex;
		}
	}

	/** Marks every loaded unread notification read. */
	markAllRead(): Promise<void> {
		return this.markRead(this._items.filter(n => n.readAt == null).map(n => n.id));
	}

	/** Deletes every loaded read notification. */
	deleteAllRead(): Promise<void> {
		return this.delete(this._items.filter(n => n.readAt != null).map(n => n.id));
	}

	/** Fetches the user's notification settings (and caches them in the state). */
	async getSettings(): Promise<NotificationSettings> {
		const settings = await this.api.getSettings();
		this._settings = settings;
		this._confirmedSettings = settings;
		this.fireChange();
		return settings;
	}

	/**
	 * Applies `changes` optimistically, then saves. The server stores the whole settings object from each request,
	 * so POSTs must not overlap (they could land out of order and leave the older state): at most one is in flight,
	 * and calls made meanwhile share ONE follow-up POST that sends the latest state. Each call settles with the
	 * outcome of the POST that carried its change.
	 */
	async updateSettings(changes: Partial<NotificationSettings>): Promise<NotificationSettings> {
		let current = this._settings;
		if (current == null) {
			const fetched = await this.api.getSettings();
			// A concurrent call may have populated it while fetching
			this._settings ??= fetched;
			this._confirmedSettings ??= fetched;
			current = this._settings;
		}

		this._settings = { ...current, ...changes };
		this.fireChange();

		if (this._settingsFollowUp != null) return this._settingsFollowUp;

		if (this._settingsPost == null) return this.trackSettingsPost(this.postSettings());

		const follow = this._settingsPost
			.catch(() => undefined)
			.then(() => {
				// Starting now: later calls need a new follow-up
				this._settingsFollowUp = undefined;
				return this.postSettings();
			});
		this._settingsFollowUp = follow;
		return this.trackSettingsPost(follow);
	}

	private trackSettingsPost(post: Promise<NotificationSettings>): Promise<NotificationSettings> {
		this._settingsPost = post;
		const clear = (): void => {
			if (this._settingsPost === post) {
				this._settingsPost = undefined;
			}
		};
		post.then(clear, clear);
		return post;
	}

	/** Sends the latest optimistic settings; the confirmed state is what was sent, not the server's echo. */
	private async postSettings(): Promise<NotificationSettings> {
		const settings = this._settings!;
		try {
			await this.api.updateSettings(settings);
		} catch (ex) {
			// A newer change will be carried by the follow-up POST, so only roll back when there is none
			if (this._settings === settings) {
				this._settings = this._confirmedSettings;
				this.fireChange();
			}
			throw ex;
		}

		this._confirmedSettings = settings;
		return settings;
	}

	/** The held notices that are new relative to `previous`, newest first; see {@link refresh} for the rules */
	private newToastableSince(previous: readonly GkNotification[]): GkNotification[] {
		const knownIds = new Set<string>();
		let newest = Number.NEGATIVE_INFINITY;
		for (const n of previous) {
			knownIds.add(n.id);
			if (n.createdAt > newest) {
				newest = n.createdAt;
			}
		}

		const cutoff = newest - newToastableSkewMargin;
		return this._items.filter(
			n => !knownIds.has(n.id) && n.createdAt > cutoff && n.readAt == null && isToastEligible(n),
		);
	}

	toSnapshot(): NotificationsSnapshot {
		return {
			items: this._items,
			hasMore: this._hasMore,
			page: this._page,
			lastSyncedAt: this._lastSyncedAt,
			settings: this._settings,
		};
	}

	/** Seeds the state from a snapshot the host persisted; expired items are pruned. */
	restore(snapshot: NotificationsSnapshot): void {
		const items = Array.isArray(snapshot.items)
			? snapshot.items.filter(n => typeof n?.id === 'string' && typeof n.createdAt === 'number')
			: [];

		this._items = sortNewestFirst(this.pruneExpired(items));
		this._hasMore = snapshot.hasMore === true;
		this._page = typeof snapshot.page === 'number' ? snapshot.page : items.length ? 1 : 0;
		this._lastSyncedAt = snapshot.lastSyncedAt;
		this._settings = snapshot.settings;
		this._confirmedSettings = snapshot.settings;
		this.fireChange();
	}

	/** On a 404 (the notifications are already gone) the targets are removed instead of rolled back. */
	private async updateOptimistically(
		ids: readonly string[],
		update: (n: GkNotification) => GkNotification,
		request: () => Promise<void>,
	): Promise<void> {
		if (!ids.length) return;

		const targets = new Set(ids);
		const previous = new Map<string, GkNotification>();
		const updated = new Map<string, GkNotification>();
		this._items = this._items.map(n => {
			if (!targets.has(n.id)) return n;

			const next = update(n);
			if (next !== n) {
				previous.set(n.id, n);
				updated.set(n.id, next);
			}
			return next;
		});
		const release = this.trackOverrides([...updated.keys()], update);
		this.fireChange();

		try {
			await request();
			release(true);
		} catch (ex) {
			// The server drops ids it can no longer find and only answers 404 when none remain: they're gone, and a
			// refresh already in flight (fetched before they were deleted) must not bring them back
			if (NotificationsApiError.is(ex) && ex.status === 404) {
				release(false);
				this._items = this._items.filter(n => !targets.has(n.id));
				this.trackOverrides(ids, 'deleted')(true);
				this.fireChange();
				return;
			}

			release(false);
			// Only roll back items still in the state this call (or a refresh re-applying it) left them in, so a
			// later action or refresh on them wins
			this._items = this._items.map(n => {
				if (updated.get(n.id) === n) return previous.get(n.id) ?? n;

				// A refresh landed meanwhile and re-applied this action to its data: fall back to the server's item
				const overridden = this._overridden.get(n);
				return overridden?.override === update ? overridden.server : n;
			});
			this.fireChange();
			throw ex;
		}
	}

	/**
	 * Records `override` for `ids` until the action settles; on success, until any refresh or Load More in flight
	 * (either may have fetched before the server applied the action) has landed too. Returns the release for when
	 * it settles.
	 */
	private trackOverrides(ids: readonly string[], override: Override): (succeeded: boolean) => void {
		for (const id of ids) {
			this._overrides.set(id, override);
		}

		return succeeded => {
			const clear = () => {
				for (const id of ids) {
					// A later action on the same id owns it now
					if (this._overrides.get(id) === override) {
						this._overrides.delete(id);
					}
				}
			};

			const inFlight = [this._refreshing, this._loadingMore].filter(p => p != null);
			if (succeeded && inFlight.length) {
				// `allSettled`: a failed Load More rejects, and must still clear (without an unhandled rejection)
				void Promise.allSettled(inFlight).then(clear);
			} else {
				clear();
			}
		};
	}

	private applyOverrides(items: GkNotification[]): GkNotification[] {
		if (!this._overrides.size) return items;

		const result: GkNotification[] = [];
		for (const n of items) {
			const override = this._overrides.get(n.id);
			if (override === 'deleted') continue;

			if (override == null) {
				result.push(n);
				continue;
			}

			const output = override(n);
			if (output !== n) {
				this._overridden.set(output, { override: override, server: n });
			}
			result.push(output);
		}
		return result;
	}

	private pruneExpired(items: GkNotification[]): GkNotification[] {
		const now = this.now();
		return items.filter(n => n.expiresAt == null || n.expiresAt > now);
	}

	private setStatus(status: NotificationsStatus): void {
		if (this._status === status) return;

		this._status = status;
		this.fireChange();
	}

	private fireChange(): void {
		this._onDidChange.fire(undefined);
	}

	private now(): number {
		return this.context.now?.() ?? Date.now();
	}
}

function sortNewestFirst(items: GkNotification[]): GkNotification[] {
	return items.sort((a, b) => b.createdAt - a.createdAt);
}
