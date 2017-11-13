'use strict';
import { Iterables } from '../system/iterable';

// Code stolen from https://github.com/Microsoft/vscode/blob/b3e6d5bb039a4a9362b52a2c8726267ca68cf64e/src/vs/base/common/map.ts#L352

export interface IKeyIterator {
    reset(key: string): this;
    next(): this;
    join(parts: string[]): string;

    hasNext(): boolean;
    cmp(a: string): number;
    value(): string;
}

export class StringIterator implements IKeyIterator {

    private _value: string = '';
    private _pos: number = 0;

    reset(key: string): this {
        this._value = key;
        this._pos = 0;
        return this;
    }

    next(): this {
        this._pos += 1;
        return this;
    }

    join(parts: string[]): string {
        return parts.join('');
    }

    hasNext(): boolean {
        return this._pos < this._value.length - 1;
    }

    cmp(a: string): number {
        const aCode = a.charCodeAt(0);
        const thisCode = this._value.charCodeAt(this._pos);
        return aCode - thisCode;
    }

    value(): string {
        return this._value[this._pos];
    }
}

export class PathIterator implements IKeyIterator {

    private static _fwd = '/'.charCodeAt(0);
    private static _bwd = '\\'.charCodeAt(0);

    private _value: string;
    private _from: number;
    private _to: number;

    reset(key: string): this {
        this._value = key.replace(/\\$|\/$/, '');
        this._from = 0;
        this._to = 0;
        return this.next();
    }

    hasNext(): boolean {
        return this._to < this._value.length;
    }

    join(parts: string[]): string {
        return parts.join('/');
    }

    next(): this {
        // this._data = key.split(/[\\/]/).filter(s => !!s);
        this._from = this._to;
        let justSeps = true;
        for (; this._to < this._value.length; this._to++) {
            const ch = this._value.charCodeAt(this._to);
            if (ch === PathIterator._fwd || ch === PathIterator._bwd) {
                if (justSeps) {
                    this._from++;
                } else {
                    break;
                }
            } else {
                justSeps = false;
            }
        }
        return this;
    }

    cmp(a: string): number {

        let aPos = 0;
        const aLen = a.length;
        let thisPos = this._from;

        while (aPos < aLen && thisPos < this._to) {
            const cmp = a.charCodeAt(aPos) - this._value.charCodeAt(thisPos);
            if (cmp !== 0) {
                return cmp;
            }
            aPos += 1;
            thisPos += 1;
        }

        if (aLen === this._to - this._from) {
            return 0;
        } else if (aPos < aLen) {
            return -1;
        } else {
            return 1;
        }
    }

    value(): string {
        return this._value.substring(this._from, this._to);
    }
}

class TernarySearchTreeNode<E> {
    str: string;
    element: E | undefined;
    left: TernarySearchTreeNode<E> | undefined;
    mid: TernarySearchTreeNode<E> | undefined;
    right: TernarySearchTreeNode<E> | undefined;

    isEmpty(): boolean {
        return this.left === undefined && this.mid === undefined && this.right === undefined && this.element === undefined;
    }
}

export class TernarySearchTree<E> {

    static forPaths<E>(): TernarySearchTree<E> {
        return new TernarySearchTree<E>(new PathIterator());
    }

    static forStrings<E>(): TernarySearchTree<E> {
        return new TernarySearchTree<E>(new StringIterator());
    }

    private _iter: IKeyIterator;
    private _root: TernarySearchTreeNode<E> | undefined;

    constructor(segments: IKeyIterator) {
        this._iter = segments;
    }

    clear(): void {
        this._root = undefined;
    }

    set(key: string, element: E): void {
        const iter = this._iter.reset(key);
        let node: TernarySearchTreeNode<E>;

        if (!this._root) {
            this._root = new TernarySearchTreeNode<E>();
            this._root.str = iter.value();
        }

        node = this._root;
        while (true) {
            const val = iter.cmp(node.str);
            if (val > 0) {
                // left
                if (!node.left) {
                    node.left = new TernarySearchTreeNode<E>();
                    node.left.str = iter.value();
                }
                node = node.left;

            } else if (val < 0) {
                // right
                if (!node.right) {
                    node.right = new TernarySearchTreeNode<E>();
                    node.right.str = iter.value();
                }
                node = node.right;

            } else if (iter.hasNext()) {
                // mid
                iter.next();
                if (!node.mid) {
                    node.mid = new TernarySearchTreeNode<E>();
                    node.mid.str = iter.value();
                }
                node = node.mid;
            } else {
                break;
            }
        }
        node.element = element;
    }

    get(key: string): E | undefined {
        const iter = this._iter.reset(key);
        let node = this._root;
        while (node) {
            const val = iter.cmp(node.str);
            if (val > 0) {
                // left
                node = node.left;
            } else if (val < 0) {
                // right
                node = node.right;
            } else if (iter.hasNext()) {
                // mid
                iter.next();
                node = node.mid;
            } else {
                break;
            }
        }
        return node ? node.element : undefined;
    }

    delete(key: string): void {
        const iter = this._iter.reset(key);
        const stack: [-1 | 0 | 1, TernarySearchTreeNode<E>][] = [];
        let node = this._root;

        // find and unset node
        while (node) {
            const val = iter.cmp(node.str);
            if (val > 0) {
                // left
                stack.push([1, node]);
                node = node.left;
            } else if (val < 0) {
                // right
                stack.push([-1, node]);
                node = node.right;
            } else if (iter.hasNext()) {
                // mid
                iter.next();
                stack.push([0, node]);
                node = node.mid;
            } else {
                // remove element
                node.element = undefined;

                // clean up empty nodes
                while (stack.length > 0 && node.isEmpty()) {
                    const [dir, parent] = stack.pop()!;
                    switch (dir) {
                        case 1: parent.left = undefined; break;
                        case 0: parent.mid = undefined; break;
                        case -1: parent.right = undefined; break;
                    }
                    node = parent;
                }
                break;
            }
        }
    }

    findSubstr(key: string): E | undefined {
        const iter = this._iter.reset(key);
        let node = this._root;
        let candidate: E | undefined;
        while (node) {
            const val = iter.cmp(node.str);
            if (val > 0) {
                // left
                node = node.left;
            } else if (val < 0) {
                // right
                node = node.right;
            } else if (iter.hasNext()) {
                // mid
                iter.next();
                candidate = node.element || candidate;
                node = node.mid;
            } else {
                break;
            }
        }
        return node && node.element || candidate;
    }

    findSuperstr(key: string): TernarySearchTree<E> | undefined {
        const iter = this._iter.reset(key);
        let node = this._root;
        while (node) {
            const val = iter.cmp(node.str);
            if (val > 0) {
                // left
                node = node.left;
            } else if (val < 0) {
                // right
                node = node.right;
            } else if (iter.hasNext()) {
                // mid
                iter.next();
                node = node.mid;
            } else {
                // collect
                if (!node.mid) {
                    return undefined;
                }
                const ret = new TernarySearchTree<E>(this._iter);
                ret._root = node.mid;
                return ret;
            }
        }
        return undefined;
    }

    forEach(callback: (value: E, index: string) => any) {
        this._forEach(this._root!, [], callback);
    }

    private _forEach(node: TernarySearchTreeNode<E>, parts: string[], callback: (value: E, index: string) => any) {
        if (node === undefined) return;

        // left
        this._forEach(node.left!, parts, callback);

        // node
        parts.push(node.str);
        if (node.element) {
            callback(node.element, this._iter.join(parts));
        }
        // mid
        this._forEach(node.mid!, parts, callback);
        parts.pop();

        // right
        this._forEach(node.right!, parts, callback);
    }

    any(): boolean {
        return this._root !== undefined && !this._root.isEmpty();
    }

    entries(): Iterable<[E, string]> {
        return this._iterator(this._root!, []);
    }

    values(): Iterable<E> {
        return Iterables.map(this.entries(), e => e[0]);
    }

    highlander(): [E, string] | undefined {
        if (this._root === undefined || this._root.isEmpty()) return undefined;

        const entries = this.entries() as IterableIterator<[E, string]>;

        let count = 0;
        let next: IteratorResult<[E, string]>;
        while (true) {
            next = entries.next();
            if (next.done) break;

            count++;
            if (count > 1) return undefined;
        }

        return next.value;
    }

    private *_iterator(node: TernarySearchTreeNode<E> | undefined, parts: string[]): IterableIterator<[E, string]> {
        if (node !== undefined) {
            // left
            yield* this._iterator(node.left!, parts);

            // node
            parts.push(node.str);
            if (node.element) {
                yield [node.element, this._iter.join(parts)];
            }
            // mid
            yield* this._iterator(node.mid!, parts);
            parts.pop();

            // right
            yield* this._iterator(node.right!, parts);
        }
    }
}
