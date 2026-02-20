import { hrtime } from '@env/hrtime.js';
import { enterScope, exitScope, getCurrentScope, runInScope } from '@env/logScope.js';
import { getScopedCounter } from './counter.js';
import type { LogLevel } from './logger.constants.js';
import { Logger } from './logger.js';
import { getDurationMilliseconds } from './string.js';

/**
 * Runs a function within a log scope context.
 * In Node.js, the scope will be available via getScopedLogger() throughout async execution.
 * In browser, the scope is tracked best-effort.
 */
export { runInScope };

export const logScopeIdGenerator = getScopedCounter();

export interface ScopedLogger {
	readonly scopeId?: number;
	readonly prevScopeId?: number;
	readonly prefix: string;

	enabled(level: Exclude<LogLevel, 'off'>): boolean;

	trace(message: string, ...params: any[]): void;
	debug(message: string, ...params: any[]): void;
	info(message: string, ...params: any[]): void;
	warn(message: string, ...params: any[]): void;
	error(ex: Error | unknown, message?: string, ...params: any[]): void;

	/** Adds exit details for this scope. Details are automatically prefixed with ' • ' and accumulate. */
	addExitInfo(...details: string[]): void;
	/** Sets the failure reason for this scope. Overwrites any previous failure. */
	setFailed(reason: string): void;

	/** @internal Returns exit info for logging - used internally by the @log decorator */
	getExitInfo(): { details: string | undefined; failed: string | undefined };
}

export function createLogScope(scopeId: number, prevScopeId: number | undefined, prefix: string): ScopedLogger {
	let exitDetails: string[] | undefined;
	let exitFailed: string | undefined;

	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	const scope: ScopedLogger = {
		scopeId: scopeId,
		prevScopeId: prevScopeId,
		prefix: prefix,
		enabled: Logger.enabled,
		addExitInfo: function (...details: string[]): void {
			(exitDetails ??= []).push(...details);
		},
		setFailed: function (reason: string): void {
			exitFailed = reason;
		},

		getExitInfo: function () {
			return {
				details: exitDetails?.length ? ` \u2022 ${exitDetails.join(', ')}` : undefined,
				failed: exitFailed,
			};
		},
	} as ScopedLogger;

	// Lazy bind - getter replaces itself with bound function on first access
	defineLazyBoundMethod(scope, 'trace', Logger.trace);
	defineLazyBoundMethod(scope, 'debug', Logger.debug);
	defineLazyBoundMethod(scope, 'info', Logger.info);
	defineLazyBoundMethod(scope, 'warn', Logger.warn);
	defineLazyBoundErrorMethod(scope);

	return scope;
}

function defineLazyBoundMethod<K extends 'trace' | 'debug' | 'info' | 'warn'>(
	scope: ScopedLogger,
	name: K,
	method: (typeof Logger)[K],
): void {
	Object.defineProperty(scope, name, {
		configurable: true,
		enumerable: true,
		get: function () {
			const bound = method.bind(Logger, scope);
			Object.defineProperty(scope, name, { value: bound, writable: false, enumerable: true });
			return bound;
		},
	});
}

function defineLazyBoundErrorMethod(scope: ScopedLogger): void {
	Object.defineProperty(scope, 'error', {
		configurable: true,
		enumerable: true,
		get: function () {
			const bound = (ex: Error | unknown, message?: string, ...params: any[]) =>
				Logger.error(ex, scope, message, ...params);
			Object.defineProperty(scope, 'error', { value: bound, writable: false, enumerable: true });
			return bound;
		},
	});
}

export function formatLoggableScopeBlock(prefix: string, suffix?: string): string {
	if (suffix == null) return `[${prefix.padEnd(13)}]`;

	return `[${prefix}${suffix.padStart(13 - prefix.length)}]`;
}

export function getLoggableScopeBlock(scopeId: number, prevScopeId?: number, label?: string): string {
	if (label != null) {
		const suffix =
			prevScopeId == null ? scopeId.toString(16) : `${prevScopeId.toString(16)} \u2192 ${scopeId.toString(16)}`;
		return formatLoggableScopeBlock(label, suffix);
	}

	return prevScopeId == null
		? `[${scopeId.toString(16).padStart(13)}]`
		: `[${prevScopeId.toString(16).padStart(5)} \u2192 ${scopeId.toString(16).padStart(5)}]`;
}

/** Gets the current log scope */
export function getScopedLogger(): (ScopedLogger & Disposable) | undefined {
	const scope = getCurrentScope();
	if (scope == null) return undefined;

	// Return a prototype wrapper with a no-op dispose so `using` won't exit a parent's scope
	const wrapper = Object.create(scope) as ScopedLogger & Disposable;
	wrapper[Symbol.dispose] = () => {};
	return wrapper;
}

export function getNewLogScope(
	prefix: string,
	scope: ScopedLogger | boolean | undefined,
	label?: string,
): ScopedLogger {
	if (scope != null && typeof scope !== 'boolean') {
		return createLogScope(scope.scopeId!, scope.prevScopeId, `${scope.prefix}${prefix}`);
	}

	const prevScopeId = scope ? getCurrentScope()?.scopeId : undefined;
	const scopeId = logScopeIdGenerator.next();
	return createLogScope(scopeId, prevScopeId, `${getLoggableScopeBlock(scopeId, prevScopeId, label)} ${prefix}`);
}

/** Starts a scoped logger for use with the `using` keyword */
function startScopedLogger(
	prefix: string,
	scope: ScopedLogger | boolean | undefined,
	label?: string,
): ScopedLogger & Disposable {
	const prevScope = getCurrentScope();
	const newScope = getNewLogScope(prefix, scope, label) as ScopedLogger & Disposable;
	enterScope(newScope);

	// Add dispose method directly to preserve lazy-bound logger methods
	newScope[Symbol.dispose] = () => {
		exitScope(prevScope, newScope);
	};

	return newScope;
}

/**
 * Creates a scoped logger for standalone functions and code blocks
 * Returns `undefined` when all logging is disabled
 *
 * This is the non-decorator equivalent of `@log()` for standalone functions,
 * callbacks, and code blocks. Supports the `using` keyword for automatic cleanup.
 *
 * @param prefix - The log prefix (typically `ClassName.methodName`)
 * @param log - Controls automatic entry/exit logging with timing:
 *   - omitted/falsy: scope tracking only (no auto-logging)
 *   - `true`: auto entry + exit with timing at debug level
 *   - `{ level?, message?, onlyExit? }`: fine-grained control
 */
export function maybeStartLoggableScope(
	prefix: string,
	log?: boolean | { level?: Exclude<LogLevel, 'off' | 'error' | 'warn'>; message?: string; onlyExit?: true },
	scopeLabel?: string,
): (ScopedLogger & Disposable) | undefined {
	if (!Logger.enabled()) return undefined;

	const scope = startScopedLogger(prefix, true, scopeLabel);

	if (!log) return scope;

	let level: Exclude<LogLevel, 'off' | 'error' | 'warn'> = 'debug';
	let message: string | undefined;
	let onlyExit = false;
	if (typeof log === 'object') {
		level = log.level ?? level;
		message = log.message;
		onlyExit = log.onlyExit === true;
	}

	const start = hrtime();

	if (!onlyExit) {
		logAtLevel(scope, level, message ?? '');
	}

	const origDispose = scope[Symbol.dispose];
	scope[Symbol.dispose] = () => {
		const duration = getDurationMilliseconds(start);
		const timing = ` [${duration}ms]`;
		const exitInfo = scope.getExitInfo();
		const exit = exitInfo.failed ?? 'completed';

		if (exitInfo.failed != null) {
			Logger.error(null, scope, `${exit}${exitInfo.details ?? ''}${timing}`);
		} else {
			logAtLevel(scope, level, `${exit}${exitInfo.details ?? ''}${timing}`);
		}

		origDispose();
	};

	return scope;
}

function logAtLevel(
	scope: ScopedLogger,
	level: Exclude<LogLevel, 'off' | 'error' | 'warn'>,
	message: string,
	...params: any[]
): void {
	switch (level) {
		case 'trace':
			Logger.trace(scope, message, ...params);
			break;
		case 'info':
			Logger.info(scope, message, ...params);
			break;
		case 'debug':
		default:
			Logger.debug(scope, message, ...params);
	}
}
