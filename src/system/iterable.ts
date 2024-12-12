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

export function* concat<T>(...sources: (Iterable<T> | IterableIterator<T>)[]): Iterable<T> {
	for (const source of sources) {
		yield* source;
	}
}

export function count<T>(
	source: Iterable<T> | IterableIterator<T> | undefined,
	predicate?: (item: T) => boolean,
): number {
	if (source == null) return 0;

	let count = 0;
	for (const item of source) {
		if (predicate == null || predicate(item)) {
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

export function filter<T>(
	source: Iterable<T | undefined | null> | IterableIterator<T | undefined | null>,
): Iterable<NonNullable<T>>;
export function filter<T, U extends T>(
	source: Iterable<T> | IterableIterator<T>,
	predicate: (item: T) => item is U,
): Iterable<U>;
export function filter<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): Iterable<T>;
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

export function find<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): T | undefined {
	for (const item of source) {
		if (predicate(item)) return item;
	}
	return undefined;
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

export function flatCount<T>(
	source: Iterable<T> | IterableIterator<T> | undefined,
	accumulator: (item: T) => number,
): number {
	if (source == null) return 0;

	let count = 0;
	for (const item of source) {
		count += accumulator(item);
	}
	return count;
}

export function* flatMap<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	mapper: (item: T) => Iterable<TMapped>,
): IterableIterator<TMapped> {
	for (const item of source) {
		yield* mapper(item);
	}
}

export function flatten<T>(source: Iterable<Iterable<T>> | IterableIterator<IterableIterator<T>>): IterableIterator<T> {
	return flatMap(source, i => i);
}

export function groupBy<T, K extends PropertyKey>(
	source: Iterable<T> | IterableIterator<T>,
	getGroupingKey: (item: T) => K,
): Record<string, T[]> {
	const result: Record<K, T[]> = Object.create(null);

	for (const current of source) {
		const key = getGroupingKey(current);

		const group = result[key];
		if (group == null) {
			result[key] = [current];
		} else {
			group.push(current);
		}
	}

	return result;
}

export function groupByMap<TKey, TValue>(
	source: Iterable<TValue> | IterableIterator<TValue>,
	getGroupingKey: (item: TValue) => TKey,
	options?: { filterNullGroups?: boolean },
): Map<TKey, TValue[]> {
	const result = new Map<TKey, TValue[]>();

	const filterNullGroups = options?.filterNullGroups ?? false;

	for (const current of source) {
		const key = getGroupingKey(current);
		if (key == null && filterNullGroups) continue;

		const group = result.get(key);
		if (group == null) {
			result.set(key, [current]);
		} else {
			group.push(current);
		}
	}

	return result;
}

export function groupByFilterMap<TKey, TValue, TMapped>(
	source: Iterable<TValue> | IterableIterator<TValue>,
	getGroupingKey: (item: TValue) => TKey,
	predicateMapper: (item: TValue) => TMapped | null | undefined,
): Map<TKey, TMapped[]> {
	const result = new Map<TKey, TMapped[]>();

	for (const current of source) {
		const mapped = predicateMapper(current);
		if (mapped == null) continue;

		const key = getGroupingKey(current);
		const group = result.get(key);
		if (group == null) {
			result.set(key, [mapped]);
		} else {
			group.push(mapped);
		}
	}

	return result;
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

export function max(source: Iterable<number> | IterableIterator<number>): number;
export function max<T>(source: Iterable<T> | IterableIterator<T>, getValue: (item: T) => number): number;
export function max<T>(source: Iterable<T> | IterableIterator<T>, getValue?: (item: T) => number): number {
	let max = Number.NEGATIVE_INFINITY;
	if (getValue == null) {
		for (const item of source as Iterable<number> | IterableIterator<number>) {
			if (item > max) {
				max = item;
			}
		}
	} else {
		for (const item of source) {
			const value = getValue(item);
			if (value > max) {
				max = value;
			}
		}
	}
	return max;
}

export function min(source: Iterable<number> | IterableIterator<number>): number;
export function min<T>(source: Iterable<T> | IterableIterator<T>, getValue: (item: T) => number): number;
export function min<T>(source: Iterable<T> | IterableIterator<T>, getValue?: (item: T) => number): number {
	let min = Number.POSITIVE_INFINITY;
	if (getValue == null) {
		for (const item of source as Iterable<number> | IterableIterator<number>) {
			if (item < min) {
				min = item;
			}
		}
	} else {
		for (const item of source) {
			const value = getValue(item);
			if (value < min) {
				min = value;
			}
		}
	}
	return min;
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

export function sum<T extends number>(source: Iterable<T> | IterableIterator<T> | undefined): number;
export function sum<T>(source: Iterable<T> | IterableIterator<T> | undefined, getValue: (item: T) => number): number;
export function sum<T>(source: Iterable<T> | IterableIterator<T> | undefined, getValue?: (item: T) => number): number {
	if (source == null) return 0;

	let sum = 0;
	if (getValue == null) {
		for (const item of source as Iterable<number> | IterableIterator<number>) {
			sum += item;
		}
	} else {
		for (const item of source) {
			sum += getValue(item);
		}
	}
	return sum;
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

export function* union<T>(...sources: (Iterable<T> | IterableIterator<T> | undefined)[]): Iterable<T> {
	for (const source of sources) {
		if (source == null) continue;

		for (const item of source) {
			yield item;
		}
	}
}

export function uniqueBy<TKey, TValue>(
	source: Iterable<TValue> | IterableIterator<TValue>,
	getUniqueKey: (item: TValue) => TKey,
	onDuplicate: (original: TValue, current: TValue) => TValue | void,
): IterableIterator<TValue> {
	const result = new Map<TKey, TValue>();

	for (const current of source) {
		const key = getUniqueKey(current);

		const original = result.get(key);
		if (original === undefined) {
			result.set(key, current);
		} else {
			const updated = onDuplicate(original, current);
			if (updated !== undefined) {
				result.set(key, updated);
			}
		}
	}

	return result.values();
}
