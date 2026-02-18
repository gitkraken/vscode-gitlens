/* eslint-disable @typescript-eslint/no-unsafe-return */
import { hrtime } from '@env/hrtime.js';
import { getParameters } from '../function.js';
import type { LogLevel } from '../logger.constants.js';
import { slowCallWarningThreshold as defaultSlowCallWarningThreshold } from '../logger.constants.js';
import { customLoggableNameFns, getLoggableName, Logger } from '../logger.js';
import {
	createLogScope,
	getLoggableScopeBlock,
	getScopedLogger,
	logScopeIdGenerator,
	runInScope,
} from '../logger.scope.js';
import { isPromise } from '../promise.js';
import { getDurationMilliseconds } from '../string.js';

export interface LogContext {
	id: number;
	instance: any;
	instanceName: string;
	name: string;
	prefix: string;
}

interface LogOptions<T extends (...arg: any) => any> {
	/** Controls parameter formatting in log output. `false` suppresses all params. A function receives the method args and returns named fields to log (or `false` to suppress). When omitted, params are auto-formatted from parameter names. */
	args?: false | ((...args: Parameters<T>) => Record<string, unknown> | false);
	/** Conditionally skips logging entirely (scope, timing, everything). Must use a `function` expression (not arrow) — `this` is bound to the class instance via `.apply()`. Annotate `this` with the class type for type safety. */
	when?(this: unknown, ...args: Parameters<T>): boolean;
	/** Controls exit/result logging. `true` logs the return value. A function receives the result and returns a custom exit string. */
	exit?: ((result: PromiseType<ReturnType<T>>) => string) | true;
	/** Overrides the log line prefix. Receives a {@link LogContext} and the method args. */
	prefix?(context: LogContext, ...args: Parameters<T>): string;
	/** Suppresses the entry log line and only logs on exit. `{ after: N }` further suppresses exit unless duration exceeds N ms. */
	onlyExit?: true | { after: number };
	/** Controls duration timing. `false` disables timing. `{ warnAfter: N }` overrides the slow call warning threshold (default 500ms). */
	timing?: boolean | { warnAfter: number };
}

// Using Function type to support classes with private/protected constructors
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function logName<T>(fn: (c: T, name: string) => string): (target: Function & { prototype: T }) => void {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	return (target: (abstract new (...args: any[]) => T) | (Function & { prototype: T })): void => {
		target.prototype.toLoggable = function (this: T): string {
			const name = getLoggableName(this);
			if (fn != null) return `${name}(${fn(this)})`;
			return name;
		};
	};
}

export function info<T extends (...arg: any) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('info', options);
}

export function debug<T extends (...arg: any) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('debug', options);
}

export function trace<T extends (...arg: any) => any>(
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return log<T>('trace', options);
}

type PromiseType<T> = T extends Promise<infer U> ? U : T;

function log<T extends (...arg: any) => any>(
	logLevel: Exclude<LogLevel, 'off' | 'error' | 'warn'>,
	options?: LogOptions<T>,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	let argsFn: LogOptions<T>['args'] | undefined;
	let whenFn: LogOptions<T>['when'] | undefined;
	let exitFn: LogOptions<T>['exit'] | undefined;
	let prefixFn: LogOptions<T>['prefix'] | undefined;
	let onlyExit: NonNullable<LogOptions<T>['onlyExit']> | false = false;
	let timing: NonNullable<LogOptions<T>['timing']> = true;
	if (options != null) {
		({ args: argsFn, when: whenFn, exit: exitFn, prefix: prefixFn, onlyExit = false, timing = true } = options);
	}

	const slowThreshold = typeof timing === 'object' ? timing.warnAfter : defaultSlowCallWarningThreshold;
	const timed = timing !== false || (typeof onlyExit === 'object' && onlyExit.after > 0);

	const logFn: (message: string, ...params: any[]) => void =
		logLevel === 'trace' ? Logger.trace : logLevel === 'debug' ? Logger.debug : Logger.info;

	return (_target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>) => {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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

			// Get parent scope
			const parentScope = getScopedLogger();
			const prevScopeId = parentScope?.scopeId;
			const scopeId = logScopeIdGenerator.next();

			const instanceName = this != null ? getLoggableName(this) : undefined;

			let prefix = instanceName
				? `${getLoggableScopeBlock(scopeId, prevScopeId)} ${instanceName}.${key}`
				: `${getLoggableScopeBlock(scopeId, prevScopeId)} ${key}`;

			if (prefixFn != null) {
				prefix = prefixFn(
					{
						id: scopeId,
						instance: this,
						instanceName: instanceName ?? '',
						name: key,
						prefix: prefix,
					},
					...args,
				);
			}

			const scope = createLogScope(scopeId, prevScopeId, prefix);

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

			// For non-onlyExit mode, log entry immediately
			if (!onlyExit && shouldLog) {
				const params = resolveParams();
				logFn.call(Logger, params ? `${prefix}(${params})` : prefix);
			}

			if (onlyExit || timed || exitFn != null) {
				const start = timed ? hrtime() : undefined;

				const logError = (ex: unknown) => {
					const duration = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
					const exitInfo = scope.getExitInfo();
					if (onlyExit) {
						const params = resolveParams();
						Logger.error(
							ex,
							params ? `${prefix}(${params})` : prefix,
							exitInfo?.details ? `failed${exitInfo.details}${duration}` : `failed${duration}`,
						);
					} else {
						Logger.error(
							ex,
							prefix,
							exitInfo?.details ? `failed${exitInfo.details}${duration}` : `failed${duration}`,
						);
					}
				};

				const logResult = (r: any) => {
					let duration: number | undefined;
					let exitLogFn: typeof logFn;
					let durationSuffix;
					if (start != null) {
						duration = getDurationMilliseconds(start);
						if (duration > slowThreshold) {
							exitLogFn = Logger.warn;
							durationSuffix = ` [*${duration}ms] (slow)`;
						} else {
							exitLogFn = logFn;
							durationSuffix = ` [${duration}ms]`;
						}
					} else {
						durationSuffix = '';
						exitLogFn = logFn;
					}

					const exitInfo = scope.getExitInfo();
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
					} else if (exitInfo?.failed) {
						exit = exitInfo.failed;
						exitLogFn = (message: string, ...params: any[]) => Logger.error(null, message, ...params);
					} else {
						exit = 'completed';
					}

					// Only log if: logging at this level, or slow call warning, or error
					if (shouldLog || exitLogFn !== logFn) {
						const params = resolveParams();
						if (onlyExit) {
							if (onlyExit === true || onlyExit.after === 0 || duration! > onlyExit.after) {
								exitLogFn.call(
									Logger,
									params
										? `${prefix}(${params}) ${exit}${exitInfo?.details || ''}${durationSuffix}`
										: `${prefix} ${exit}${exitInfo?.details || ''}${durationSuffix}`,
								);
							}
						} else {
							exitLogFn.call(
								Logger,
								params
									? `${prefix}(${params}) ${exit}${exitInfo?.details || ''}${durationSuffix}`
									: `${prefix} ${exit}${exitInfo?.details || ''}${durationSuffix}`,
							);
						}
					}
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
						result.then(logResult, logError);
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

function formatParams<T extends (...arg: any) => any>(
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
