export function areEqual(a: any, b: any): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;

	const aType = typeof a;
	if (aType === typeof b && (aType === 'string' || aType === 'number' || aType === 'boolean')) return false;

	return JSON.stringify(a) === JSON.stringify(b);
}

export function flatten(o: any, options: { prefix?: string; skipNulls: true; stringify: true }): Record<string, string>;
export function flatten(
	o: any,
	options: { prefix?: string; skipNulls: true; stringify?: false },
): Record<string, NonNullable<any>>;
export function flatten(
	o: any,
	options: { prefix?: string; skipNulls?: false; stringify: true },
): Record<string, string | null>;
export function flatten(
	o: any,
	options: { prefix?: string; skipNulls?: false; stringify: 'all' },
): Record<string, string>;
export function flatten(
	o: any,
	options?: { prefix?: string; skipNulls?: boolean; stringify?: boolean },
): Record<string, any>;
export function flatten(
	o: any,
	options?: { prefix?: string; skipNulls?: boolean; stringify?: boolean | 'all' },
): Record<string, any> {
	const skipNulls = options?.skipNulls ?? false;
	const stringify = options?.stringify ?? false;

	function flattenCore(flattened: Record<string, any>, key: string, value: any) {
		if (Object(value) !== value) {
			if (value == null) {
				if (skipNulls) return;

				flattened[key] = stringify ? (stringify == 'all' ? JSON.stringify(value) : value ?? null) : value;
			} else if (typeof value === 'string') {
				flattened[key] = value;
			} else {
				flattened[key] = stringify ? JSON.stringify(value) : value;
			}
		} else if (Array.isArray(value)) {
			const len = value.length;
			if (len === 0) return;

			for (let i = 0; i < len; i++) {
				flattenCore(flattened, `${key}[${i}]`, value[i]);
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
