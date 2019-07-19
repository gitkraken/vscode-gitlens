'use strict';
import { CancellationToken } from 'vscode';

export namespace Promises {
    export function cancellable<T>(promise: Promise<T>, token: CancellationToken): Promise<T | undefined> {
        return new Promise<T | undefined>((resolve, reject) => {
            token.onCancellationRequested(() => resolve(undefined));

            promise.then(resolve, reject);
        });
    }

    export function isPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
        return obj && typeof (obj as Promise<T>).then === 'function';
    }

    export class TimeoutError<T> extends Error {
        constructor(public readonly promise: T) {
            super('Promise timed out');
        }
    }

    export function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            setTimeout(() => reject(new TimeoutError(promise)), ms);

            promise.then(resolve, reject);
        });
    }
}
