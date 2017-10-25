'use strict';
import { Objects } from './object';

export namespace Arrays {
    export function countUniques<T>(array: T[], accessor: (item: T) => string): { [key: string]: number } {
        const uniqueCounts = Object.create(null);
        for (const item of array) {
            const value = accessor(item);
            uniqueCounts[value] = (uniqueCounts[value] || 0) + 1;
        }
        return uniqueCounts;
    }

    export function groupBy<T>(array: T[], accessor: (item: T) => string): { [key: string]: T[] } {
        return array.reduce((previous, current) => {
            const value = accessor(current);
            previous[value] = previous[value] || [];
            previous[value].push(current);
            return previous;
        }, Object.create(null));
    }

    export interface IHierarchicalItem<T> {
        name: string;
        relativePath: string;
        value?: T;

        // parent?: IHierarchicalItem<T>;
        children: { [key: string]: IHierarchicalItem<T> } | undefined;
        descendants: T[] | undefined;
    }

    export function makeHierarchical<T>(values: T[], splitPath: (i: T) => string[], joinPath: (...paths: string[]) => string, compact: boolean = false): IHierarchicalItem<T> {
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

    export function compactHierarchy<T>(root: IHierarchicalItem<T>, joinPath: (...paths: string[]) => string, isRoot: boolean = true): IHierarchicalItem<T> {
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

    export function uniqueBy<T>(array: T[], accessor: (item: T) => any, predicate?: (item: T) => boolean): T[] {
        const uniqueValues = Object.create(null);
        return array.filter(item => {
            const value = accessor(item);
            if (uniqueValues[value]) return false;

            uniqueValues[value] = accessor;
            return predicate ? predicate(item) : true;
        });
    }
}