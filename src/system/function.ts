'use strict';
import { debounce as _debounce, once as _once } from 'lodash-es';
import { CancellationToken, Disposable } from 'vscode';

export interface IDeferrable {
    cancel(): void;
    flush(...args: any[]): void;
    pending?(): boolean;
}

interface IPropOfValue {
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

    export function debounce<T extends (...args: any[]) => any>(
        fn: T,
        wait?: number,
        options?: { leading?: boolean; maxWait?: number; track?: boolean; trailing?: boolean }
    ): T & IDeferrable {
        const { track, ...opts } = {
            track: false,
            ...(options || {})
        } as { leading?: boolean; maxWait?: number; track?: boolean; trailing?: boolean };

        if (track !== true) return _debounce(fn, wait, opts);

        let pending = false;

        const debounced = _debounce(
            (function(this: any) {
                pending = false;
                return fn.apply(this, arguments);
            } as any) as T,
            wait,
            options
        ) as T & IDeferrable;

        const tracked = (function(this: any) {
            pending = true;
            return debounced.apply(this, arguments);
        } as any) as T & IDeferrable;

        tracked.pending = function() {
            return pending;
        };
        tracked.cancel = function() {
            return debounced.cancel.apply(debounced, arguments);
        };
        tracked.flush = function(...args: any[]) {
            return debounced.flush.apply(debounced, arguments);
        };

        return tracked;
    }

    export function getParameters(fn: Function): string[] {
        if (typeof fn !== 'function') throw new Error('Not supported');

        if (fn.length === 0) return [];

        const stripCommentsRegex = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/gm;
        let fnBody: string = Function.prototype.toString.call(fn);
        fnBody = fnBody.replace(stripCommentsRegex, '') || fnBody;
        fnBody = fnBody.slice(0, fnBody.indexOf('{'));

        let open = fnBody.indexOf('(');
        let close = fnBody.indexOf(')');

        open = open >= 0 ? open + 1 : 0;
        close = close > 0 ? close : fnBody.indexOf('=');

        fnBody = fnBody.slice(open, close);
        fnBody = `(${fnBody})`;

        const match = fnBody.match(/\(([\s\S]*)\)/);
        return match != null ? match[1].split(',').map(param => param.trim()) : [];
    }

    export function isPromise(o: any): o is Promise<any> {
        return (typeof o === 'object' || typeof o === 'function') && typeof o.then === 'function';
    }

    export function once<T extends (...args: any[]) => any>(fn: T): T {
        return _once(fn);
    }

    export function propOf<T, K extends Extract<keyof T, string>>(o: T, key: K) {
        const propOfCore = <T, K extends Extract<keyof T, string>>(o: T, key: K) => {
            const value: string =
                (propOfCore as IPropOfValue).value === undefined ? key : `${(propOfCore as IPropOfValue).value}.${key}`;
            (propOfCore as IPropOfValue).value = value;
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
