/* oxlint-disable typescript/no-unsafe-return */
import { getCurrentScope } from '#env/logScope.js';
import { getParameters } from '../function.js';
import { getDurationMilliseconds, hrtime } from '../hrtime.js';
import type { LogLevel } from '../logger.js';
import { customLoggableNameFns, getLoggableName, Logger } from '../logger.js';
import type { ScopedLogger } from '../logger.scoped.js';
import { createLogScope, getLoggableScopeBlock, logScopeIdGenerator, runInScope } from '../logger.scoped.js';
import { isPromise } from '../promise.js';

export const defaultSlowCallWarningThreshold = 1500;

export interface LogContext {
	id: number;
	instance: any;
	instanceName: string;
	name: string;
	prefix: string;
}

interface LogOptions<T extends (...args: any[]) => any> {
	/** Controls parameter formatting in log output. `false` suppresses all params. A function receives the method args and returns named fields to log (or `false` to suppress). When omitted, params are auto-formatted from parameter names. */
	args?: false | ((...args: Parameters<T>) => Record<string, unknown> | false);
	/** Conditionally skips logging entirely (scope, timing, everything). Must use a `function` expression (not arrow) — `this` is bound to the class instance via `.apply()`. Annotate `this` with the class type for type safety. */
	when?(this: unknown, ...args: Parameters<T>): boolean;
	/** Controls exit/result logging. `true` logs the return value. A function receives the result and returns a custom exit string. */
	exit?: ((result: PromiseType<ReturnType<T>>) => string) | true;
	/** Overrides the log line prefix. Receives a {@link LogContext} and the method args. */
	prefix?(context: LogContext, ...args: Parameters<T>): string;
	/** Suppresses the entry log line and only logs on exit. `{ after: N }` further suppresses exit unless duration exceeds N ms, the call ran slow, or it failed. */
	onlyExit?: true | { after: number };
	/** Marks a read whose only work worth logging shows up as lines of its own (e.g. git commands) and that changes no state silently. When the logger sets `quietCallsUnder`, it writes no entry line up front, and logs only if it took that long, failed, ran slow, or something was logged while it ran. */
	quiet?: true;
	/** Controls duration timing. `false` disables timing. `{ warnAfter: N }` overrides the slow call warning threshold (default 500ms). */
	timing?: boolean | { warnAfter: number };
}

// Using Function type to support classes with private/protected constructors
// oxlint-disable-next-line typescript/no-unsafe-function-type
export function logName<T>(fn: (c: T, name: string) => string): (target: Function & { prototype: T }) => void {
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	return (target: (abstract new (...args: any[]) => T) | (Function & { prototype: T })): void =>
		void customLoggableNameFns.set(target, fn);
}

/**
 * Class decorator that adds a `toLoggable()` method to the prototype at runtime,
 * making instances compatible with the `Loggable` interface without requiring the
 * method to appear in the class's structural type.
 *
 * @param fn Optional function returning the content inside the parentheses.
 * Defaults to `id` if the instance has one, otherwise just `ClassName`.
 */
export function loggable<T extends object>(fn?: (instance: T) => string) {
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	return (target: (abstract new (...args: any[]) => T) | (Function & { prototype: T })): void => {
		target.prototype.toLoggable = function (this: T): string {
			const name = getLoggableName(this);
			if (fn != null) return `${name}(${fn(this)})`;
			return name;
		};
	};
}

export function info<T extends (...arg: any[]) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('info', options);
}

export function debug<T extends (...arg: any[]) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('debug', options);
}

export function trace<T extends (...arg: any[]) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('trace', options);
}

type PromiseType<T> = T extends Promise<infer U> ? U : T;

function log<T extends (...arg: any[]) => any>(
	logLevel: Exclude<LogLevel, 'off' | 'error' | 'warn'>,
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	let argsFn: LogOptions<T>['args'] | undefined;
	let whenFn: LogOptions<T>['when'] | undefined;
	let exitFn: LogOptions<T>['exit'] | undefined;
	let prefixFn: LogOptions<T>['prefix'] | undefined;
	let onlyExit: NonNullable<LogOptions<T>['onlyExit']> | false = false;
	let timing: NonNullable<LogOptions<T>['timing']> = true;
	let quiet = false;
	if (options != null) {
		({
			args: argsFn,
			when: whenFn,
			exit: exitFn,
			prefix: prefixFn,
			onlyExit = false,
			timing = true,
			quiet = false,
		} = options);
	}

	const slowThreshold = typeof timing === 'object' ? timing.warnAfter : defaultSlowCallWarningThreshold;
	const timed = timing !== false || (typeof onlyExit === 'object' && onlyExit.after > 0);

	const logFn: (message: string, ...params: any[]) => void =
		logLevel === 'trace' ? Logger.trace : logLevel === 'debug' ? Logger.debug : Logger.info;

	return (_target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>) => {
		// oxlint-disable-next-line typescript/no-unsafe-function-type
		let fn: Function | undefined;
		let fnKey: string | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
			fnKey = 'value';
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
			fnKey = 'get';
		}
		if (fn == null || fnKey == null) throw new Error('Not supported');

		// Only extract parameter names for default formatting (when no args option provided)
		const parameters = argsFn == null ? getParameters(fn) : [];

		descriptor[fnKey] = function (this: any, ...args: Parameters<T>) {
			// Always create scope unless logging is completely off (or condition fails)
			// This ensures scope is available for error logging even at lower log levels
			if (!Logger.enabled() || (whenFn != null && !whenFn.apply(this, args))) {
				return fn.apply(this, args);
			}

			const shouldLog = Logger.enabled(logLevel);
			const quietUnder = quiet ? Logger.quietCallsUnder : undefined;
			const exitOnly = onlyExit !== false || quietUnder != null;

			const parentScope = getCurrentScope();
			const prevScopeId = parentScope?.scopeId;
			const scopeId = logScopeIdGenerator.next();

			// A quieted call builds its default prefix on first use, since it usually writes nothing. Any other call, and any
			// custom prefix, is built before the call runs, so it reflects state as it was when the call started
			let prefix: string | (() => string);
			if (prefixFn != null) {
				const instanceName = this != null ? getLoggableName(this) : undefined;
				prefix = prefixFn(
					{
						id: scopeId,
						instance: this,
						instanceName: instanceName ?? '',
						name: key,
						prefix: formatPrefix(instanceName, key, scopeId, prevScopeId),
					},
					...args,
				);
			} else {
				prefix = lazyPrefix(this, key, scopeId, prevScopeId);
				if (quietUnder == null) {
					prefix = prefix();
				}
			}

			// Lazy parameter formatting — deferred until first use to avoid
			// expensive Logger.toLoggable() calls when the log won't be emitted
			let loggableParams: string | undefined;
			let paramsResolved = false;
			const resolveParams = (): string | undefined => {
				if (!paramsResolved) {
					paramsResolved = true;
					loggableParams = formatParams(argsFn, args, parameters);
				}
				return loggableParams;
			};

			const start = timed || quietUnder != null ? hrtime() : undefined;

			// A quieted call has no entry line, so when a line is first written inside it (e.g. a git command), it writes
			// its entry then, ahead of that line, so the log still shows the cause before what it caused
			const writeLateEntry =
				quietUnder != null && shouldLog
					? (scope: ScopedLogger) => {
							const params = resolveParams();
							const started = ` \u00b7 started ${getDurationMilliseconds(start!)}ms earlier`;
							logFn.call(
								Logger,
								params ? `${scope.prefix}(${params})${started}` : `${scope.prefix}${started}`,
							);
						}
					: undefined;

			const scope = createLogScope(scopeId, prevScopeId, prefix, parentScope, writeLateEntry);

			if (!exitOnly && shouldLog) {
				const params = resolveParams();
				logFn.call(Logger, params ? `${scope.prefix}(${params})` : scope.prefix);
			}

			if (exitOnly || timed || exitFn != null) {
				// An async exit can run outside this call's scope (the browser tracks scope only synchronously), so the
				// exit line marks the call directly rather than relying on the current scope. The call has returned, so
				// this marks only its callers: it writes no late entry of its own just ahead of its exit line
				const markLogged = (level: Exclude<LogLevel, 'off'>) => Logger.markLogged(level, scope);

				const logError = (ex: unknown) => {
					scope.exited();
					const duration = timed ? ` [${getDurationMilliseconds(start!)}ms]` : '';
					const exitInfo = scope.getExitInfo();
					// With no entry line, the exit line carries the arguments
					const params = exitOnly ? resolveParams() : undefined;
					markLogged('error');
					Logger.error(
						ex,
						params ? `${scope.prefix}(${params})` : scope.prefix,
						exitInfo?.details ? `failed${exitInfo.details}${duration}` : `failed${duration}`,
					);
				};

				const logResult = (r: any) => {
					scope.exited();
					const duration = start != null ? getDurationMilliseconds(start) : undefined;
					const slow = timed && duration! > slowThreshold;
					const exitInfo = scope.getExitInfo();
					const failed = exitFn == null && exitInfo.failed != null;

					// Slow and failed calls always log (at warn and error); anything else only when this level is
					// logged, and then only if the quiet-calls policy or `onlyExit.after` doesn't drop it
					if (!slow && exitInfo.failed == null) {
						if (!shouldLog) return;

						const belowAfter =
							typeof onlyExit === 'object' && onlyExit.after > 0 && duration! <= onlyExit.after;
						if (quietUnder != null) {
							if (!scope.logged && (duration! < quietUnder || belowAfter)) return;
						} else if (belowAfter) {
							return;
						}
					}

					let exitLogFn: (message: string, ...params: any[]) => void = slow ? Logger.warn : logFn;
					let exit;
					if (exitFn != null) {
						if (typeof exitFn === 'function') {
							try {
								exit = exitFn(r);
							} catch (ex) {
								exit = `@log.exit error: ${ex}`;
							}
						} else if (exitFn === true) {
							exit = `returned ${Logger.toLoggable(r)}`;
						}
					} else if (failed) {
						exit = exitInfo.failed;
						exitLogFn = (message: string, ...params: any[]) => Logger.error(null, message, ...params);
					} else {
						exit = 'completed';
					}

					const durationSuffix = !timed ? '' : slow ? ` [*${duration}ms] (slow)` : ` [${duration}ms]`;
					const params = resolveParams();
					markLogged(slow ? 'warn' : failed ? 'error' : logLevel);
					exitLogFn.call(
						Logger,
						params
							? `${scope.prefix}(${params}) ${exit}${exitInfo.details || ''}${durationSuffix}`
							: `${scope.prefix} ${exit}${exitInfo.details || ''}${durationSuffix}`,
					);
				};

				const execute = () => {
					let result;
					try {
						result = fn.apply(this, args);
					} catch (ex) {
						logError(ex);
						throw ex;
					}

					if (result != null && isPromise(result)) {
						void result.then(logResult, logError).catch(() => {});
					} else {
						logResult(result);
					}

					return result;
				};

				// Run within scope context
				return runInScope(scope, execute);
			}

			return runInScope(scope, () => fn.apply(this, args));
		};
	};
}

/** Kept outside the decorated call so the scope, which can outlive the call, doesn't hold on to its arguments */
function lazyPrefix(instance: unknown, key: string, scopeId: number, prevScopeId: number | undefined): () => string {
	return () => formatPrefix(instance != null ? getLoggableName(instance) : undefined, key, scopeId, prevScopeId);
}

function formatPrefix(
	instanceName: string | undefined,
	key: string,
	scopeId: number,
	prevScopeId: number | undefined,
): string {
	return instanceName
		? `${getLoggableScopeBlock(scopeId, prevScopeId)} ${instanceName}.${key}`
		: `${getLoggableScopeBlock(scopeId, prevScopeId)} ${key}`;
}

function formatParams<T extends (...args: any[]) => any>(
	argsFn: LogOptions<T>['args'] | undefined,
	args: Parameters<T>,
	parameters: string[],
): string | undefined {
	if (argsFn === false || !args.length) return undefined;

	// Function form: call it and format the returned Record
	if (typeof argsFn === 'function') {
		const result = argsFn(...args);
		if (result === false) return undefined;

		let formatted = '';
		for (const [name, value] of Object.entries(result)) {
			if (formatted.length) {
				formatted += ', ';
			}
			formatted += `${name}=${Logger.toLoggable(value, name)}`;
		}
		return formatted || undefined;
	}

	// Default: use parameter names from getParameters()
	let formatted = '';
	let paramIndex = -1;
	for (const paramValue of args as unknown[]) {
		const paramName = parameters[++paramIndex];
		if (formatted.length) {
			formatted += ', ';
		}
		formatted += paramName
			? `${paramName}=${Logger.toLoggable(paramValue, paramName)}`
			: Logger.toLoggable(paramValue);
	}
	return formatted || undefined;
}
