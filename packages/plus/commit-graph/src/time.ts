/** Relative-time formatting for commit dates, shared by every renderer. */

import * as l10n from '@vscode/l10n';

// Date formatting

/**
 * Lightweight relative-time formatter for commit dates. Consumers can override per-render
 * by passing a `formatDate` prop; otherwise a localized relative format is used.
 */
export function relativeTime(date: number): string {
	if (!Number.isFinite(date)) return '';

	const diff = Date.now() - date;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return l10n.t('just now');
	if (minutes < 60) return l10n.t('{0}m ago', minutes);

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return l10n.t('{0}h ago', hours);

	const days = Math.floor(hours / 24);
	return l10n.t('{0}d ago', days);
}

/**
 * Ultra-compact relative-time formatter ("5m", "3h", "2d", "4w", "6mo", "1y") used when the
 * date column is too narrow for the verbose "N days ago" form. No "ago" suffix — the column
 * header already labels the column as a date, so the bare magnitude reads cleanly.
 *
 * Pass `now` to make the result deterministic — a test that pins it, a snapshot, or a host that
 * keeps its own clock. Omitted, it reads the wall clock, which is what a live renderer wants.
 */
export function relativeTimeShort(date: number, now: number = Date.now()): string {
	if (!Number.isFinite(date)) return '';

	const diff = now - date;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return l10n.t('now');
	if (minutes < 60) return l10n.t('{0}m', minutes);

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return l10n.t('{0}h', hours);

	const days = Math.floor(hours / 24);
	if (days < 7) return l10n.t('{0}d', days);
	if (days < 30) return l10n.t('{0}w', Math.floor(days / 7));
	if (days < 365) return l10n.t('{0}mo', Math.floor(days / 30));
	return l10n.t('{0}y', Math.floor(days / 365));
}
