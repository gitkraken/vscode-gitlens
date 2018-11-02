'use strict';
import { Disposable } from 'vscode';

const _debounce = require('lodash.debounce');
const _once = require('lodash.once');

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
    export function debounce<T extends Function>(
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

    export function isPromise(o: any) {
        return (typeof o === 'object' || typeof o === 'function') && typeof o.then === 'function';
    }

    export function once<T extends Function>(fn: T): T {
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

    export function seeded<T>(fn: (...args: any[]) => Promise<T>, seed: T): (...args: any[]) => Promise<T> {
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
