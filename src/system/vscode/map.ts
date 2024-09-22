import type { Uri } from 'vscode';

interface ResourceMapKeyFn {
	(resource: Uri): string;
}

class ResourceMapEntry<T> {
	constructor(readonly uri: Uri, readonly value: T) { }
}

function isEntries<T>(arg: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [Uri, T])[] | undefined): arg is readonly (readonly [Uri, T])[] {
	return Array.isArray(arg);
}

export class ResourceMap<T> implements Map<Uri, T> {

	private static readonly defaultToKey = (resource: Uri) => resource.toString();

	readonly [Symbol.toStringTag] = 'ResourceMap';

	private readonly map: Map<string, ResourceMapEntry<T>>;
	private readonly toKey: ResourceMapKeyFn;

	constructor(toKey?: ResourceMapKeyFn);

	constructor(other?: ResourceMap<T>, toKey?: ResourceMapKeyFn);

	constructor(entries?: readonly (readonly [Uri, T])[], toKey?: ResourceMapKeyFn);

	constructor(arg?: ResourceMap<T> | ResourceMapKeyFn | readonly (readonly [Uri, T])[], toKey?: ResourceMapKeyFn) {
		if (arg instanceof ResourceMap) {
			this.map = new Map(arg.map);
			this.toKey = toKey ?? ResourceMap.defaultToKey;
		} else if (isEntries(arg)) {
			this.map = new Map();
			this.toKey = toKey ?? ResourceMap.defaultToKey;

			for (const [resource, value] of arg) {
				this.set(resource, value);
			}
		} else {
			this.map = new Map();
			this.toKey = arg ?? ResourceMap.defaultToKey;
		}
	}

	set(resource: Uri, value: T): this {
		this.map.set(this.toKey(resource), new ResourceMapEntry(resource, value));
		return this;
	}

	get(resource: Uri): T | undefined {
		return this.map.get(this.toKey(resource))?.value;
	}

	has(resource: Uri): boolean {
		return this.map.has(this.toKey(resource));
	}

	get size(): number {
		return this.map.size;
	}

	clear(): void {
		this.map.clear();
	}

	delete(resource: Uri): boolean {
		return this.map.delete(this.toKey(resource));
	}

	forEach(clb: (value: T, key: Uri, map: Map<Uri, T>) => void, thisArg?: any): void {
		if (typeof thisArg !== 'undefined') {
			clb = clb.bind(thisArg);
		}
		for (const [_, entry] of this.map) {
			clb(entry.value, entry.uri, (this as any));
		}
	}

	*values(): MapIterator<T> {
		for (const entry of this.map.values()) {
			yield entry.value;
		}
	}

	*keys(): MapIterator<Uri> {
		for (const entry of this.map.values()) {
			yield entry.uri;
		}
	}

	*entries(): MapIterator<[Uri, T]> {
		for (const entry of this.map.values()) {
			yield [entry.uri, entry.value];
		}
	}

	*[Symbol.iterator](): MapIterator<[Uri, T]> {
		for (const [, entry] of this.map) {
			yield [entry.uri, entry.value];
		}
	}
}

export class ResourceSet implements Set<Uri> {

	readonly [Symbol.toStringTag]: string = 'ResourceSet';

	private readonly _map: ResourceMap<Uri>;

	constructor(toKey?: ResourceMapKeyFn);
	constructor(entries: readonly Uri[], toKey?: ResourceMapKeyFn);
	constructor(entriesOrKey?: readonly Uri[] | ResourceMapKeyFn, toKey?: ResourceMapKeyFn) {
		if (!entriesOrKey || typeof entriesOrKey === 'function') {
			this._map = new ResourceMap(entriesOrKey);
		} else {
			this._map = new ResourceMap(toKey);
			entriesOrKey.forEach(this.add, this);
		}
	}


	get size(): number {
		return this._map.size;
	}

	add(value: Uri): this {
		this._map.set(value, value);
		return this;
	}

	clear(): void {
		this._map.clear();
	}

	delete(value: Uri): boolean {
		return this._map.delete(value);
	}

	forEach(callbackfn: (value: Uri, value2: Uri, set: Set<Uri>) => void, thisArg?: any): void {
		this._map.forEach((_value, key) => callbackfn.call(thisArg, key, key, this));
	}

	has(value: Uri): boolean {
		return this._map.has(value);
	}

	entries(): SetIterator<[Uri, Uri]> {
		return this._map.entries();
	}

	keys(): SetIterator<Uri> {
		return this._map.keys();
	}

	values(): SetIterator<Uri> {
		return this._map.keys();
	}

	[Symbol.iterator](): SetIterator<Uri> {
		return this.keys();
	}
}
