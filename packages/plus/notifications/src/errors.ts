/**
 * A failed request to the notifications service: a non-2xx response, or a 2xx one whose body isn't valid JSON
 * (e.g. an HTML error page from a proxy). The message is for logs, not for display.
 */
export class NotificationsApiError extends Error {
	static is(ex: unknown): ex is NotificationsApiError {
		return ex instanceof NotificationsApiError;
	}

	constructor(
		readonly status: number,
		readonly operation: string,
		reason?: string,
		options?: ErrorOptions,
	) {
		super(`Notifications request '${operation}' failed: ${status}${reason ? ` ${reason}` : ''}`, options);
		this.name = 'NotificationsApiError';
	}
}
