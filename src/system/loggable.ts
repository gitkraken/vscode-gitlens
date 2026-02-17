import { hrtime } from '@env/hrtime.js';
import { Logger } from './logger.js';
import type { ScopedLogger } from './logger.scope.js';
import { setLogScopeExit, startScopedLogger } from './logger.scope.js';
import { getDurationMilliseconds } from './string.js';

export class LoggableScope implements Disposable {
	private readonly scope: ScopedLogger & Disposable;
	private readonly start: [number, number];

	constructor(
		prefix: string,
		private readonly options?: { debug?: boolean; enter?: string },
	) {
		this.scope = startScopedLogger(prefix, true);
		this.start = hrtime();

		(options?.debug ? Logger.trace : Logger.debug).call(Logger, this.scope, options?.enter ?? '');
	}

	[Symbol.dispose](): void {
		const duration = getDurationMilliseconds(this.start);
		const timing = ` [${duration}ms]`;
		const exit = this.scope.exitFailed ?? 'completed';

		if (this.scope.exitFailed != null) {
			Logger.error(null, this.scope, `${exit}${this.scope.exitDetails ?? ''}${timing}`);
		} else {
			(this.options?.debug ? Logger.trace : Logger.debug).call(
				Logger,
				this.scope,
				`${exit}${this.scope.exitDetails ?? ''}${timing}`,
			);
		}

		this.scope[Symbol.dispose]();
	}

	setExit(details: string | undefined, failed?: string): void {
		setLogScopeExit(this.scope, details, failed);
	}

	error(ex: Error | unknown, message?: string, ...params: any[]): void {
		Logger.error(ex, this.scope, message, ...params);
	}

	log(message: string, ...params: any[]): void {
		(this.options?.debug ? Logger.trace : Logger.debug).call(Logger, this.scope, message, ...params);
	}

	warn(message: string, ...params: any[]): void {
		Logger.warn(this.scope, message, ...params);
	}
}

export function maybeStartLoggableScope(
	prefix: string,
	options?: { debug?: boolean; enter?: string },
): LoggableScope | undefined {
	return Logger.enabled('error') ? new LoggableScope(prefix, options) : undefined;
}
