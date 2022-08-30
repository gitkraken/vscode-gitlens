// eslint-disable-next-line no-restricted-imports
export { isEqual as areEqual } from 'lodash-es';

export function flatten(o: any, prefix: string = '', stringify: boolean = false): Record<string, any> {
	const flattened = Object.create(null) as Record<string, any>;
	_flatten(flattened, prefix, o, stringify);
	return flattened;
}

function _flatten(flattened: Record<string, any>, key: string, value: any, stringify: boolean = false) {
	if (Object(value) !== value) {
		if (stringify) {
			if (value == null) {
				flattened[key] = null;
			} else if (typeof value === 'string') {
				flattened[key] = value;
			} else {
				flattened[key] = JSON.stringify(value);
			}
		} else {
			flattened[key] = value;
		}
	} else if (Array.isArray(value)) {
		const len = value.length;
		for (let i = 0; i < len; i++) {
			_flatten(flattened, `${key}[${i}]`, value[i], stringify);
		}
		if (len === 0) {
			flattened[key] = null;
		}
	} else {
		let isEmpty = true;
		for (const p in value) {
			isEmpty = false;
			_flatten(flattened, key ? `${key}.${p}` : p, value[p], stringify);
		}
		if (isEmpty && key) {
			flattened[key] = null;
		}
	}
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
