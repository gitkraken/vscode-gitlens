'use strict';
import { LogCorrelationContext, Logger, TraceLevel } from '../../logger';
import { Functions } from '../function';
import { Promises } from '../promise';
import { Strings } from '../string';
import { Arrays } from '../array';

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
		args?: false | Record<string, (arg: any) => string | false>;
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
		args?: false | Record<number, (arg: any) => string | false>;
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

		const parameters = Functions.getParameters(fn);

		descriptor[fnKey] = function (this: any, ...args: Parameters<T>) {
			const correlationId = getNextCorrelationId();

			if (
				(!Logger.isDebugging &&
					Logger.level !== TraceLevel.Debug &&
					!(Logger.level === TraceLevel.Verbose && !options.debug)) ||
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

			let prefix = `${correlate ? `[${correlationId.toString(16)}] ` : emptyStr}${
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
				const argFns = typeof options.args === 'object' ? options.args : undefined;
				let argFn;
				let loggable;
				loggableParams = Arrays.filterMap(args, (v: any, index: number) => {
					const p = parameters[index];

					argFn = argFns !== undefined ? argFns[index] : undefined;
					if (argFn !== undefined) {
						loggable = argFn(v);
						if (loggable === false) return undefined;
					} else {
						loggable = Logger.toLoggable(v, options.sanitize);
					}

					return p ? `${p}=${loggable}` : loggable;
				}).join(', ');

				if (!options.singleLine) {
					if (!options.debug) {
						Logger.logWithDebugParams(`${prefix}${enter}`, loggableParams);
					} else {
						logFn(`${prefix}${enter}`, loggableParams);
					}
				}
			}

			if (options.singleLine || options.timed || options.exit != null) {
				const start = options.timed ? process.hrtime() : undefined;

				const logError = (ex: Error) => {
					const timing =
						start !== undefined ? ` \u2022 ${Strings.getDurationMilliseconds(start)} ms` : emptyStr;
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
					const timing =
						start !== undefined ? ` \u2022 ${Strings.getDurationMilliseconds(start)} ms` : emptyStr;
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
						if (!options.debug) {
							Logger.logWithDebugParams(
								`${prefix}${enter} ${exit}${
									correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
								}${timing}`,
								loggableParams,
							);
						} else {
							logFn(
								`${prefix}${enter} ${exit}${
									correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
								}${timing}`,
								loggableParams,
							);
						}
					} else {
						logFn(
							`${prefix} ${exit}${
								correlationContext?.exitDetails ? correlationContext.exitDetails : emptyStr
							}${timing}`,
						);
					}

					if (correlate) {
						clearCorrelationContext(correlationId);
					}
				};

				if (result != null && Promises.is(result)) {
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
