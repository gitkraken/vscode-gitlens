import type { Uri } from 'vscode';

type UriMapEntry<T> = {
	readonly uri: Uri;
	readonly value: T;
};

export class UriMap<T> implements Map<Uri, T> {
	private static readonly defaultToKey = (resource: Uri) => resource.toString();

	readonly [Symbol.toStringTag] = 'UriMap';
	private readonly _map: Map<string, UriMapEntry<T>>;

	constructor(entries?: readonly (readonly [Uri, T])[]) {
		this._map = new Map();
		if (entries?.length) {
			for (const [uri, value] of entries) {
				this.set(uri, value);
			}
		}
	}

	set(uri: Uri, value: T): this {
		this._map.set(UriMap.defaultToKey(uri), { uri: uri, value: value });
		return this;
	}

	get(uri: Uri): T | undefined {
		return this._map.get(UriMap.defaultToKey(uri))?.value;
	}

	has(uri: Uri): boolean {
		return this._map.has(UriMap.defaultToKey(uri));
	}

	get size(): number {
		return this._map.size;
	}

	clear(): void {
		this._map.clear();
	}

	delete(uri: Uri): boolean {
		return this._map.delete(UriMap.defaultToKey(uri));
	}

	forEach(callbackfn: (value: T, key: Uri, map: Map<Uri, T>) => void, thisArg?: any): void {
		if (typeof thisArg !== 'undefined') {
			callbackfn = callbackfn.bind(thisArg);
		}
		for (const [_, entry] of this._map) {
			callbackfn(entry.value, entry.uri, this);
		}
	}

	*values(): MapIterator<T> {
		for (const entry of this._map.values()) {
			yield entry.value;
		}
	}

	*keys(): MapIterator<Uri> {
		for (const entry of this._map.values()) {
			yield entry.uri;
		}
	}

	*entries(): MapIterator<[Uri, T]> {
		for (const entry of this._map.values()) {
			yield [entry.uri, entry.value];
		}
	}

	*[Symbol.iterator](): MapIterator<[Uri, T]> {
		for (const [, entry] of this._map) {
			yield [entry.uri, entry.value];
		}
	}
}

export class UriSet implements Set<Uri> {
	readonly [Symbol.toStringTag]: string = 'UriSet';

	private readonly _map: UriMap<Uri>;

	constructor(entries?: readonly Uri[]) {
		this._map = new UriMap();
		if (entries?.length) {
			for (const uri of entries) {
				this.add(uri);
			}
		}
	}

	get size(): number {
		return this._map.size;
	}

	add(uri: Uri): this {
		this._map.set(uri, uri);
		return this;
	}

	clear(): void {
		this._map.clear();
	}

	delete(uri: Uri): boolean {
		return this._map.delete(uri);
	}

	forEach(callbackfn: (value: Uri, value2: Uri, set: Set<Uri>) => void, thisArg?: any): void {
		this._map.forEach((_value, key) => callbackfn.call(thisArg, key, key, this));
	}

	has(uri: Uri): boolean {
		return this._map.has(uri);
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
