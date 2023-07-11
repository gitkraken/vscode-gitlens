export function areEqual(a: any, b: any): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	const aType = typeof a;
	if (aType === typeof b && (aType === 'string' || aType === 'number' || aType === 'boolean')) return false;

	return JSON.stringify(a) === JSON.stringify(b);
}

export function flatten(
	o: any,
	options: { arrays?: 'join' | 'spread'; prefix?: string; skipPaths?: string[]; skipNulls: true; stringify: true },
): Record<string, string>;
export function flatten(
	o: any,
	options: { arrays?: 'join' | 'spread'; prefix?: string; skipPaths?: string[]; skipNulls: true; stringify?: false },
): Record<string, NonNullable<any>>;
export function flatten(
	o: any,
	options: {
		arrays?: 'join' | 'spread';
		prefix?: string;
		skipPaths?: string[];
		skipNulls?: false;
		stringify: true | 'all';
	},
): Record<string, string | null>;
export function flatten(
	o: any,
	options?: {
		arrays?: 'join' | 'spread';
		prefix?: string;
		skipPaths?: string[];
		skipNulls?: boolean;
		stringify?: boolean;
	},
): Record<string, any>;
export function flatten(
	o: any,
	options?: {
		arrays?: 'join' | 'spread';
		prefix?: string;
		skipPaths?: string[];
		skipNulls?: boolean;
		stringify?: boolean | 'all';
	},
): Record<string, any> {
	const skipPaths = options?.skipPaths?.length
		? options?.prefix
			? options.skipPaths.map(p => `${options.prefix}.${p}`)
			: options.skipPaths
		: undefined;
	const skipNulls = options?.skipNulls ?? false;
	const stringify = options?.stringify ?? false;

	function flattenCore(flattened: Record<string, any>, key: string, value: any) {
		if (skipPaths?.includes(key)) return;

		if (Object(value) !== value) {
			if (value == null) {
				if (skipNulls) return;

				flattened[key] = stringify ? (stringify == 'all' ? JSON.stringify(value) : value ?? null) : value;
			} else if (typeof value === 'string') {
				flattened[key] = value;
			} else if (stringify) {
				flattened[key] =
					typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value);
			} else {
				flattened[key] = value;
			}
		} else if (Array.isArray(value)) {
			const len = value.length;
			if (len === 0) return;

			if (options?.arrays === 'join') {
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
	flattenCore(flattened, options?.prefix ?? '', o);
	return flattened;
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
