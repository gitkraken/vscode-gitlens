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

type FlattenSpread<T extends object, P extends string | undefined> = T extends ReadonlyArray<any>
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

export function entries<TKey extends PropertyKey, TVal>(o: Partial<Record<TKey, TVal>>): [TKey, TVal][] {
	return Object.entries(o) as [TKey, TVal][];
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
	obj: Record<string, T> | undefined,
	key: string,
	value: T | undefined,
): Record<string, T> {
	if (obj == null) {
		obj = Object.create(null) as Record<string, T>;
	}

	if (value != null && (typeof value !== 'boolean' || value)) {
		if (typeof value === 'object') {
			obj[key] = { ...value };
		} else {
			obj[key] = value;
		}
	} else {
		const { [key]: _, ...rest } = obj;
		obj = rest;
	}
	return obj;
}
