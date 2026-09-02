/** Relative-time formatting for commit dates, shared by every renderer. */

// Date formatting

/**
 * Lightweight relative-time formatter for commit dates. Consumers can override per-render
 * by passing a `formatDate` prop; otherwise this English-default is used. No i18n
 * dependency in the package — keeping the surface focused on the graph itself.
 */
export function relativeTime(date: number): string {
	if (!Number.isFinite(date)) return '';

	const diff = Date.now() - date;
	const minutes = Math.floor(diff / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes}m ago`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;

	const days = Math.floor(hours / 24);
	return `${days}d ago`;
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
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;

	const days = Math.floor(hours / 24);
	if (days < 7) return `${days}d`;
	if (days < 30) return `${Math.floor(days / 7)}w`;
	if (days < 365) return `${Math.floor(days / 30)}mo`;
	return `${Math.floor(days / 365)}y`;
}
