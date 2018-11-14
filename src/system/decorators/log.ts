'use strict';
import { LogCorrelationContext, Logger, LogLevel } from '../../logger';
import { Functions } from './../function';
import { Strings } from './../string';

const correlationContext = new Map<number, LogCorrelationContext>();
let correlationCounter = 0;

export function getCorrelationContext() {
    return correlationContext.get(correlationCounter);
}

export function getCorrelationId() {
    return correlationCounter;
}

function getNextCorrelationId() {
    return ++correlationCounter;
}

function clearCorrelationContext(correlationId: number) {
    correlationContext.delete(correlationId);
}

function setCorrelationContext(correlationId: number, context: LogCorrelationContext) {
    correlationContext.set(correlationId, context);
}

export interface LogContext<T> {
    prefix: string;
    name: string;
    instance: T;
    instanceName: string;
    id?: number;
}

export const LogInstanceNameFn = Symbol('logInstanceNameFn');

export function logName<T>(fn: (c: T, name: string) => string) {
    return (target: Function) => {
        (target as any)[LogInstanceNameFn] = fn;
    };
}

export function debug<T>(
    options: {
        args?: boolean | { [arg: string]: (arg: any) => string };
        condition?(this: any, ...args: any[]): boolean;
        correlate?: boolean;
        enter?(this: any, ...args: any[]): string;
        exit?(this: any, result: any): string;
        prefix?(this: any, context: LogContext<T>, ...args: any[]): string;
        sanitize?(this: any, key: string, value: any): any;
        timed?: boolean;
    } = { args: true, timed: true }
) {
    return log<T>({ debug: true, ...options });
}

export function log<T>(
    options: {
        args?: boolean | { [arg: number]: (arg: any) => string };
        condition?(this: any, ...args: any[]): boolean;
        correlate?: boolean;
        debug?: boolean;
        enter?(this: any, ...args: any[]): string;
        exit?(this: any, result: any): string;
        prefix?(this: any, context: LogContext<T>, ...args: any[]): string;
        sanitize?(this: any, key: string, value: any): any;
        singleLine?: boolean;
        timed?: boolean;
    } = { args: true, timed: true }
) {
    options = { args: true, timed: true, ...options };

    const logFn = options.debug ? Logger.debug.bind(Logger) : Logger.log.bind(Logger);

    return (target: any, key: string, descriptor: PropertyDescriptor) => {
        let fn: Function | undefined;
        if (typeof descriptor.value === 'function') {
            fn = descriptor.value;
        }
        else if (typeof descriptor.get === 'function') {
            fn = descriptor.get;
        }
        if (fn == null) throw new Error('Not supported');

        const parameters = Functions.getParameters(fn);

        descriptor.value = function(this: any, ...args: any[]) {
            if (
                (Logger.level !== LogLevel.Debug && !(Logger.level === LogLevel.Verbose && !options.debug)) ||
                (typeof options.condition === 'function' && !options.condition(...args))
            ) {
                return fn!.apply(this, args);
            }

            let instanceName: string;
            if (this != null) {
                instanceName = Logger.toLoggableName(this);
                if (this.constructor != null && this.constructor[LogInstanceNameFn]) {
                    instanceName = target.constructor[LogInstanceNameFn](this, instanceName);
                }
            }
            else {
                instanceName = '';
            }

            let correlationId: number | undefined;
            let prefix: string;
            if ((options.correlate || options.timed) && !options.singleLine) {
                correlationId = getNextCorrelationId();
                prefix = `[${correlationId.toString(16)}] ${instanceName ? `${instanceName}.` : ''}${key}`;
            }
            else {
                prefix = `${instanceName ? `${instanceName}.` : ''}${key}`;
            }

            if (options.prefix != null) {
                prefix = options.prefix(
                    {
                        prefix: prefix,
                        instance: this,
                        name: key,
                        instanceName: instanceName,
                        id: correlationId
                    } as LogContext<T>,
                    ...args
                );
            }

            if (correlationId !== undefined) {
                setCorrelationContext(correlationId, { correlationId: correlationId, prefix: prefix });
            }

            const enter = options.enter != null ? options.enter(...args) : '';

            let loggableParams: string;
            if (!options.args || args.length === 0) {
                loggableParams = '';

                if (!options.singleLine) {
                    logFn(`${prefix}${enter}`);
                }
            }
            else {
                loggableParams = args
                    .map((v: any, index: number) => {
                        const p = parameters[index];

                        const loggable =
                            typeof options.args === 'object' && options.args[index]
                                ? options.args[index](v)
                                : Logger.toLoggable(v, options.sanitize);

                        return p ? `${p}=${loggable}` : loggable;
                    })
                    .join(', ');

                if (!options.singleLine) {
                    if (!options.debug) {
                        Logger.logWithDebugParams(`${prefix}${enter}`, loggableParams);
                    }
                    else {
                        logFn(`${prefix}${enter}`, loggableParams);
                    }
                }
            }

            if (options.timed || options.exit != null) {
                const start = options.timed ? process.hrtime() : undefined;

                const logError = (ex: Error) => {
                    const timing = start !== undefined ? ` \u2022 ${Strings.getDurationMilliseconds(start)} ms` : '';
                    Logger.error(ex, prefix, `failed${timing}${options.singleLine ? `${enter}${loggableParams}` : ''}`);

                    if (correlationId !== undefined) {
                        clearCorrelationContext(correlationId);
                    }
                };

                let result;
                try {
                    result = fn!.apply(this, args);
                }
                catch (ex) {
                    logError(ex);
                    throw ex;
                }

                const logResult = (r: any) => {
                    const timing = start !== undefined ? ` \u2022 ${Strings.getDurationMilliseconds(start)} ms` : '';
                    let exit;
                    if (options.exit != null) {
                        try {
                            exit = options.exit(r);
                        }
                        catch (ex) {
                            exit = `@log.exit error: ${ex}`;
                        }
                    }
                    else {
                        exit = 'completed';
                    }

                    if (options.singleLine) {
                        if (!options.debug) {
                            Logger.logWithDebugParams(`${prefix} ${enter}${exit}${timing}`, loggableParams);
                        }
                        else {
                            logFn(prefix, `${enter}${exit}${timing}`, loggableParams);
                        }
                    }
                    else {
                        logFn(prefix, `${exit}${timing}`);
                    }

                    if (correlationId !== undefined) {
                        clearCorrelationContext(correlationId);
                    }
                };

                if (result != null && Functions.isPromise(result)) {
                    const promise = result.then(logResult);
                    promise.catch(logError);
                }
                else {
                    logResult(result);
                }

                return result;
            }

            return fn!.apply(this, args);
        };
    };
}
