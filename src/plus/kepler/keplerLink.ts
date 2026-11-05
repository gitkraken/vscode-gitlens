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
	/**
	 * Which machine the link is for: `local`, or a VS Code remote authority such as `ssh-remote+devbox`.
	 * Kepler ignores one it can't match and falls back to its own routing.
	 */
	host?: string;
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
 * URL-encodes every value. The other routes Kepler exposes (`task/<uuid>`, `session/new`,
 * `session/<uuid>`) have no caller in GitLens (design doc §2); agent sessions use
 * {@link createKeplerSessionLink}'s parameter form instead.
 */
export function createKeplerTaskLink(scheme: string, options: KeplerTaskLinkOptions): string {
	const params: string[] = [];

	appendParam(params, 'url', options.url);
	appendParam(params, 'kind', options.kind);
	appendParam(params, 'provider', options.provider);
	appendParam(params, 'repo', options.repo);
	appendParam(params, 'action', options.action);
	appendParam(params, 'host', options.host);

	const query = params.join('&');
	return query ? `${scheme}task/new?${query}` : `${scheme}task/new`;
}

/**
 * Identifies an agent-native conversation for Kepler to open. Identity only — Kepler resolves (or
 * creates a task for) the conversation itself.
 */
export type KeplerSessionLinkOptions = {
	/** Kepler's adapter id for the agent (`claude-code`, `codex`, `copilot`, `opencode`) */
	agent: string;
	/** The agent-native session id — NOT a Kepler session id */
	id: string;
	/** An absolute path hint, on the machine `host` names, for finding the conversation on disk and the folder to bind */
	cwd?: string;
	/** Which machine the session is on — see {@link KeplerTaskLinkOptions.host} */
	host?: string;
};

/**
 * Builds a `<scheme>session?agent=...&id=...&cwd=...&host=...` deep link that asks Kepler to open an agent
 * session. The id rides as a parameter, never in the path — `session/<uuid>` means Kepler's own
 * session id. `cwd` and `host` are omitted when absent; every value is URL-encoded.
 */
export function createKeplerSessionLink(scheme: string, options: KeplerSessionLinkOptions): string {
	const params: string[] = [];

	appendParam(params, 'agent', options.agent);
	appendParam(params, 'id', options.id);
	appendParam(params, 'cwd', options.cwd);
	appendParam(params, 'host', options.host);

	return `${scheme}session?${params.join('&')}`;
}
