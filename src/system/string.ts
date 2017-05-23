'use strict';
const _escapeRegExp = require('lodash.escaperegexp');

export namespace Strings {
    export function escapeRegExp(s: string): string {
        return _escapeRegExp(s);
    }
}