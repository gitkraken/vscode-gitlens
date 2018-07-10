'use strict';
import { Objects } from './object';

export namespace Arrays {
    export function countUniques<T>(source: T[], accessor: (item: T) => string): { [key: string]: number } {
        const uniqueCounts = Object.create(null);
        for (const item of source) {
            const value = accessor(item);
            uniqueCounts[value] = (uniqueCounts[value] || 0) + 1;
        }
        return uniqueCounts;
    }

    export function filterMap<T, TMapped>(
        source: T[],
        predicateMapper: (item: T) => TMapped | null | undefined
    ): TMapped[] {
        return source.reduce(
            (accumulator, current) => {
                const mapped = predicateMapper(current);
                if (mapped != null) {
                    accumulator.push(mapped);
                }
                return accumulator;
            },
            [] as TMapped[]
        );
    }

    export async function filterMapAsync<T, TMapped>(
        source: T[],
        predicateMapper: (item: T) => Promise<TMapped | null | undefined>
    ): Promise<TMapped[]> {
        return source.reduce(
            async (accumulator, current) => {
                const mapped = await predicateMapper(current);
                if (mapped != null) {
                    accumulator.push(mapped);
                }
                return accumulator;
            },
            [] as any
        );
    }

    export function groupBy<T>(source: T[], accessor: (item: T) => string): { [key: string]: T[] } {
        return source.reduce((groupings, current) => {
            const value = accessor(current);
            groupings[value] = groupings[value] || [];
            groupings[value].push(current);
            return groupings;
        }, Object.create(null));
    }

    export function groupByMap<TKey, TValue>(source: TValue[], accessor: (item: TValue) => TKey): Map<TKey, TValue[]> {
        return source.reduce((groupings, current) => {
            const value = accessor(current);
            const group = groupings.get(value) || [];
            groupings.set(value, group);
            group.push(current);
            return groupings;
        }, new Map<TKey, TValue[]>());
    }

    export function groupByFilterMap<TKey, TValue, TMapped>(
        source: TValue[],
        accessor: (item: TValue) => TKey,
        predicateMapper: (item: TValue) => TMapped | null | undefined
    ): Map<TKey, TMapped[]> {
        return source.reduce((groupings, current) => {
            const mapped = predicateMapper(current);
            if (mapped != null) {
                const value = accessor(current);
                const group = groupings.get(value) || [];
                groupings.set(value, group);
                group.push(mapped);
            }
            return groupings;
        }, new Map<TKey, TMapped[]>());
    }

    export interface IHierarchicalItem<T> {
        name: string;
        relativePath: string;
        value?: T;

        // parent?: IHierarchicalItem<T>;
        children: { [key: string]: IHierarchicalItem<T> } | undefined;
        descendants: T[] | undefined;
    }

    export function makeHierarchical<T>(
        values: T[],
        splitPath: (i: T) => string[],
        joinPath: (...paths: string[]) => string,
        compact: boolean = false
    ): IHierarchicalItem<T> {
        const seed = {
            name: '',
            relativePath: '',
            children: Object.create(null),
            descendants: []
        };

        const hierarchy = values.reduce((root: IHierarchicalItem<T>, value) => {
            let folder = root;

            let relativePath = '';
            for (const folderName of splitPath(value)) {
                relativePath = joinPath(relativePath, folderName);

                if (folder.children === undefined) {
                    folder.children = Object.create(null);
                }

                let f = folder.children![folderName];
                if (f === undefined) {
                    folder.children![folderName] = f = {
                        name: folderName,
                        relativePath: relativePath,
                        // parent: folder,
                        children: undefined,
                        descendants: undefined
                    };
                }

                if (folder.descendants === undefined) {
                    folder.descendants = [];
                }
                folder.descendants.push(value);
                folder = f;
            }

            folder.value = value;

            return root;
        }, seed);

        if (compact) return compactHierarchy(hierarchy, joinPath, true);
        return hierarchy;
    }

    export function compactHierarchy<T>(
        root: IHierarchicalItem<T>,
        joinPath: (...paths: string[]) => string,
        isRoot: boolean = true
    ): IHierarchicalItem<T> {
        if (root.children === undefined) return root;

        const children = [...Objects.values(root.children)];

        // // Attempts less nesting but duplicate roots
        // if (!isRoot && children.every(c => c.value === undefined)) {
        //     const parentSiblings = root.parent!.children!;
        //     if (parentSiblings[root.name] !== undefined) {
        //         delete parentSiblings[root.name];

        //         for (const child of children) {
        //             child.name = joinPath(root.name, child.name);
        //             parentSiblings[child.name] = child;
        //         }
        //     }
        // }

        for (const child of children) {
            compactHierarchy(child, joinPath, false);
        }

        if (!isRoot && children.length === 1) {
            const child = children[0];
            if (child.value === undefined) {
                root.name = joinPath(root.name, child.name);
                root.relativePath = child.relativePath;
                root.children = child.children;
            }
        }

        return root;
    }

    export function uniqueBy<T>(source: T[], accessor: (item: T) => any, predicate?: (item: T) => boolean): T[] {
        const uniqueValues = Object.create(null);
        return source.filter(item => {
            const value = accessor(item);
            if (uniqueValues[value]) return false;

            uniqueValues[value] = accessor;
            return predicate ? predicate(item) : true;
        });
    }
}
