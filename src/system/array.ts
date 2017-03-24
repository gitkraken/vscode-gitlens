'use strict';

export namespace Arrays {
    export function uniqueBy<T>(array: T[], accessor: (item: T) => any, predicate?: (item: T) => boolean): T[] {
        const uniqueValues = Object.create(null);
        return array.filter(_ => {
            const value = accessor(_);
            if (uniqueValues[value]) return false;

            uniqueValues[value] = accessor;
            return predicate ? predicate(_) : true;
        });
    }
}