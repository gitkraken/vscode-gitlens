import type { NotificationsLogger } from './context.js';
import type { GkNotification, NotificationContentType, NotificationEvent, ProjectSharedDetails } from './models.js';
import { isSafeExternalUrl, toPlainText } from './presentation.js';

const contentTypes: ReadonlySet<string> = new Set<NotificationContentType>([
	'feature',
	'help',
	'marketing',
	'system',
	'security',
]);
const knownEvents: ReadonlySet<string> = new Set<NotificationEvent>([
	'general',
	'callToAction',
	'projectShared',
	'nudge',
]);

type Content = Pick<GkNotification, 'body' | 'cta' | 'projectShared'>;

/**
 * Validates a notification from the server. Returns `undefined` (and logs why, without its content) when it
 * can't be shown: a missing identity, a malformed payload for its event, an unknown
 * event with no `fallback`. A missing `title` is not a reason to drop one.
 */
export function parseNotification(raw: unknown, log?: NotificationsLogger): GkNotification | undefined {
	if (!isRecord(raw)) {
		log?.warn?.('Dropped a notification: not an object');
		return undefined;
	}

	const id = nonEmptyString(raw.notificationId);
	if (id == null) {
		log?.warn?.('Dropped a notification: missing notificationId');
		return undefined;
	}

	const result = toNotification(id, raw);
	if (typeof result === 'string') {
		log?.warn?.(`Dropped notification ${id}: ${result}`);
		return undefined;
	}

	return result;
}

/** The validated notification, or why it was dropped. */
function toNotification(id: string, raw: Record<string, unknown>): GkNotification | string {
	// An unrecognized content type (e.g. one the server adds later) is shown like `feature`: no chip, no toast
	const contentType: NotificationContentType =
		typeof raw.contentType === 'string' && contentTypes.has(raw.contentType)
			? (raw.contentType as NotificationContentType)
			: 'feature';

	const createdAt = parseTimestamp(raw.createdAt);
	if (createdAt == null) return 'invalid createdAt';

	const rawEvent = typeof raw.event === 'string' ? raw.event : '';

	let event: NotificationEvent;
	let content: Content | undefined;
	let needsNewerVersion = false;
	if (knownEvents.has(rawEvent)) {
		event = rawEvent as NotificationEvent;
		content = parsePayload(event, isRecord(raw.payload) ? raw.payload : undefined);
		if (content == null) return `invalid '${event}' payload`;
	} else {
		const fallback = nonEmptyString(raw.fallback);
		if (fallback == null) return `unknown event '${rawEvent}' with no fallback`;

		event = 'unknown';
		content = { body: fallback };
		needsNewerVersion = true;
	}

	// Never the server's `name`: it's an internal identifier, not display text
	const headline = nonEmptyString(raw.title)?.trim();

	const notification: GkNotification = {
		id: id,
		event: event,
		contentType: contentType,
		body: content.body,
		createdAt: createdAt,
	};
	if (headline) {
		notification.headline = headline;
	}
	const desktopMessage = isRecord(raw.payload) ? nonEmptyString(raw.payload.desktopMessage)?.trim() : undefined;
	// `fallback` is markdown (Desktop renders it as such), but a header is one line of plain text
	const fallbackText = nonEmptyString(raw.fallback);
	const summary = desktopMessage || (fallbackText != null ? toPlainText(fallbackText) : undefined);
	if (summary) {
		notification.summary = summary;
	}
	if (content.cta != null) {
		notification.cta = content.cta;
	}
	if (content.projectShared != null) {
		notification.projectShared = content.projectShared;
	}

	const readAt = parseTimestamp(raw.readAt);
	if (readAt != null) {
		notification.readAt = readAt;
	}

	const expiresAt = parseTimestamp(raw.expiresAt);
	if (expiresAt != null) {
		notification.expiresAt = expiresAt;
	}

	if (needsNewerVersion) {
		notification.needsNewerVersion = true;
	}

	return notification;
}

function parsePayload(event: NotificationEvent, payload: Record<string, unknown> | undefined): Content | undefined {
	if (payload == null) return undefined;

	switch (event) {
		case 'general': {
			const markdown = nonEmptyString(payload.markdown);
			return markdown != null ? { body: markdown } : undefined;
		}
		case 'callToAction': {
			const markdown = nonEmptyString(payload.markdown);
			const cta = isRecord(payload.callToAction) ? payload.callToAction : undefined;
			const text = nonEmptyString(cta?.text)?.trim();
			const url = nonEmptyString(cta?.link)?.trim();
			if (markdown == null || !text || !url || !isSafeExternalUrl(url)) return undefined;

			return { body: markdown, cta: { text: text, url: url } };
		}
		case 'projectShared': {
			const projectShared = parseProjectShared(payload);
			return projectShared != null ? { body: undefined, projectShared: projectShared } : undefined;
		}
		case 'nudge': {
			const metadata = isRecord(payload.metadata) ? payload.metadata : undefined;
			const message = nonEmptyString(metadata?.message);
			return message != null ? { body: message } : undefined;
		}
		default:
			return undefined;
	}
}

function parseProjectShared(payload: Record<string, unknown>): ProjectSharedDetails | undefined {
	const organization = nameOf(payload.organization);
	const owner = nameOf(payload.owner);
	const project = nameOf(payload.project);
	if (organization == null || owner == null || project == null) return undefined;

	const teams: string[] = [];
	if (Array.isArray(payload.teams)) {
		for (const team of payload.teams) {
			const name = nameOf(team);
			if (name != null) {
				teams.push(name);
			}
		}
	}

	return { organization: organization, owner: owner, project: project, teams: teams };
}

function nameOf(value: unknown): string | undefined {
	return isRecord(value) ? nonEmptyString(value.name)?.trim() : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value != null && !Array.isArray(value);
}

/** The string itself when it has non-whitespace content, otherwise `undefined`. */
function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** An ISO timestamp (or epoch ms) as epoch ms; `undefined` when absent or unparseable. */
function parseTimestamp(value: unknown): number | undefined {
	if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
	if (typeof value !== 'string' || !value) return undefined;

	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
}
