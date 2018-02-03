'use strict';

export namespace Objects {
    export function entries<T>(o: { [key: string]: T }): IterableIterator<[string, T]>;
    export function entries<T>(o: { [key: number]: T }): IterableIterator<[string, T]>;
    export function* entries<T>(o: any): IterableIterator<[string, T]> {
        for (const key in o) {
            yield [key, o[key]];
        }
    }

    export function flatten(o: any, prefix: string = '', stringify: boolean = false): { [key: string]: any } {
        const flattened = Object.create(null);
        _flatten(flattened, prefix, o, stringify);
        return flattened;
    }

    function _flatten(flattened: { [key: string]: any }, key: string, value: any, stringify: boolean = false) {
        if (Object(value) !== value) {
            if (stringify) {
                if (value == null) {
                    flattened[key] = null;
                }
                else if (typeof value === 'string') {
                    flattened[key] = value;
                }
                else {
                    flattened[key] = JSON.stringify(value);
                }
            }
            else {
                flattened[key] = value;
            }
        }
        else if (Array.isArray(value)) {
            const len = value.length;
            for (let i = 0; i < len; i++) {
                _flatten(flattened, `${key}[${i}]`, value[i], stringify);
            }
            if (len === 0) {
                flattened[key] = null;
            }
        }
        else {
            let isEmpty = true;
            for (const p in value) {
                isEmpty = false;
                _flatten(flattened, key ? `${key}.${p}` : p, value[p], stringify);
            }
            if (isEmpty && key) {
                flattened[key] = null;
            }
        }
    }

    export function paths(o: { [key: string]: any }, path?: string): string[] {
        const results = [];

        for (const key in o) {
            const child = o[key];
            if (typeof child === 'object') {
                results.push(...paths(child, path === undefined ? key : `${path}.${key}`));
            }
            else {
                results.push(path === undefined ? key : `${path}.${key}`);
            }
        }

        return results;
    }

    export function values<T>(o: { [key: string]: T }): IterableIterator<T>;
    export function values<T>(o: { [key: number]: T }): IterableIterator<T>;
    export function* values<T>(o: any): IterableIterator<T> {
        for (const key in o) {
            yield o[key];
        }
    }
}