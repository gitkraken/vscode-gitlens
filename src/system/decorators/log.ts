import { hrtime } from '@env/hrtime';
import { LogCorrelationContext, Logger, LogLevel } from '../../logger';
import { filterMap } from '../array';
import { getParameters } from '../function';
import { isPromise } from '../promise';
import { getDurationMilliseconds } from '../string';

const emptyStr = '';

const correlationContext = new Map<number, LogCorrelationContext>();
let correlationCounter = 0;

export function getCorrelationContext() {
	return correlationContext.get(correlationCounter);
}

export function getCorrelationId() {
	return correlationCounter;
}

export function getNextCorrelationId() {
	if (correlationCounter === Number.MAX_SAFE_INTEGER) {
		correlationCounter = 0;
	}
	return ++correlationCounter;
}

function clearCorrelationContext(correlationId: number) {
	correlationContext.delete(correlationId);
}

function setCorrelationContext(correlationId: number, context: LogCorrelationContext) {
	correlationContext.set(correlationId, context);
}

export interface LogContext {
	id: number;
	instance: any;
	instanceName: string;
	name: string;
	prefix: string;
}

export const LogInstanceNameFn = Symbol('logInstanceNameFn');

export function logName<T>(fn: (c: T, name: string) => string) {
	return (target: Function) => {
		(target as any)[LogInstanceNameFn] = fn;
	};
}

export function debug<T extends (...arg: any) => any>(
	options: {
		args?:
			| false
			| {
					0?: ((arg: Parameters<T>[0]) => unknown) | string | false;
					1?: ((arg: Parameters<T>[1]) => unknown) | string | false;
					2?: ((arg: Parameters<T>[2]) => unknown) | string | false;
					3?: ((arg: Parameters<T>[3]) => unknown) | string | false;
					4?: ((arg: Parameters<T>[4]) => unknown) | string | false;
					[key: number]: (((arg: any) => unknown) | string | false) | undefined;
			  };
		condition?(...args: Parameters<T>): boolean;
		correlate?: boolean;
		enter?(...args: Parameters<T>): string;
		exit?(result: PromiseType<ReturnType<T>>): string;
		prefix?(context: LogContext, ...args: Parameters<T>): string;
		sanitize?(key: string, value: any): any;
		singleLine?: boolean;
		timed?: boolean;
	} = { timed: true },
) {
	return log<T>({ debug: true, ...options });
}

type PromiseType<T> = T extends Promise<infer U> ? U : T;

export function log<T extends (...arg: any) => any>(
	options: {
		args?:
			| false
			| {
					0?: ((arg: Parameters<T>[0]) => unknown) | string | false;
					1?: ((arg: Parameters<T>[1]) => unknown) | string | false;
					2?: ((arg: Parameters<T>[2]) => unknown) | string | false;
					3?: ((arg: Parameters<T>[3]) => unknown) | string | false;
					4?: ((arg: Parameters<T>[4]) => unknown) | string | false;
					[key: number]: (((arg: any) => unknown) | string | false) | undefined;
			  };
		condition?(...args: Parameters<T>): boolean;
		correlate?: boolean;
		debug?: boolean;
		enter?(...args: Parameters<T>): string;
		exit?(result: PromiseType<ReturnType<T>>): string;
		prefix?(context: LogContext, ...args: Parameters<T>): string;
		sanitize?(key: string, value: any): any;
		singleLine?: boolean;
		timed?: boolean;
	} = { timed: true },
) {
	options = { timed: true, ...options };

	const logFn = (options.debug ? Logger.debug.bind(Logger) : Logger.log.bind(Logger)) as
		| typeof Logger.debug
		| typeof Logger.log;
	const warnFn = Logger.warn.bind(Logger);

	return (target: any, key: string, descriptor: PropertyDescriptor & Record<string, any>) => {
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

		const parameters = getParameters(fn);

		descriptor[fnKey] = function (this: any, ...args: Parameters<T>) {
			const correlationId = getNextCorrelationId();

			if (
				(!Logger.isDebugging &&
					!Logger.enabled(LogLevel.Debug) &&
					!(Logger.enabled(LogLevel.Info) && !options.debug)) ||
				(typeof options.condition === 'function' && !options.condition(...args))
			) {
				return fn!.apply(this, args);
			}

			let instanceName: string;
			if (this != null) {
				instanceName = Logger.toLoggableName(this);
				// eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
				if (this.constructor?.[LogInstanceNameFn]) {
					instanceName = target.constructor[LogInstanceNameFn](this, instanceName);
				}
			} else {
				instanceName = emptyStr;
			}

			let { correlate } = options;
			if (!correlate && options.timed) {
				correlate = true;
			}

			let prefix = `${correlate ? `[${correlationId.toString(16).padStart(5)}] ` : emptyStr}${
				instanceName ? `${instanceName}.` : emptyStr
			}${key}`;

			if (options.prefix != null) {
				prefix = options.prefix(
					{
						id: correlationId,
						instance: this,
						instanceName: instanceName,
						name: key,
						prefix: prefix,
					},
					...args,
				);
			}

			let correlationContext: LogCorrelationContext | undefined;
			if (correlate) {
				correlationContext = { correlationId: correlationId, prefix: prefix };
				setCorrelationContext(correlationId, correlationContext);
			}

			const enter = options.enter != null ? options.enter(...args) : emptyStr;

			let loggableParams: string;
			if (options.args === false || args.length === 0) {
				loggableParams = emptyStr;

				if (!options.singleLine) {
					logFn(`${prefix}${enter}`);
				}
			} else {
				const argControllers = typeof options.args === 'object' ? options.args : undefined;
				let argController;
				let loggable;
				loggableParams = filterMap(args, (v: any, index: number) => {
					const p = parameters[index];

					argController = argControllers != null ? argControllers[index] : undefined;
					if (argController != null) {
						if (typeof argController === 'boolean') return undefined;
						if (typeof argController === 'string') return argController;
						loggable = String(argController(v));
					} else {
						loggable = Logger.toLoggable(v, options.sanitize);
					}

					return p ? `${p}=${loggable}` : loggable;
				}).join(', ');

				if (!options.singleLine) {
					logFn(
						`${prefix}${enter}`,
						!options.debug && !Logger.enabled(LogLevel.Debug) && !Logger.isDebugging
							? emptyStr
							: loggableParams,
					);
				}
			}

			if (options.singleLine || options.timed || options.exit != null) {
				const start = options.timed ? hrtime() : undefined;

				const logError = (ex: Error) => {
					const timing = start !== undefined ? ` \u2022 ${getDurationMilliseconds(start)} ms` : emptyStr;
					if (options.singleLine) {
						Logger.error(
							ex,
							`${prefix}${enter}`,
							`failed${
								correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
							}${timing}`,
							loggableParams,
						);
					} else {
						Logger.error(
							ex,
							prefix,
							`failed${
								correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
							}${timing}`,
						);
					}

					if (correlate) {
						clearCorrelationContext(correlationId);
					}
				};

				let result;
				try {
					result = fn!.apply(this, args);
				} catch (ex) {
					logError(ex);
					throw ex;
				}

				const logResult = (r: any) => {
					let exitLogFn;
					let timing;
					if (start != null) {
						const duration = getDurationMilliseconds(start);
						if (duration > Logger.slowCallWarningThreshold) {
							exitLogFn = warnFn;
							timing = ` \u2022 ${duration} ms (slow)`;
						} else {
							exitLogFn = logFn;
							timing = ` \u2022 ${duration} ms`;
						}
					} else {
						timing = emptyStr;
						exitLogFn = logFn;
					}

					let exit;
					if (options.exit != null) {
						try {
							exit = options.exit(r);
						} catch (ex) {
							exit = `@log.exit error: ${ex}`;
						}
					} else {
						exit = 'completed';
					}

					if (options.singleLine) {
						exitLogFn(
							`${prefix}${enter} ${exit}${
								correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
							}${timing}`,
							!options.debug && !Logger.enabled(LogLevel.Debug) && !Logger.isDebugging
								? emptyStr
								: loggableParams,
						);
					} else {
						exitLogFn(
							`${prefix} ${exit}${
								correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
							}${timing}`,
						);
					}

					if (correlate) {
						clearCorrelationContext(correlationId);
					}
				};

				if (result != null && isPromise(result)) {
					const promise = result.then(logResult);
					promise.catch(logError);
				} else {
					logResult(result);
				}

				return result;
			}

			return fn!.apply(this, args);
		};
	};
}
