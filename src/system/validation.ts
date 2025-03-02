export type Validator<T> = (data: unknown) => data is T;

export const Is = Object.freeze({
	String: (data: unknown): data is string => typeof data === 'string',
	Number: (data: unknown): data is number => typeof data === 'number',
	Boolean: (data: unknown): data is boolean => typeof data === 'boolean',
	Object: (data: unknown): data is object => data != null && typeof data === 'object',
	Array:
		<T>(elementValidator: Validator<T>): Validator<T[]> =>
		(data: unknown): data is T[] =>
			Array.isArray(data) && data.every(elementValidator),

	Enum:
		<T extends string | number>(...values: T[]): Validator<T> =>
		(data: unknown): data is T =>
			values.includes(data as T),
	// Literal:
	// 	<T extends string | number | boolean>(value: T): Validator<T> =>
	// 	(data: unknown): data is T =>
	// 		data === value,
	Optional:
		<T>(validator: Validator<T>): Validator<T | undefined> =>
		(data: unknown): data is T | undefined =>
			data === undefined || validator(data),
	// Union:
	// 	<T extends unknown[]>(...validators: { [K in keyof T]: Validator<T[K]> }): Validator<T[number]> =>
	// 	(data: unknown): data is T[number] =>
	// 		validators.some(v => v(data)),
});

export function createValidator<T extends object>(shape: { [K in keyof T]: Validator<T[K]> }): Validator<T> {
	return (data: unknown): data is T => {
		if (!Is.Object(data)) return false;

		const entries = Object.entries(shape) as [keyof T, Validator<T[keyof T]>][];
		return entries.every(([key, validator]) => validator((data as Record<keyof T, unknown>)[key]));
	};
}
