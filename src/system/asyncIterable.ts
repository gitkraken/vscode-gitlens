// 'use strict';

// // Polyfill for asyncIterator
// (Symbol as any).asyncIterator = Symbol.asyncIterator || Symbol.for('Symbol.asyncIterator');

// export namespace AsyncIterables {
//     export async function* filterMap<T, TMapped>(source: Iterable<T>, predicateMapper: (item: T) => Promise<TMapped | null | undefined>): AsyncIterator<TMapped> {
//         for (const item of source) {
//             const mapped = await predicateMapper(item);
//             if (mapped != null) yield mapped;
//         }
//     }
// }
