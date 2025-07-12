export function loggingJsonReplacer(key: string, value: unknown): unknown {
	if (key === '' || value == null || typeof value !== 'object') return value;

	if (value instanceof Error) return String(value);

	return value;
}

export function serializeJsonReplacer(this: any, key: string, value: unknown): unknown {
	if (value instanceof Date) return value.getTime();
	if (value instanceof Map || value instanceof Set) return [...value.entries()];
	if (value instanceof Function || value instanceof Error) return undefined;
	if (value instanceof RegExp) return value.toString();

	const original = this[key];
	return original instanceof Date ? original.getTime() : value;
}
