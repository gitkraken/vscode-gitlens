/**
 * Structural deep-equality. Walks both values and short-circuits on the first difference without
 * serializing to a string (unlike a `JSON.stringify` compare): the `a === b` fast path skips
 * unchanged shared subtrees, and unequal values bail at the first mismatched field. Handles
 * primitives, `null`/`undefined`, `Date` (by timestamp), arrays, and plain objects.
 *
 * Differs from the prior `JSON.stringify` compare in three ways — each intended or matching the old
 * behavior:
 * - Key-order-insensitive (the old compare was order-sensitive). Observable at one caller
 *   (`configuration.update`, when a config value equals its schema default but with different key
 *   order), where it harmlessly treats the value as the default rather than persisting a redundant
 *   override.
 * - A present-but-`undefined` key is distinct from an absent key (the old compare dropped
 *   `undefined` keys).
 * - `Map`/`Set`/`RegExp` and other exotic objects are NOT deep-compared — they reduce to their
 *   own-enumerable keys (so two are effectively always-equal), same as the old stringify behavior.
 *   No caller compares those.
 *
 * Assumes acyclic input — it recurses without a cycle guard (a self-referential value would
 * overflow the stack). Every caller compares JSON-origin or same-shape data.
 */
export function areEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	const type = typeof a;
	if (type !== typeof b || type !== 'object') return false;

	// Both are non-null objects from here.
	if (a instanceof Date) return b instanceof Date && a.getTime() === b.getTime();
	if (b instanceof Date) return false;

	const aIsArray = Array.isArray(a);
	if (aIsArray !== Array.isArray(b)) return false;

	if (aIsArray) {
		const arrA = a as unknown[];
		const arrB = b as unknown[];
		if (arrA.length !== arrB.length) return false;

		for (let i = 0; i < arrA.length; i++) {
			if (!areEqual(arrA[i], arrB[i])) return false;
		}
		return true;
	}

	const objA = a as Record<string, unknown>;
	const objB = b as Record<string, unknown>;
	const keysA = Object.keys(objA);
	if (keysA.length !== Object.keys(objB).length) return false;

	// Equal key COUNT alone doesn't prove equal key SETS — without the `hasOwn` check,
	// `{ a: 1, b: undefined }` and `{ a: 1, c: undefined }` would falsely compare equal (each
	// missing key reads as `undefined`). The count check plus "every A-key is an own-key of B"
	// together guarantee identical key sets.
	for (const key of keysA) {
		if (!Object.hasOwn(objB, key) || !areEqual(objA[key], objB[key])) return false;
	}
	return true;
}

type Primitive = string | number | boolean;
type FlattenedValue = string | number | boolean;
type AddPrefix<P extends string | undefined, K extends string> = P extends '' | undefined ? K : `${P}.${K}`;
type AddArrayIndex<P extends string | undefined, I extends number> = P extends '' | undefined ? `[${I}]` : `${P}[${I}]`;

type Merge<U> = MergeUnion<U extends object ? { [K in keyof U]: U[K] } : never>;
type MergeUnion<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
	? { [K in keyof I]: I[K] }
	: never;

type FlattenArray<T extends object, P extends string | undefined> = T extends (infer U)[]
	? U extends object
		? { [Key in `${AddArrayIndex<P, number>}.${string}`]: FlattenedValue }
		: { [Key in AddArrayIndex<P, number>]: FlattenedValue }
	: T extends object
		? { [Key in `${AddArrayIndex<P, number>}.${string}`]: FlattenedValue }
		: { [Key in AddArrayIndex<P, number>]: FlattenedValue };

type FlattenSpread<T extends object, P extends string | undefined> =
	T extends ReadonlyArray<any>
		? FlattenArray<T, P>
		: {
				[K in keyof T & string]: NonNullable<T[K]> extends Primitive
					? { [Key in AddPrefix<P, K>]: NonNullable<T[K]> }
					: T[K] extends ReadonlyArray<any>
						? FlattenArray<T[K], AddPrefix<P, K>>
						: T[K] extends object
							? FlattenSpread<T[K], AddPrefix<P, K>>
							: { [Key in AddPrefix<P, K>]: string };
			}[keyof T & string];

type FlattenJoin<T extends object, P extends string | undefined> = {
	[K in keyof T & string]: NonNullable<T[K]> extends Primitive
		? { [Key in AddPrefix<P, K>]: NonNullable<T[K]> }
		: T[K] extends ReadonlyArray<any>
			? { [Key in AddPrefix<P, K>]: string }
			: T[K] extends object
				? FlattenJoin<T[K], AddPrefix<P, K>>
				: { [Key in AddPrefix<P, K>]: string };
}[keyof T & string];

export type Flatten<
	T extends object | null | undefined,
	P extends string | undefined,
	JoinArrays extends boolean,
> = T extends object ? Merge<JoinArrays extends true ? FlattenJoin<T, P> : FlattenSpread<T, P>> : object;

type FlattenOptions = {
	joinArrays?: boolean;
	skipPaths?: string[];
};

export function flatten<T extends object | null | undefined, P extends string | undefined, O extends FlattenOptions>(
	o: T,
	prefix?: P,
	options?: O,
): Flatten<T, P, NonNullable<O['joinArrays']> extends true ? true : false> {
	const joinArrays = options?.joinArrays ?? false;

	const skipPaths = options?.skipPaths?.length
		? prefix
			? options.skipPaths.map(p => `${prefix}.${p}`)
			: options.skipPaths
		: undefined;

	function flattenCore(flattened: Record<string, any>, key: string, value: any) {
		if (skipPaths?.includes(key)) return;

		if (Object(value) !== value) {
			if (value == null) return;

			flattened[key] =
				typeof value === 'string'
					? value
					: typeof value === 'number' || typeof value === 'boolean'
						? value
						: JSON.stringify(value);
		} else if (Array.isArray(value)) {
			const len = value.length;
			if (len === 0) return;

			if (joinArrays) {
				flattened[key] = value.join(',');
			} else {
				for (let i = 0; i < len; i++) {
					flattenCore(flattened, `${key}[${i}]`, value[i]);
				}
			}
		} else {
			const entries = Object.entries(value);
			if (entries.length === 0) return;

			for (const [k, v] of entries) {
				flattenCore(flattened, key ? `${key}.${k}` : k, v);
			}
		}
	}

	const flattened: Record<string, any> = Object.create(null);
	flattenCore(flattened, prefix ?? '', o);
	return flattened as Flatten<T, P, NonNullable<O['joinArrays']> extends true ? true : false>;
}

export function filterMap<T, TMapped>(
	o: Record<string, T> | undefined,
	predicateMapper: (key: string, value: T) => TMapped | null | undefined,
): Record<string, TMapped> {
	if (o == null) return {};

	const result: Record<string, TMapped> = {};
	for (const [key, value] of Object.entries(o)) {
		const mapped = predicateMapper(key, value);
		if (mapped == null) continue;

		result[key] = mapped;
	}
	return result;
}

export function filterMapEntries<T, TMapped>(
	o: Record<string, T> | undefined,
	predicateMapper: (key: string, value: T) => TMapped | null | undefined,
): [string, TMapped][] {
	if (o == null) return [];

	const result: [string, TMapped][] = [];
	for (const [key, value] of Object.entries(o)) {
		const mapped = predicateMapper(key, value);
		if (mapped == null) continue;

		result.push([key, mapped]);
	}
	return result;
}

export function filterMapValues<T, TMapped>(
	o: Record<string, T> | undefined,
	predicateMapper: (value: T) => TMapped | null | undefined,
): TMapped[] {
	if (o == null) return [];

	const result: TMapped[] = [];
	for (const key in o) {
		const mapped = predicateMapper(o[key]);
		if (mapped == null) continue;

		result.push(mapped);
	}
	return result;
}

export function paths(o: Record<string, any>, path?: string): string[] {
	const results = [];

	for (const key in o) {
		const child = o[key];
		if (typeof child === 'object') {
			results.push(...paths(child, path === undefined ? key : `${path}.${key}`));
		} else {
			results.push(path === undefined ? key : `${path}.${key}`);
		}
	}

	return results;
}

export function updateRecordValue<T>(
	o: Record<string, T> | undefined,
	key: string,
	value: T | undefined,
): Record<string, T> {
	o ??= Object.create(null) as Record<string, T>;

	if (value != null && (typeof value !== 'boolean' || value)) {
		if (typeof value === 'object') {
			o[key] = { ...value };
		} else {
			o[key] = value;
		}
	} else {
		const { [key]: _, ...rest } = o;
		o = rest;
	}
	return o;
}

/**
 * Efficiently checks if an object has at least one own enumerable property
 * @param o - The object to check
 * @returns true if the object has at least one own enumerable property, false otherwise
 */
export function hasKeys(o: Record<string, any> | null | undefined): o is Record<string, any> {
	for (const k in o) {
		if (Object.hasOwn(o, k)) return true;
	}
	return false;
}

/**
 * Efficiently checks if an object has at least the specified number of truthy values (or at least one if not specified)
 * @param o - The object to check (typically a Record<string, boolean>)
 * @param required - The minimum number of truthy values required (default: 1)
 * @returns true if the object has at least the required number of properties with truthy values
 */
export function hasTruthyKeys(
	o: Record<string, any> | null | undefined,
	required: number = 1,
): o is Record<string, any> {
	let count = 0;
	for (const k in o) {
		if (Object.hasOwn(o, k) && o[k]) {
			count++;
			if (count >= required) return true; // Early exit once we know we have enough
		}
	}
	return count >= required;
}
