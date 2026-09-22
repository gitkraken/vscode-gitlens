import type { KeplerProviderId } from './keplerProviders.js';

/**
 * Everything the caller can hand Kepler to pre-fill its Task Composer. All fields are optional and
 * are omitted from the built URL entirely when absent — a bad or missing value still opens the
 * Composer with less filled in, never a broken link (design doc §2).
 *
 * The caller supplies the keys, Kepler resolves the values: send identity, never titles, state,
 * authorship, or a prompt.
 */
export type KeplerTaskLinkOptions = {
	url?: string;
	kind?: 'pr' | 'issue';
	provider?: KeplerProviderId;
	/** An absolute local path, or another selector Kepler's `repo=` accepts (design doc §7). */
	repo?: string;
	action?: string;
};

function appendParam(params: string[], key: string, value: string | undefined): void {
	if (!value) return;

	params.push(`${key}=${encodeURIComponent(value)}`);
}

/**
 * Builds a `<scheme>task/new?...` deep link into Kepler's Task Composer. `scheme` comes from
 * `KeplerService.scheme` (e.g. `'kepler://'` or `'kepler-staging://'`).
 *
 * Emits the canonical lowercase, no-trailing-slash route — `task/new`, never `task/new/` — and
 * URL-encodes every value. v1 scope is `task/new` only; the other three routes Kepler exposes
 * (`task/<uuid>`, `session/new`, `session/<uuid>`) have no caller in GitLens (design doc §2).
 */
export function createKeplerTaskLink(scheme: string, options: KeplerTaskLinkOptions): string {
	const params: string[] = [];

	appendParam(params, 'url', options.url);
	appendParam(params, 'kind', options.kind);
	appendParam(params, 'provider', options.provider);
	appendParam(params, 'repo', options.repo);
	appendParam(params, 'action', options.action);

	const query = params.join('&');
	return query ? `${scheme}task/new?${query}` : `${scheme}task/new`;
}
