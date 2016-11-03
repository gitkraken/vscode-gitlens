'use strict';
// import { debounce as _debounce } from 'lodash';
const _debounce = require('lodash.debounce');

export interface IDeferred {
    cancel(): void;
    flush(): void;
}

export namespace Functions {
    export function debounce<T extends Function>(fn: T, wait?: number, options?: any): T & IDeferred {
        return _debounce(fn, wait, options);
    }
}