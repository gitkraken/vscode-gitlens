/* eslint-disable @typescript-eslint/no-unsafe-return */
import { hrtime } from '@env/hrtime';
import { getParameters } from '../function';
import { getLoggableName, Logger } from '../logger';
import { slowCallWarningThreshold } from '../logger.constants';
import type { LogScope } from '../logger.scope';
import { clearLogScope, getNextLogScopeId, setLogScope } from '../logger.scope';
import { isPromise } from '../promise';
import { getDurationMilliseconds } from '../string';

const emptyStr = '';

export interface LogContext {
	id: number;
	instance: any;
	instanceName: string;
	name: string;
	prefix: string;
}

interface LogOptions<T extends (...arg: any) => any> {
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
	enter?(...args: Parameters<T>): string;
	exit?: ((result: PromiseType<ReturnType<T>>) => string) | boolean;
	prefix?(context: LogContext, ...args: Parameters<T>): string;
	sanitize?(key: string, value: any): any;
	logThreshold?: number;
	scoped?: boolean;
	singleLine?: boolean;
	timed?: boolean;
}

export const LogInstanceNameFn = Symbol('logInstanceNameFn');

export function logName<T>(fn: (c: T, name: string) => string) {
	return (target: Function) => {
		(target as any)[LogInstanceNameFn] = fn;
	};
}

export function debug<T extends (...arg: any) => any>(options?: LogOptions<T>) {
	return log<T>(options, true);
}

type PromiseType<T> = T extends Promise<infer U> ? U : T;

export function log<T extends (...arg: any) => any>(options?: LogOptions<T>, debug = false) {
	let overrides: LogOptions<T>['args'] | undefined;
	let conditionFn: LogOptions<T>['condition'] | undefined;
	let enterFn: LogOptions<T>['enter'] | undefined;
	let exitFn: LogOptions<T>['exit'] | undefined;
	let prefixFn: LogOptions<T>['prefix'] | undefined;
	let sanitizeFn: LogOptions<T>['sanitize'] | undefined;
	let logThreshold: NonNullable<LogOptions<T>['logThreshold']> = 0;
	let scoped: NonNullable<LogOptions<T>['scoped']> = false;
	let singleLine: NonNullable<LogOptions<T>['singleLine']> = false;
	let timed: NonNullable<LogOptions<T>['timed']> = true;
	if (options != null) {
		({
			args: overrides,
			condition: conditionFn,
			enter: enterFn,
			exit: exitFn,
			prefix: prefixFn,
			sanitize: sanitizeFn,
			logThreshold = 0,
			scoped = true,
			singleLine = false,
			timed = true,
		} = options);
	}

	if (logThreshold > 0) {
		singleLine = true;
		timed = true;
	}

	if (timed) {
		scoped = true;
	}

	const logFn = debug ? Logger.debug.bind(Logger) : Logger.log.bind(Logger);
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
			const scopeId = getNextLogScopeId();

			if (
				(!Logger.isDebugging && !Logger.enabled('debug') && !(Logger.enabled('info') && !debug)) ||
				(conditionFn != null && !conditionFn(...args))
			) {
				return fn!.apply(this, args);
			}

			let instanceName: string;
			if (this != null) {
				instanceName = getLoggableName(this);
				if (this.constructor?.[LogInstanceNameFn]) {
					instanceName = target.constructor[LogInstanceNameFn](this, instanceName);
				}
			} else {
				instanceName = emptyStr;
			}

			let prefix = `${scoped ? `[${scopeId.toString(16).padStart(5)}] ` : emptyStr}${
				instanceName ? `${instanceName}.` : emptyStr
			}${key}`;

			if (prefixFn != null) {
				prefix = prefixFn(
					{
						id: scopeId,
						instance: this,
						instanceName: instanceName,
						name: key,
						prefix: prefix,
					},
					...args,
				);
			}

			let scope: LogScope | undefined;
			if (scoped) {
				scope = { scopeId: scopeId, prefix: prefix };
				setLogScope(scopeId, scope);
			}

			const enter = enterFn != null ? enterFn(...args) : emptyStr;

			let loggableParams: string;
			if (overrides === false || args.length === 0) {
				loggableParams = emptyStr;

				if (!singleLine) {
					logFn(`${prefix}${enter}`);
				}
			} else {
				loggableParams = '';

				let paramOverride;
				let paramIndex = -1;
				let paramName;
				let paramLogValue;
				let paramValue;

				for (paramValue of args as unknown[]) {
					paramName = parameters[++paramIndex];

					paramOverride = overrides?.[paramIndex];
					if (paramOverride != null) {
						if (typeof paramOverride === 'boolean') continue;

						if (loggableParams.length > 0) {
							loggableParams += ', ';
						}

						if (typeof paramOverride === 'string') {
							loggableParams += paramOverride;
							continue;
						}

						paramLogValue = String(paramOverride(paramValue));
					} else {
						if (loggableParams.length > 0) {
							loggableParams += ', ';
						}

						paramLogValue = Logger.toLoggable(paramValue, sanitizeFn);
					}

					loggableParams += paramName ? `${paramName}=${paramLogValue}` : paramLogValue;
				}

				if (!singleLine) {
					logFn(
						`${prefix}${enter}${
							loggableParams && (debug || Logger.enabled('debug') || Logger.isDebugging)
								? `(${loggableParams})`
								: emptyStr
						}`,
					);
				}
			}

			if (singleLine || timed || exitFn != null) {
				const start = timed ? hrtime() : undefined;

				const logError = (ex: Error) => {
					const timing = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : emptyStr;
					if (singleLine) {
						Logger.error(
							ex,
							`${prefix}${enter}${loggableParams ? `(${loggableParams})` : emptyStr}`,
							`failed${scope?.exitDetails ? scope.exitDetails : emptyStr}${timing}`,
						);
					} else {
						Logger.error(ex, prefix, `failed${scope?.exitDetails ? scope.exitDetails : emptyStr}${timing}`);
					}

					if (scoped) {
						clearLogScope(scopeId);
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
					let duration: number | undefined;
					let exitLogFn;
					let timing;
					if (start != null) {
						duration = getDurationMilliseconds(start);
						if (duration > slowCallWarningThreshold) {
							exitLogFn = warnFn;
							timing = ` [*${duration}ms] (slow)`;
						} else {
							exitLogFn = logFn;
							timing = ` [${duration}ms]`;
						}
					} else {
						timing = emptyStr;
						exitLogFn = logFn;
					}

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
					} else {
						exit = 'completed';
					}

					if (singleLine) {
						if (logThreshold === 0 || duration! > logThreshold) {
							exitLogFn(
								`${prefix}${enter}${
									loggableParams && (debug || Logger.enabled('debug') || Logger.isDebugging)
										? `(${loggableParams})`
										: emptyStr
								} ${exit}${scope?.exitDetails ? scope.exitDetails : emptyStr}${timing}`,
							);
						}
					} else {
						exitLogFn(
							`${prefix}${
								loggableParams && (debug || Logger.enabled('debug') || Logger.isDebugging)
									? `(${loggableParams})`
									: emptyStr
							} ${exit}${scope?.exitDetails ? scope.exitDetails : emptyStr}${timing}`,
						);
					}

					if (scoped) {
						clearLogScope(scopeId);
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
