'use strict';

export namespace Arrays {
    export function groupBy<T>(array: T[], accessor: (item: T) => string): { [key: string]: T[] } {
        return array.reduce((previous, current) => {
            const value = accessor(current);
            previous[value] = previous[value] || [];
            previous[value].push(current);
            return previous;
        }, Object.create(null));
    }

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