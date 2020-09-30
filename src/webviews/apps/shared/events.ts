'use strict';

// Taken from github.com/microsoft/vscode/src/vs/base/common/event.ts

export interface Disposable {
	dispose(): void;
}

export interface Event<T> {
	(listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
}

type Listener<T> = [(e: T) => void, any] | ((e: T) => void);

export class Emitter<T> {
	private static readonly _noop = function () {
		/* noop */
	};

	private _disposed: boolean = false;
	private _event?: Event<T>;
	private _deliveryQueue?: LinkedList<[Listener<T>, T]>;
	protected listeners?: LinkedList<Listener<T>>;

	/**
	 * For the public to allow to subscribe
	 * to events from this Emitter
	 */
	get event(): Event<T> {
		if (this._event == null) {
			this._event = (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => {
				if (this.listeners == null) {
					this.listeners = new LinkedList();
				}

				const remove = this.listeners.push(thisArgs == null ? listener : [listener, thisArgs]);

				const result = {
					dispose: () => {
						result.dispose = Emitter._noop;
						if (!this._disposed) {
							remove();
						}
					},
				};

				if (Array.isArray(disposables)) {
					disposables.push(result);
				}

				return result;
			};
		}
		return this._event;
	}

	/**
	 * To be kept private to fire an event to
	 * subscribers
	 */
	fire(event: T): void {
		if (this.listeners != null) {
			// put all [listener,event]-pairs into delivery queue
			// then emit all event. an inner/nested event might be
			// the driver of this

			if (this._deliveryQueue == null) {
				this._deliveryQueue = new LinkedList();
			}

			for (let iter = this.listeners.iterator(), e = iter.next(); !e.done; e = iter.next()) {
				this._deliveryQueue.push([e.value, event]);
			}

			while (this._deliveryQueue.size > 0) {
				const [listener, event] = this._deliveryQueue.shift()!;
				try {
					if (typeof listener === 'function') {
						listener(event);
					} else {
						listener[0].call(listener[1], event);
					}
				} catch (e) {
					// eslint-disable-next-line no-debugger
					debugger;
				}
			}
		}
	}

	dispose() {
		this.listeners?.clear();
		this._deliveryQueue?.clear();
		this._disposed = true;
	}
}

interface IteratorDefinedResult<T> {
	readonly done: false;
	readonly value: T;
}
interface IteratorUndefinedResult {
	readonly done: true;
	readonly value: undefined;
}
const FIN: IteratorUndefinedResult = { done: true, value: undefined };
type IteratorResult<T> = IteratorDefinedResult<T> | IteratorUndefinedResult;

interface Iterator<T> {
	next(): IteratorResult<T>;
}

class Node<E> {
	static readonly Undefined = new Node<any>(undefined);

	element: E;
	next: Node<E>;
	prev: Node<E>;

	constructor(element: E) {
		this.element = element;
		this.next = Node.Undefined;
		this.prev = Node.Undefined;
	}
}

class LinkedList<E> {
	private _first: Node<E> = Node.Undefined;
	private _last: Node<E> = Node.Undefined;
	private _size: number = 0;

	get size(): number {
		return this._size;
	}

	isEmpty(): boolean {
		return this._first === Node.Undefined;
	}

	clear(): void {
		this._first = Node.Undefined;
		this._last = Node.Undefined;
		this._size = 0;
	}

	unshift(element: E): () => void {
		return this._insert(element, false);
	}

	push(element: E): () => void {
		return this._insert(element, true);
	}

	private _insert(element: E, atTheEnd: boolean): () => void {
		const newNode = new Node(element);
		if (this._first === Node.Undefined) {
			this._first = newNode;
			this._last = newNode;
		} else if (atTheEnd) {
			// push
			const oldLast = this._last;
			this._last = newNode;
			newNode.prev = oldLast;
			oldLast.next = newNode;
		} else {
			// unshift
			const oldFirst = this._first;
			this._first = newNode;
			newNode.next = oldFirst;
			oldFirst.prev = newNode;
		}
		this._size += 1;

		let didRemove = false;
		return () => {
			if (!didRemove) {
				didRemove = true;
				this._remove(newNode);
			}
		};
	}

	shift(): E | undefined {
		if (this._first === Node.Undefined) {
			return undefined;
		}
		const res = this._first.element;
		this._remove(this._first);
		return res;
	}

	pop(): E | undefined {
		if (this._last === Node.Undefined) {
			return undefined;
		}
		const res = this._last.element;
		this._remove(this._last);
		return res;
	}

	private _remove(node: Node<E>): void {
		if (node.prev !== Node.Undefined && node.next !== Node.Undefined) {
			// middle
			const anchor = node.prev;
			anchor.next = node.next;
			node.next.prev = anchor;
		} else if (node.prev === Node.Undefined && node.next === Node.Undefined) {
			// only node
			this._first = Node.Undefined;
			this._last = Node.Undefined;
		} else if (node.next === Node.Undefined) {
			// last
			this._last = this._last.prev;
			this._last.next = Node.Undefined;
		} else if (node.prev === Node.Undefined) {
			// first
			this._first = this._first.next;
			this._first.prev = Node.Undefined;
		}

		// done
		this._size -= 1;
	}

	iterator(): Iterator<E> {
		let element: { done: false; value: E };
		let node = this._first;
		return {
			next: function (): IteratorResult<E> {
				if (node === Node.Undefined) {
					return FIN;
				}

				if (element == null) {
					element = { done: false, value: node.element };
				} else {
					element.value = node.element;
				}
				node = node.next;
				return element;
			},
		};
	}

	toArray(): E[] {
		const result: E[] = [];
		for (let node = this._first; node !== Node.Undefined; node = node.next) {
			result.push(node.element);
		}
		return result;
	}
}
