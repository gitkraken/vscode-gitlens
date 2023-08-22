export function* chunk<T>(source: T[], size: number): Iterable<T[]> {
	let chunk: T[] = [];

	for (const item of source) {
		if (chunk.length < size) {
			chunk.push(item);
			continue;
		}

		yield chunk;
		chunk = [];
	}

	if (chunk.length > 0) {
		yield chunk;
	}
}

export function* chunkByStringLength(source: string[], maxLength: number): Iterable<string[]> {
	let chunk: string[] = [];

	let chunkLength = 0;
	for (const item of source) {
		let length = chunkLength + item.length;
		if (length > maxLength && chunk.length > 0) {
			yield chunk;

			chunk = [];
			length = item.length;
		}

		chunk.push(item);
		chunkLength = length;
	}

	if (chunk.length > 0) {
		yield chunk;
	}
}

export function count<T>(source: IterableIterator<T>, predicate?: (item: T) => boolean): number {
	let count = 0;
	let next: IteratorResult<T>;

	while (true) {
		next = source.next();
		if (next.done) break;

		if (predicate === undefined || predicate(next.value)) {
			count++;
		}
	}

	return count;
}

export function every<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): boolean {
	for (const item of source) {
		if (!predicate(item)) return false;
	}
	return true;
}

export function filter<T>(source: Iterable<T | undefined | null> | IterableIterator<T | undefined | null>): Iterable<T>;
export function filter<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): Iterable<T>;
export function filter<T, U extends T>(
	source: Iterable<T> | IterableIterator<T>,
	predicate: (item: T) => item is U,
): Iterable<U>;
export function* filter<T, U extends T = T>(
	source: Iterable<T> | IterableIterator<T>,
	predicate?: ((item: T) => item is U) | ((item: T) => boolean),
): Iterable<T | U> {
	if (predicate === undefined) {
		for (const item of source) {
			if (item != null) yield item;
		}
	} else {
		for (const item of source) {
			if (predicate(item)) yield item;
		}
	}
}

export function* filterMap<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	predicateMapper: (item: T) => TMapped | undefined | null,
): Iterable<TMapped> {
	for (const item of source) {
		const mapped = predicateMapper(item);
		if (mapped != null) yield mapped;
	}
}

export function forEach<T>(source: Iterable<T> | IterableIterator<T>, fn: (item: T, index: number) => void): void {
	let i = 0;
	for (const item of source) {
		fn(item, i);
		i++;
	}
}

export function find<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): T | null {
	for (const item of source) {
		if (predicate(item)) return item;
	}
	return null;
}

export function findIndex<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): number {
	let i = 0;
	for (const item of source) {
		if (predicate(item)) return i;
		i++;
	}
	return -1;
}

export function first<T>(source: Iterable<T> | IterableIterator<T>): T | undefined {
	return source[Symbol.iterator]().next().value as T | undefined;
}

export function* flatMap<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	mapper: (item: T) => Iterable<TMapped>,
): IterableIterator<TMapped> {
	for (const item of source) {
		yield* mapper(item);
	}
}

export function has<T>(source: Iterable<T> | IterableIterator<T>, item: T): boolean {
	return some(source, i => i === item);
}

export function isIterable(source: Iterable<any>): boolean {
	return typeof source[Symbol.iterator] === 'function';
}

export function join(source: Iterable<any>, separator: string): string {
	const iterator = source[Symbol.iterator]();
	let next = iterator.next();
	if (next.done) return '';

	let result = String(next.value);
	while (true) {
		next = iterator.next();
		if (next.done) break;

		result += `${separator}${next.value}`;
	}

	return result;
}

export function last<T>(source: Iterable<T>): T | undefined {
	let item: T | undefined;
	for (item of source) {
		/* noop */
	}
	return item;
}

export function* map<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	mapper: (item: T) => TMapped,
): IterableIterator<TMapped> {
	for (const item of source) {
		yield mapper(item);
	}
}

export function next<T>(source: IterableIterator<T>): T {
	return source.next().value as T;
}

export function* skip<T>(source: Iterable<T> | IterableIterator<T>, count: number): IterableIterator<T> {
	let i = 0;
	for (const item of source) {
		if (i >= count) yield item;
		i++;
	}
}

export function some<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): boolean {
	for (const item of source) {
		if (predicate(item)) return true;
	}
	return false;
}

export function* take<T>(source: Iterable<T> | IterableIterator<T>, count: number): Iterable<T> {
	if (count > 0) {
		let i = 0;
		for (const item of source) {
			yield item;
			i++;
			if (i >= count) break;
		}
	}
}

export function* union<T>(...sources: (Iterable<T> | IterableIterator<T>)[]): Iterable<T> {
	for (const source of sources) {
		for (const item of source) {
			yield item;
		}
	}
}

export function uniqueBy<TKey, TValue>(
	source: Iterable<TValue> | IterableIterator<TValue>,
	uniqueKey: (item: TValue) => TKey,
	onDuplicate: (original: TValue, current: TValue) => TValue | void,
): IterableIterator<TValue> {
	const uniques = new Map<TKey, TValue>();

	for (const current of source) {
		const value = uniqueKey(current);

		const original = uniques.get(value);
		if (original === undefined) {
			uniques.set(value, current);
		} else {
			const updated = onDuplicate(original, current);
			if (updated !== undefined) {
				uniques.set(value, updated);
			}
		}
	}

	return uniques.values();
}
