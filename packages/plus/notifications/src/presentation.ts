import type { GkNotification, NotificationContentType } from './models.js';

export type NotificationCategoryChip = 'help' | 'offer' | 'security' | 'system';

/** The category chip shown on a notification card; `feature` notifications get none. */
export function getCategoryChip(contentType: NotificationContentType): NotificationCategoryChip | undefined {
	switch (contentType) {
		case 'help':
			return 'help';
		case 'marketing':
			return 'offer';
		case 'security':
			return 'security';
		case 'system':
			return 'system';
		default:
			return undefined;
	}
}

/** Only security and system notices may interrupt with a toast; everything else arrives quietly. */
export function isToastEligible(notification: Pick<GkNotification, 'contentType'>): boolean {
	return notification.contentType === 'security' || notification.contentType === 'system';
}

/**
 * Server-supplied links may only open `https:` URLs (never `command:`, `javascript:`, `file:`, ...). Deliberately
 * stricter than the inline-link policy for untrusted markdown (`getUntrustedLinkHref`, which also allows `http:`
 * and `mailto:`): a call-to-action is a prominent, single-click action.
 */
export function isSafeExternalUrl(url: string): boolean {
	if (!URL.canParse(url)) return false;

	return new URL(url).protocol === 'https:';
}

export function formatUnreadCount(count: number): string {
	return count > 99 ? '99+' : String(count);
}

/**
 * The body to show under a notification's headline. Service-generated notices often open their body with the
 * headline itself (`jane@acme.dev has requested to join _Acme_. …`), so a first paragraph that only repeats the
 * headline (ignoring markdown emphasis/code markers, whitespace and a trailing period) is dropped. Only the
 * first paragraph is ever dropped; `undefined` when nothing remains.
 */
export function getDisplayBody(headline: string | undefined, body: string | undefined): string | undefined {
	const trimmed = body?.trim();
	if (!trimmed) return undefined;
	if (!headline) return trimmed;

	const [first, ...rest] = trimmed.split(/\n\s*\n/);
	if (normalizeForComparison(first) !== normalizeForComparison(headline)) return trimmed;

	return rest.join('\n\n').trim() || undefined;
}

function normalizeForComparison(text: string): string {
	return text.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

/**
 * A best-effort conversion of markdown to a single line of plain text, for headers that cannot render markdown.
 * Not a parser: it handles the common inline and line-start constructs and leaves anything exotic as-is.
 */
export function toPlainText(markdown: string): string {
	return (
		markdown
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/<[^>]*>/g, ' ')
			.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+|\d+\.[ \t]+)/gm, '')
			// Emphasis markers only at word edges, so `snake_case` names keep their underscores
			.replace(/(?<!\w)[*_]+|[*_]+(?!\w)/g, '')
			.replace(/`|~~/g, '')
			.replace(/\s+/g, ' ')
			.trim()
	);
}
