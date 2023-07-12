import { CharCode } from '../constants';
import { count, map, some } from './iterable';
import { compareSubstring, compareSubstringIgnoreCase } from './string';

const FIN = { done: true, value: undefined };

// eslint-disable-next-line @typescript-eslint/naming-convention
export interface IKeyIterator<K> {
	reset(key: K): this;
	next(): this;

	hasNext(): boolean;
	cmp(a: string): number;
	value(): string;
}

export class StringIterator implements IKeyIterator<string> {
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

export class PathIterator implements IKeyIterator<string> {
	private _value!: string;
	private _from!: number;
	private _to!: number;

	constructor(
		private readonly _splitOnBackslash: boolean = true,
		private readonly _caseSensitive: boolean = true,
	) {}

	reset(key: string): this {
		this._value = key.replace(/\\$|\/$/, '');
		this._from = 0;
		this._to = 0;
		return this.next();
	}

	hasNext(): boolean {
		return this._to < this._value.length;
	}

	next(): this {
		// this._data = key.split(/[\\/]/).filter(s => !!s);
		this._from = this._to;
		let justSeps = true;
		for (; this._to < this._value.length; this._to++) {
			const ch = this._value.charCodeAt(this._to);
			if (ch === CharCode.Slash || (this._splitOnBackslash && ch === CharCode.Backslash)) {
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
		return this._caseSensitive
			? compareSubstring(a, this._value, 0, a.length, this._from, this._to)
			: compareSubstringIgnoreCase(a, this._value, 0, a.length, this._from, this._to);
	}

	value(): string {
		return this._value.substring(this._from, this._to);
	}
}

class TernarySearchTreeNode<K, V> {
	segment!: string;
	value: V | undefined;
	key!: K;
	left: TernarySearchTreeNode<K, V> | undefined;
	mid: TernarySearchTreeNode<K, V> | undefined;
	right: TernarySearchTreeNode<K, V> | undefined;

	isEmpty(): boolean {
		return !this.left && !this.mid && !this.right && !this.value;
	}
}

export class TernarySearchTree<K, V> {
	static forPaths<E>(): TernarySearchTree<string, E> {
		return new TernarySearchTree<string, E>(new PathIterator());
	}

	static forStrings<E>(): TernarySearchTree<string, E> {
		return new TernarySearchTree<string, E>(new StringIterator());
	}

	private _iter: IKeyIterator<K>;
	private _root: TernarySearchTreeNode<K, V> | undefined;

	constructor(segments: IKeyIterator<K>) {
		this._iter = segments;
	}

	clear(): void {
		this._root = undefined;
	}

	set(key: K, element: V): V | undefined {
		const iter = this._iter.reset(key);
		let node: TernarySearchTreeNode<K, V>;

		if (!this._root) {
			this._root = new TernarySearchTreeNode<K, V>();
			this._root.segment = iter.value();
		}

		node = this._root;
		while (true) {
			const val = iter.cmp(node.segment);
			if (val > 0) {
				// left
				if (!node.left) {
					node.left = new TernarySearchTreeNode<K, V>();
					node.left.segment = iter.value();
				}
				node = node.left;
			} else if (val < 0) {
				// right
				if (!node.right) {
					node.right = new TernarySearchTreeNode<K, V>();
					node.right.segment = iter.value();
				}
				node = node.right;
			} else if (iter.hasNext()) {
				// mid
				iter.next();
				if (!node.mid) {
					node.mid = new TernarySearchTreeNode<K, V>();
					node.mid.segment = iter.value();
				}
				node = node.mid;
			} else {
				break;
			}
		}
		const oldElement = node.value;
		node.value = element;
		node.key = key;
		return oldElement;
	}

	get(key: K): V | undefined {
		return this._getNode(key)?.value;
	}

	private _getNode(key: K) {
		const iter = this._iter.reset(key);
		let node = this._root;
		while (node) {
			const val = iter.cmp(node.segment);
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
		return node;
	}

	has(key: K): boolean {
		const node = this._getNode(key);
		return !(node?.value === undefined && node?.mid === undefined);
	}

	delete(key: K): void {
		this._delete(key, false);
	}

	deleteSuperstr(key: K): void {
		this._delete(key, true);
	}

	private _delete(key: K, superStr: boolean): void {
		const iter = this._iter.reset(key);
		const stack: [-1 | 0 | 1, TernarySearchTreeNode<K, V>][] = [];
		let node = this._root;

		// find and unset node
		while (node) {
			const val = iter.cmp(node.segment);
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
				if (superStr) {
					// remove children
					node.left = undefined;
					node.mid = undefined;
					node.right = undefined;
				} else {
					// remove element
					node.value = undefined;
				}

				// clean up empty nodes
				while (stack.length > 0 && node.isEmpty()) {
					const [dir, parent] = stack.pop()!;
					switch (dir) {
						case 1:
							parent.left = undefined;
							break;
						case 0:
							parent.mid = undefined;
							break;
						case -1:
							parent.right = undefined;
							break;
					}
					node = parent;
				}
				break;
			}
		}
	}

	findSubstr(key: K): V | undefined {
		const iter = this._iter.reset(key);
		let node = this._root;
		let candidate: V | undefined;
		while (node) {
			const val = iter.cmp(node.segment);
			if (val > 0) {
				// left
				node = node.left;
			} else if (val < 0) {
				// right
				node = node.right;
			} else if (iter.hasNext()) {
				// mid
				iter.next();
				candidate = node.value || candidate;
				node = node.mid;
			} else {
				break;
			}
		}
		return node?.value || candidate;
	}

	findSuperstr(key: K, limit: boolean = false): Iterable<V> | undefined {
		const iter = this._iter.reset(key);
		let node = this._root;
		while (node) {
			const val = iter.cmp(node.segment);
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

				node = node.mid;
				return {
					// eslint-disable-next-line no-loop-func
					[Symbol.iterator]: () => this._nodeIterator(node!, limit),
				};
			}
		}
		return undefined;
	}

	private _nodeIterator(node: TernarySearchTreeNode<K, V>, limit: boolean = false): Iterator<V> {
		let res: { done: false; value: V };
		let idx: number;
		let data: V[];
		const next = (): IteratorResult<V> => {
			if (!data) {
				// lazy till first invocation
				data = [];
				idx = 0;
				this._forEach(node, value => data.push(value), limit);
			}
			if (idx >= data.length) {
				return FIN as unknown as IteratorResult<V>;
			}

			if (!res) {
				res = { done: false, value: data[idx++] };
			} else {
				res.value = data[idx++];
			}
			return res;
		};
		return { next: next };
	}

	forEach(callback: (value: V, index: K) => any) {
		this._forEach(this._root, callback);
	}

	private _forEach(
		node: TernarySearchTreeNode<K, V> | undefined,
		callback: (value: V, index: K) => any,
		limit: boolean = false,
	) {
		if (node === undefined) return;

		// left
		this._forEach(node.left, callback, limit);

		// node
		if (node.value) {
			callback(node.value, node.key);
		}

		if (!limit) {
			// mid
			this._forEach(node.mid, callback, limit);
		}

		// right
		this._forEach(node.right, callback, limit);
	}

	any(): boolean {
		return this._root !== undefined && !this._root.isEmpty();
	}

	count(predicate?: (entry: V) => boolean): number {
		if (this._root === undefined || this._root.isEmpty()) return 0;

		return count(this.entries(), predicate === undefined ? undefined : ([, e]) => predicate(e));
	}

	entries(): IterableIterator<[K, V]> {
		return this._iterator(this._root);
	}

	values(): Iterable<V> {
		return map(this.entries(), ([, e]) => e);
	}

	highlander(): [K, V] | undefined {
		if (this._root === undefined || this._root.isEmpty()) return undefined;

		const entries = this.entries();

		let count = 0;
		let next: IteratorResult<[K, V]>;
		let value: [K, V] | undefined;

		while (true) {
			next = entries.next();
			if (next.done) break;

			value = next.value;

			count++;
			if (count > 1) return undefined;
		}

		return value;
	}

	some(predicate: (entry: V) => boolean): boolean {
		if (this._root === undefined || this._root.isEmpty()) return false;

		return some(this.entries(), ([, e]) => predicate(e));
	}

	*[Symbol.iterator](): IterableIterator<[K, V]> {
		yield* this._iterator(this._root);
	}

	private *_iterator(node: TernarySearchTreeNode<K, V> | undefined): IterableIterator<[K, V]> {
		if (node) {
			// left
			yield* this._iterator(node.left);

			// node
			if (node.value) {
				yield [node.key, node.value];
			}

			// mid
			yield* this._iterator(node.mid);

			// right
			yield* this._iterator(node.right);
		}
	}
}
