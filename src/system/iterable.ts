'use strict';

export namespace Iterables {
    export function* filter<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): Iterable<T> {
        for (const item of source) {
            if (predicate(item)) yield item;
        }
    }

    export function* filterMap<T, TMapped>(source: Iterable<T> | IterableIterator<T>, predicateMapper: (item: T) => TMapped | undefined | null): Iterable<TMapped> {
        for (const item of source) {
            const mapped = predicateMapper(item);
            if (mapped) yield mapped;
        }
    }

    export function forEach<T>(source: Iterable<T> | IterableIterator<T>, fn: (item: T, index: number) => void): void {
        let i = 0;
        for (const item of source) {
            fn(item, i);
            i++;
        }
    }

    export function find<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): T {
        for (const item of source) {
            if (predicate(item)) return item;
        }
        return null;
    }

    export function first<T>(source: Iterable<T>): T {
        return source[Symbol.iterator]().next().value;
    }

    export function* flatMap<T, TMapped>(source: Iterable<T> | IterableIterator<T>, mapper: (item: T) => Iterable<TMapped>): Iterable<TMapped> {
        for (const item of source) {
            yield* mapper(item);
        }
    }

    export function isIterable(source: Iterable<any>): boolean {
        return typeof source[Symbol.iterator] === 'function';
    }

    export function last<T>(source: Iterable<T>): T {
        let item: T;
        for (item of source) { /* noop */ }
        return item;
    }

    export function* map<T, TMapped>(source: Iterable<T> | IterableIterator<T>, mapper: (item: T) => TMapped): Iterable<TMapped> {
        for (const item of source) {
            yield mapper(item);
        }
    }

    export function next<T>(source: IterableIterator<T>): T {
        return source.next().value;
    }

    export function some<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): boolean {
        for (const item of source) {
            if (predicate(item)) return true;
        }
        return false;
    }
}