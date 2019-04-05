'use strict';
import { debounce as _debounce, once as _once } from 'lodash-es';
import { CancellationToken, Disposable } from 'vscode';

export interface Deferrable {
    cancel(): void;
    flush(...args: any[]): void;
    pending?(): boolean;
}

interface PropOfValue {
    (): any;
    value: string | undefined;
}

export namespace Functions {
    export function cachedOnce<T>(fn: (...args: any[]) => Promise<T>, seed: T): (...args: any[]) => Promise<T> {
        let cached: T | undefined = seed;
        return (...args: any[]) => {
            if (cached !== undefined) {
                const promise = Promise.resolve(cached);
                cached = undefined;

                return promise;
            }
            return fn(...args);
        };
    }

    export function cancellable<T>(promise: Promise<T>, token: CancellationToken): Promise<T | undefined> {
        return new Promise<T | undefined>((resolve, reject) => {
            token.onCancellationRequested(() => resolve(undefined));

            promise.then(resolve, reject);
        });
    }

    export interface DebounceOptions {
        leading?: boolean;
        maxWait?: number;
        track?: boolean;
        trailing?: boolean;
    }

    export function debounce<T extends (...args: any[]) => any>(
        fn: T,
        wait?: number,
        options?: DebounceOptions
    ): T & Deferrable {
        const { track, ...opts }: DebounceOptions = {
            track: false,
            ...(options || {})
        };

        if (track !== true) return _debounce(fn, wait, opts);

        let pending = false;

        const debounced = _debounce(
            (function(this: any, ...args: any[]) {
                pending = false;
                return fn.apply(this, args);
            } as any) as T,
            wait,
            options
        ) as T & Deferrable;

        const tracked = (function(this: any, ...args: any[]) {
            pending = true;
            return debounced.apply(this, args);
        } as any) as T & Deferrable;

        tracked.pending = function() {
            return pending;
        };
        tracked.cancel = function() {
            return debounced.cancel.apply(debounced);
        };
        tracked.flush = function(...args: any[]) {
            // eslint-disable-next-line prefer-spread
            return debounced.flush.apply(debounced, args);
        };

        return tracked;
    }

    const comma = ',';
    const emptyStr = '';
    const equals = '=';
    const openBrace = '{';
    const openParen = '(';
    const closeParen = ')';

    const fnBodyRegex = /\(([\s\S]*)\)/;
    const fnBodyStripCommentsRegex = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/gm;
    const fnBodyStripParamDefaultValueRegex = /\s?=.*$/;

    export function getParameters(fn: Function): string[] {
        if (typeof fn !== 'function') throw new Error('Not supported');

        if (fn.length === 0) return [];

        let fnBody: string = Function.prototype.toString.call(fn);
        fnBody = fnBody.replace(fnBodyStripCommentsRegex, emptyStr) || fnBody;
        fnBody = fnBody.slice(0, fnBody.indexOf(openBrace));

        let open = fnBody.indexOf(openParen);
        let close = fnBody.indexOf(closeParen);

        open = open >= 0 ? open + 1 : 0;
        close = close > 0 ? close : fnBody.indexOf(equals);

        fnBody = fnBody.slice(open, close);
        fnBody = `(${fnBody})`;

        const match = fnBody.match(fnBodyRegex);
        return match != null
            ? match[1].split(comma).map(param => param.trim().replace(fnBodyStripParamDefaultValueRegex, emptyStr))
            : [];
    }

    export function is<T extends object>(o: object, prop: keyof T, value?: any): o is T;
    export function is<T extends object>(o: object, matcher: (o: object) => boolean): o is T;
    export function is<T extends object>(
        o: object,
        propOrMatcher: keyof T | ((o: any) => boolean),
        value?: any
    ): o is T {
        if (typeof propOrMatcher === 'function') {
            return propOrMatcher(o);
        }

        return value === undefined ? (o as any)[propOrMatcher] !== undefined : (o as any)[propOrMatcher] === value;
    }

    export function isPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
        return obj && typeof (obj as Promise<T>).then === 'function';
    }

    export function once<T extends (...args: any[]) => any>(fn: T): T {
        return _once(fn);
    }

    export function propOf<T, K extends Extract<keyof T, string>>(o: T, key: K) {
        const propOfCore = <T, K extends Extract<keyof T, string>>(o: T, key: K) => {
            const value: string =
                (propOfCore as PropOfValue).value === undefined ? key : `${(propOfCore as PropOfValue).value}.${key}`;
            (propOfCore as PropOfValue).value = value;
            const fn = <Y extends Extract<keyof T[K], string>>(k: Y) => propOfCore(o[key], k);
            return Object.assign(fn, { value: value });
        };
        return propOfCore(o, key);
    }

    export function interval(fn: (...args: any[]) => void, ms: number): Disposable {
        let timer: NodeJS.Timer | undefined;
        const disposable = {
            dispose: () => {
                if (timer !== undefined) {
                    clearInterval(timer);
                    timer = undefined;
                }
            }
        };
        timer = setInterval(fn, ms);

        return disposable;
    }

    export async function wait(ms: number) {
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    export async function waitUntil(fn: (...args: any[]) => boolean, timeout: number): Promise<boolean> {
        const max = Math.round(timeout / 100);
        let counter = 0;
        while (true) {
            if (fn()) return true;
            if (counter > max) return false;

            await wait(100);
            counter++;
        }
    }
}
