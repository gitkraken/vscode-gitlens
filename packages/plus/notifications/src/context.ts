/**
 * Optional diagnostics sink. The package never logs on its own; the host routes these to its logger.
 */
export interface NotificationsLogger {
	debug?(message: string): void;
	warn?(message: string): void;
	error?(ex: unknown, message?: string): void;
}

/**
 * Everything the notifications package needs from its host. The package cannot import `vscode` or reach
 * into the extension host, so the only way it talks to the outside world is through this context.
 */
export interface NotificationsContext {
	/** The `productType` the notifications service filters by, e.g. `gitlens`. The package never hardcodes one. */
	readonly productType: string;
	/**
	 * Authenticated request against the GK cloud API. `path` is relative to the API root, has no leading slash
	 * and never carries a query string, e.g. `v1/notifications`; any query comes separately in `query`. A non-2xx
	 * response is returned, not thrown.
	 */
	fetchGkApi(path: string, init?: RequestInit, query?: URLSearchParams): Promise<Response>;
	/** Current time in ms since the epoch; a test seam that defaults to `Date.now()`. */
	now?(): number;
	readonly log?: NotificationsLogger;
}
