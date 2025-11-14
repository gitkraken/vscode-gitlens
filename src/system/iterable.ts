/**
 * Iterator for chunking arrays
 * Optimized class-based iterator avoiding generator overhead
 */
class ChunkIterator<T> implements IterableIterator<T[]> {
	private index = 0;
	private done = false;

	constructor(
		private readonly source: T[],
		private readonly size: number,
	) {}

	next(): IteratorResult<T[]> {
		if (this.done || this.index >= this.source.length) {
			this.done = true;
			return { done: true, value: undefined };
		}

		const endIndex = Math.min(this.index + this.size, this.source.length);
		const chunk: T[] = [];

		for (let i = this.index; i < endIndex; i++) {
			chunk.push(this.source[i]);
		}

		this.index = endIndex;
		return { done: false, value: chunk };
	}

	[Symbol.iterator](): IterableIterator<T[]> {
		return this;
	}
}

export function chunk<T>(source: T[], size: number): Iterable<T[]> {
	return new ChunkIterator(source, size);
}

/**
 * Iterator for chunking strings by total length
 * Optimized class-based iterator avoiding generator overhead
 */
class ChunkByStringLengthIterator implements IterableIterator<string[]> {
	private index = 0;
	private done = false;

	constructor(
		private readonly source: string[],
		private readonly maxLength: number,
	) {}

	next(): IteratorResult<string[]> {
		if (this.done || this.index >= this.source.length) {
			this.done = true;
			return { done: true, value: undefined };
		}

		const chunk: string[] = [];
		let chunkLength = 0;

		while (this.index < this.source.length) {
			const item = this.source[this.index];
			const length = chunkLength + item.length;

			if (length > this.maxLength && chunk.length > 0) {
				break;
			}

			chunk.push(item);
			chunkLength = length;
			this.index++;
		}

		return { done: false, value: chunk };
	}

	[Symbol.iterator](): IterableIterator<string[]> {
		return this;
	}
}

export function chunkByStringLength(source: string[], maxLength: number): Iterable<string[]> {
	return new ChunkByStringLengthIterator(source, maxLength);
}

/**
 * Iterator for concatenating multiple iterables
 * Optimized class-based iterator avoiding generator overhead
 */
class ConcatIterator<T> implements IterableIterator<T> {
	private sourceIndex = 0;
	private currentIterator: Iterator<T> | undefined;
	private done = false;

	constructor(private readonly sources: (Iterable<T> | IterableIterator<T>)[]) {}

	next(): IteratorResult<T> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		while (this.sourceIndex < this.sources.length) {
			// Initialize iterator for current source if needed
			if (this.currentIterator === undefined) {
				this.currentIterator = this.sources[this.sourceIndex][Symbol.iterator]();
			}

			const result = this.currentIterator.next();
			if (!result.done) {
				return { done: false, value: result.value };
			}

			// Move to next source
			this.sourceIndex++;
			this.currentIterator = undefined;
		}

		this.done = true;
		return { done: true, value: undefined };
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this;
	}
}

export function concat<T>(...sources: (Iterable<T> | IterableIterator<T>)[]): Iterable<T> {
	return new ConcatIterator(sources);
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

/**
 * Iterator for filtering items
 * Optimized class-based iterator avoiding generator overhead
 */
class FilterIterator<T, U extends T = T> implements IterableIterator<T | U> {
	private iterator: Iterator<T>;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly predicate?: ((item: T) => item is U) | ((item: T) => boolean),
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<T | U> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		while (true) {
			const result = this.iterator.next();
			if (result.done) {
				this.done = true;
				return { done: true, value: undefined };
			}

			if (this.predicate === undefined ? result.value != null : this.predicate(result.value)) {
				return { done: false, value: result.value as T | U };
			}
		}
	}

	[Symbol.iterator](): IterableIterator<T | U> {
		return this;
	}
}

export function filter<T>(
	source: Iterable<T | undefined | null> | IterableIterator<T | undefined | null>,
): Iterable<NonNullable<T>>;
export function filter<T, U extends T>(
	source: Iterable<T> | IterableIterator<T>,
	predicate: (item: T) => item is U,
): Iterable<U>;
export function filter<T>(source: Iterable<T> | IterableIterator<T>, predicate: (item: T) => boolean): Iterable<T>;
export function filter<T, U extends T = T>(
	source: Iterable<T> | IterableIterator<T>,
	predicate?: ((item: T) => item is U) | ((item: T) => boolean),
): Iterable<T | U> {
	return new FilterIterator(source, predicate);
}

/**
 * Iterator for filtering and mapping items in one pass
 * Optimized class-based iterator avoiding generator overhead
 */
class FilterMapIterator<T, TMapped> implements IterableIterator<TMapped> {
	private iterator: Iterator<T>;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly predicateMapper: (item: T) => TMapped | undefined | null,
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<TMapped> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		while (true) {
			const result = this.iterator.next();
			if (result.done) {
				this.done = true;
				return { done: true, value: undefined };
			}

			const mapped = this.predicateMapper(result.value);
			if (mapped != null) {
				return { done: false, value: mapped };
			}
		}
	}

	[Symbol.iterator](): IterableIterator<TMapped> {
		return this;
	}
}

export function filterMap<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	predicateMapper: (item: T) => TMapped | undefined | null,
): Iterable<TMapped> {
	return new FilterMapIterator(source, predicateMapper);
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

/**
 * Iterator for flat-mapping items
 * Optimized class-based iterator avoiding generator overhead
 */
class FlatMapIterator<T, TMapped> implements IterableIterator<TMapped> {
	private iterator: Iterator<T>;
	private currentMappedIterator: Iterator<TMapped> | undefined;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly mapper: (item: T) => Iterable<TMapped>,
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<TMapped> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		while (true) {
			// If we have a current mapped iterator, try to get the next value from it
			if (this.currentMappedIterator !== undefined) {
				const mappedResult = this.currentMappedIterator.next();
				if (!mappedResult.done) {
					return { done: false, value: mappedResult.value };
				}
				// Current mapped iterator is exhausted, move to next source item
				this.currentMappedIterator = undefined;
			}

			// Get next item from source
			const result = this.iterator.next();
			if (result.done) {
				this.done = true;
				return { done: true, value: undefined };
			}

			// Map the item and create iterator for the mapped iterable
			const mapped = this.mapper(result.value);
			this.currentMappedIterator = mapped[Symbol.iterator]();
		}
	}

	[Symbol.iterator](): IterableIterator<TMapped> {
		return this;
	}
}

export function flatMap<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	mapper: (item: T) => Iterable<TMapped>,
): IterableIterator<TMapped> {
	return new FlatMapIterator(source, mapper);
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

/**
 * Iterator for mapping items
 * Optimized class-based iterator avoiding generator overhead
 */
class MapIterator<T, TMapped> implements IterableIterator<TMapped> {
	private iterator: Iterator<T>;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly mapper: (item: T) => TMapped,
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<TMapped> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		const result = this.iterator.next();
		if (result.done) {
			this.done = true;
			return { done: true, value: undefined };
		}

		return { done: false, value: this.mapper(result.value) };
	}

	[Symbol.iterator](): IterableIterator<TMapped> {
		return this;
	}
}

export function map<T, TMapped>(
	source: Iterable<T> | IterableIterator<T>,
	mapper: (item: T) => TMapped,
): IterableIterator<TMapped> {
	return new MapIterator(source, mapper);
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

/**
 * Iterator for skipping first N items
 * Optimized class-based iterator avoiding generator overhead
 */
class SkipIterator<T> implements IterableIterator<T> {
	private iterator: Iterator<T>;
	private skipped = 0;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly count: number,
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<T> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		// Skip items until we reach the count
		while (this.skipped < this.count) {
			const result = this.iterator.next();
			if (result.done) {
				this.done = true;
				return { done: true, value: undefined };
			}
			this.skipped++;
		}

		// Return remaining items
		const result = this.iterator.next();
		if (result.done) {
			this.done = true;
			return { done: true, value: undefined };
		}

		return { done: false, value: result.value };
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this;
	}
}

export function skip<T>(source: Iterable<T> | IterableIterator<T>, count: number): IterableIterator<T> {
	return new SkipIterator(source, count);
}

export function slice<T>(source: Iterable<T> | IterableIterator<T>, start: number, end: number): Iterable<T> {
	return skip(take(source, end), start);
}

export function some<T>(source: Iterable<T> | IterableIterator<T>, predicate?: (item: T) => boolean): boolean {
	for (const item of source) {
		if (predicate == null || predicate(item)) return true;
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

/**
 * Iterator for taking first N items
 * Optimized class-based iterator avoiding generator overhead
 */
class TakeIterator<T> implements IterableIterator<T> {
	private iterator: Iterator<T>;
	private taken = 0;
	private done = false;

	constructor(
		source: Iterable<T> | IterableIterator<T>,
		private readonly count: number,
	) {
		this.iterator = source[Symbol.iterator]();
	}

	next(): IteratorResult<T> {
		if (this.done || this.taken >= this.count) {
			this.done = true;
			return { done: true, value: undefined };
		}

		const result = this.iterator.next();
		if (result.done) {
			this.done = true;
			return { done: true, value: undefined };
		}

		this.taken++;
		return { done: false, value: result.value };
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this;
	}
}

export function take<T>(source: Iterable<T> | IterableIterator<T>, count: number): Iterable<T> {
	return new TakeIterator(source, count);
}

/**
 * Iterator for union of multiple iterables
 * Optimized class-based iterator avoiding generator overhead
 */
class UnionIterator<T> implements IterableIterator<T> {
	private sourceIndex = 0;
	private currentIterator: Iterator<T> | undefined;
	private done = false;

	constructor(private readonly sources: (Iterable<T> | IterableIterator<T> | undefined)[]) {}

	next(): IteratorResult<T> {
		if (this.done) {
			return { done: true, value: undefined };
		}

		while (this.sourceIndex < this.sources.length) {
			const source = this.sources[this.sourceIndex];

			// Skip undefined sources
			if (source == null) {
				this.sourceIndex++;
				continue;
			}

			// Initialize iterator for current source if needed
			if (this.currentIterator === undefined) {
				this.currentIterator = source[Symbol.iterator]();
			}

			const result = this.currentIterator.next();
			if (!result.done) {
				return { done: false, value: result.value };
			}

			// Move to next source
			this.sourceIndex++;
			this.currentIterator = undefined;
		}

		this.done = true;
		return { done: true, value: undefined };
	}

	[Symbol.iterator](): IterableIterator<T> {
		return this;
	}
}

export function union<T>(...sources: (Iterable<T> | IterableIterator<T> | undefined)[]): Iterable<T> {
	return new UnionIterator(sources);
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

/**
 * Consumes an async generator and returns its final return value.
 *
 * Async generators can both yield values (via `yield`) and return a final value (via `return`).
 * The `for await` loop only iterates over yielded values and doesn't capture the return value.
 * This helper consumes all yielded values and returns the final return value.
 *
 * @param generator The async generator to consume
 * @param onProgress Optional callback to process each yielded value
 * @returns The final return value from the generator, or undefined if the generator doesn't return a value
 *
 * @example
 * ```typescript
 * async function* myGenerator() {
 *   yield 1;
 *   yield 2;
 *   return { final: 'result' };
 * }
 *
 * const result = await consumeAsyncGenerator(myGenerator());
 * // result = { final: 'result' }
 * ```
 */
export async function getAsyncGeneratorReturnValue<TYield, TReturn>(
	generator: AsyncGenerator<TYield, TReturn, void>,
	onProgress?: (value: TYield) => void | Promise<void>,
): Promise<TReturn | undefined> {
	let result: IteratorResult<TYield, TReturn> | undefined;
	if (onProgress == null) {
		while (!(result = await generator.next()).done) {
			/* noop */
		}
		return result?.value;
	}

	while (!(result = await generator.next()).done) {
		await onProgress(result.value);
	}
	return result?.value;
}
