/* eslint-disable @typescript-eslint/no-unsafe-return */
import { hrtime } from '@env/hrtime';
import { getParameters } from '../function';
import { getLoggableName, Logger } from '../logger';
import { slowCallWarningThreshold } from '../logger.constants';
import type { LogScope } from '../logger.scope';
import { clearLogScope, getLoggableScopeBlock, logScopeIdGenerator, setLogScope } from '../logger.scope';
import { isPromise } from '../promise';
import { getDurationMilliseconds } from '../string';

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
	if?(this: any, ...args: Parameters<T>): boolean;
	enter?(...args: Parameters<T>): string;
	exit?: ((result: PromiseType<ReturnType<T>>) => string) | boolean;
	prefix?(context: LogContext, ...args: Parameters<T>): string;
	logThreshold?: number;
	scoped?: boolean;
	singleLine?: boolean;
	timed?: boolean;
}

export const LogInstanceNameFn = Symbol('logInstanceNameFn');

export function logName<T>(fn: (c: T, name: string) => string) {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
	let ifFn: LogOptions<T>['if'] | undefined;
	let enterFn: LogOptions<T>['enter'] | undefined;
	let exitFn: LogOptions<T>['exit'] | undefined;
	let prefixFn: LogOptions<T>['prefix'] | undefined;
	let logThreshold: NonNullable<LogOptions<T>['logThreshold']> = 0;
	let scoped: NonNullable<LogOptions<T>['scoped']> = false;
	let singleLine: NonNullable<LogOptions<T>['singleLine']> = false;
	let timed: NonNullable<LogOptions<T>['timed']> = true;
	if (options != null) {
		({
			args: overrides,
			if: ifFn,
			enter: enterFn,
			exit: exitFn,
			prefix: prefixFn,
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

	const debugging = Logger.isDebugging;
	const logFn: (message: string, ...params: any[]) => void = debug ? Logger.debug : Logger.log;
	const logLevel = debugging ? 'debug' : 'info';

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

		const parameters = overrides !== false ? getParameters(fn) : [];

		descriptor[fnKey] = function (this: any, ...args: Parameters<T>) {
			if ((!debugging && !Logger.enabled(logLevel)) || (ifFn != null && !ifFn.apply(this, args))) {
				return fn.apply(this, args);
			}

			const prevScopeId = logScopeIdGenerator.current;
			const scopeId = logScopeIdGenerator.next();

			const instanceName = this != null ? getLoggableName(this) : undefined;

			let prefix = instanceName
				? scoped
					? `${getLoggableScopeBlock(scopeId, prevScopeId)} ${instanceName}.${key}`
					: `${instanceName}.${key}`
				: key;

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

			let scope: LogScope | undefined;
			if (scoped) {
				scope = setLogScope(scopeId, { scopeId: scopeId, prevScopeId: prevScopeId, prefix: prefix });
			}

			const enter = enterFn != null ? enterFn(...args) : '';

			let loggableParams: string;
			if (overrides === false || args.length === 0) {
				loggableParams = '';

				if (!singleLine) {
					logFn.call(Logger, `${prefix}${enter}`);
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

						paramLogValue = Logger.toLoggable(paramValue);
					}

					loggableParams += paramName ? `${paramName}=${paramLogValue}` : paramLogValue;
				}

				if (!singleLine) {
					logFn.call(Logger, loggableParams ? `${prefix}${enter}(${loggableParams})` : `${prefix}${enter}`);
				}
			}

			if (singleLine || timed || exitFn != null) {
				const start = timed ? hrtime() : undefined;

				const logError = (ex: unknown) => {
					const timing = start !== undefined ? ` [${getDurationMilliseconds(start)}ms]` : '';
					if (singleLine) {
						Logger.error(
							ex,
							loggableParams ? `${prefix}${enter}(${loggableParams})` : `${prefix}${enter}`,
							scope?.exitDetails ? `failed${scope.exitDetails}${timing}` : `failed${timing}`,
						);
					} else {
						Logger.error(
							ex,
							prefix,
							scope?.exitDetails ? `failed${scope.exitDetails}${timing}` : `failed${timing}`,
						);
					}

					if (scoped) {
						clearLogScope(scopeId);
					}
				};

				let result;
				try {
					result = fn.apply(this, args);
				} catch (ex) {
					logError(ex);
					throw ex;
				}

				const logResult = (r: any) => {
					let duration: number | undefined;
					let exitLogFn: typeof logFn;
					let timing;
					if (start != null) {
						duration = getDurationMilliseconds(start);
						if (duration > slowCallWarningThreshold) {
							exitLogFn = Logger.warn;
							timing = ` [*${duration}ms] (slow)`;
						} else {
							exitLogFn = logFn;
							timing = ` [${duration}ms]`;
						}
					} else {
						timing = '';
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
					} else if (scope?.exitFailed) {
						exit = scope.exitFailed;
						exitLogFn = (message: string, ...params: any[]) => Logger.error(null, message, ...params);
					} else {
						exit = 'completed';
					}

					if (singleLine) {
						if (logThreshold === 0 || duration! > logThreshold) {
							exitLogFn.call(
								Logger,
								loggableParams
									? `${prefix}${enter}(${loggableParams}) ${exit}${scope?.exitDetails || ''}${timing}`
									: `${prefix}${enter} ${exit}${scope?.exitDetails || ''}${timing}`,
							);
						}
					} else {
						exitLogFn.call(
							Logger,
							loggableParams
								? `${prefix}(${loggableParams}) ${exit}${scope?.exitDetails || ''}${timing}`
								: `${prefix} ${exit}${scope?.exitDetails || ''}${timing}`,
						);
					}

					if (scoped) {
						clearLogScope(scopeId);
					}
				};

				if (result != null && isPromise(result)) {
					result.then(logResult, logError);
				} else {
					logResult(result);
				}

				return result;
			}

			return fn.apply(this, args);
		};
	};
}
