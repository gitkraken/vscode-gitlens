import { URI } from 'vscode-uri';
import { isLoggable } from '@gitlens/utils/loggable.js';
import type { WireDate } from '../../system/taggedValues.js';
import { getWireTaggedType } from '../../system/taggedValues.js';

export function loggingJsonReplacer(key: string, value: unknown): unknown {
	if (key === '' || value == null || typeof value !== 'object') return value;
	// Filter out properties starting with '_' to avoid logging private/internal properties
	if (key.charCodeAt(0) === 95) return undefined; // '_' = 95

	if (value instanceof URI) {
		if ('sha' in value && typeof value.sha === 'string' && value.sha) {
			return `${value.sha}:${value.toString()}`;
		}
		return value.toString();
	}
	if (value instanceof Error) return String(value);

	if (isLoggable(value)) return value.toLoggable();

	return value;
}

export function serializeJsonReplacer(this: any, key: string, value: unknown): unknown {
	if (typeof value === 'object' && value != null) {
		// Dates and Uris are automatically converted by JSON.stringify, so we check the original below
		// if (value instanceof Date) return value.getTime();
		if (value instanceof RegExp) return value.toString();
		if (value instanceof Map || value instanceof Set) return [...value.entries()];
		if (value instanceof Function || value instanceof Error) return undefined;
	}

	const original = this[key];
	if (original !== value && typeof original === 'object' && original != null) {
		if (original instanceof Date) return original.getTime();
	}
	return value;
}

export function serializeWireJsonReplacer(this: any, key: string, value: unknown): unknown {
	if (typeof value === 'object' && value != null) {
		// Dates and Uris are automatically converted by JSON.stringify, so we check the original below
		// if (value instanceof Date) {
		// 	return { __wire: 'date', value: value.getTime() } satisfies WireDate;
		// }
		// if (value instanceof Uri) {
		// 	return { __wire: 'uri', value: value.toJSON() } satisfies WireUri;
		// }
		if (value instanceof RegExp) return value.toString();
		if (value instanceof Map || value instanceof Set) return [...value.entries()];
		// Promises can't survive serialization (JSON.stringify silently yields `{}`), so drop them like the other unsupported types
		if (value instanceof Error || value instanceof Function || value instanceof Promise) return undefined;
		// if (isContainer(value)) return undefined;
	}

	if (!key) return value;

	const original = this[key];
	if (original !== value && typeof original === 'object' && original != null) {
		if (original instanceof Date) {
			return { __wire: 'date', value: original.getTime() } satisfies WireDate;
		}
		// if (original instanceof Uri) {
		// 	return { __wire: 'uri', value: original.toJSON() } satisfies WireUri;
		// }
	}
	return value;
}

export function deserializeWireJsonReviver(_key: string, value: unknown): unknown {
	const tagged = getWireTaggedType(value);
	if (tagged == null) return value;

	switch (tagged.__wire) {
		case 'date':
			return new Date(tagged.value);
		case 'uri':
			return URI.revive(tagged.value);
	}
}
