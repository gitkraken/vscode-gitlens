export function areEqual(a: any, b: any): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	const aType = typeof a;
	if (aType === typeof b && (aType === 'string' || aType === 'number' || aType === 'boolean')) return false;

	return JSON.stringify(a) === JSON.stringify(b);
}

type AddPrefix<P extends string | undefined, K extends string> = P extends '' | undefined ? K : `${P}.${K}`;
type AddArrayIndex<P extends string | undefined, I extends number> = P extends '' | undefined ? `[${I}]` : `${P}[${I}]`;

type Merge<U> = MergeUnion<U extends object ? { [K in keyof U]: U[K] } : never>;
type MergeUnion<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
	? { [K in keyof I]: I[K] }
	: never;

type FlattenArray<T extends object, P extends string | undefined> = T extends (infer U)[]
	? U extends object
		? { [Key in `${AddArrayIndex<P, number>}.${string}`]: string | number | boolean }
		: { [Key in AddArrayIndex<P, number>]: string | number | boolean }
	: T extends object
		? { [Key in `${AddArrayIndex<P, number>}.${string}`]: string | number | boolean }
		: { [Key in AddArrayIndex<P, number>]: string | number | boolean };

type FlattenSpread<T extends object, P extends string | undefined> =
	T extends ReadonlyArray<any>
		? FlattenArray<T, P>
		: {
				[K in keyof T]: T[K] extends ReadonlyArray<any>
					? FlattenArray<T[K], AddPrefix<P, Extract<K, string>>>
					: T[K] extends object
						? FlattenSpread<T[K], AddPrefix<P, Extract<K, string>>>
						: {
								[Key in AddPrefix<P, Extract<K, string>>]: T[K] extends string | number | boolean
									? T[K]
									: string;
							};
			}[keyof T];

type FlattenJoin<T extends object, P extends string | undefined> = {
	[K in keyof T]: T[K] extends ReadonlyArray<any>
		? { [Key in AddPrefix<P, Extract<K, string>>]: string }
		: T[K] extends object
			? FlattenJoin<T[K], AddPrefix<P, Extract<K, string>>>
			: {
					[Key in AddPrefix<P, Extract<K, string>>]: T[K] extends string | number | boolean ? T[K] : string;
				};
}[keyof T];

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
	if (o == null) {
		o = Object.create(null) as Record<string, T>;
	}

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
