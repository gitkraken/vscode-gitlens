export type NotificationContentType = 'feature' | 'help' | 'marketing' | 'system' | 'security';

/** The events this package knows how to render; anything else is `unknown` and shown via its `fallback`. */
export type NotificationEvent = 'general' | 'callToAction' | 'projectShared' | 'nudge' | 'unknown';

/** A notification as `notifications-service-v2` returns it from `GET v1/notifications`. Untrusted input. */
export interface RawNotification {
	notificationId: string;
	name: string;
	title?: string | null;
	notificationType: 'system' | 'user';
	contentType: NotificationContentType;
	/** Any string; the known values are those of {@link NotificationEvent} other than `unknown`. */
	event: string;
	/** ISO 8601 timestamps. */
	readAt?: string | null;
	expiresAt?: string | null;
	createdAt: string;
	updatedAt: string;
	fallback?: string | null;
	payload?: unknown;
}

export interface NotificationSettings {
	marketingEnabled: boolean;
	helpEnabled: boolean;
	securityEnabled: boolean;
}

/**
 * The parts of a `projectShared` notification. The package cannot localize, so the host assembles the sentence
 * ("In {organization}, {owner} created a new Team Workspace: {project}", plus the teams when there are any).
 */
export interface ProjectSharedDetails {
	organization: string;
	owner: string;
	project: string;
	teams: string[];
}

/** A validated notification. Plain data, so it can be persisted and sent over RPC as is. */
export interface GkNotification {
	id: string;
	event: NotificationEvent;
	contentType: NotificationContentType;
	/**
	 * The server's display `title`; `undefined` when unset, in which case the host supplies its own header.
	 * Never the server's internal `name`.
	 */
	headline?: string;
	/**
	 * A plain-text one-line summary of the notice (the server's `payload.desktopMessage`, else `fallback`), when set;
	 * the host uses it where there's no {@link headline}. Never markdown-rendered.
	 */
	summary?: string;
	/** Markdown. `undefined` for `projectShared`, whose body the host builds from {@link projectShared}. */
	body: string | undefined;
	/** Only for `callToAction`; the URL is always `https:`. */
	cta?: { text: string; url: string };
	/** Only for `projectShared`. */
	projectShared?: ProjectSharedDetails;
	/** Timestamps in ms since the epoch. */
	createdAt: number;
	readAt?: number;
	expiresAt?: number;
	/** Set when an unknown event is shown through its `fallback` text. */
	needsNewerVersion?: boolean;
}

export interface NotificationsPage {
	items: GkNotification[];
	hasMore: boolean;
	page: number;
}

export type NotificationsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface NotificationsState {
	/** Newest first. */
	readonly items: readonly GkNotification[];
	readonly hasMore: boolean;
	readonly status: NotificationsStatus;
	readonly lastSyncedAt: number | undefined;
	readonly settings: NotificationSettings | undefined;
	/** Unread among the loaded items. */
	readonly unreadCount: number;
}

/** What the host persists between sessions; see `NotificationsService.toSnapshot()` and `restore()`. */
export interface NotificationsSnapshot {
	items: GkNotification[];
	hasMore: boolean;
	/** The last page loaded, 1-based. */
	page: number;
	lastSyncedAt: number | undefined;
	settings: NotificationSettings | undefined;
}
