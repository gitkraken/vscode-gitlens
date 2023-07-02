export type Serialized<T> = T extends Function
	? never
	: T extends Date
	? number
	: T extends object
	? {
			[K in keyof T]: T[K] extends Date ? number : Serialized<T[K]>;
	  }
	: T;

export function serialize<T extends object>(obj: T): Serialized<T> {
	try {
		function replacer(this: any, key: string, value: unknown) {
			if (value instanceof Date) return value.getTime();
			if (value instanceof Map || value instanceof Set) return [...value.entries()];
			if (value instanceof Function || value instanceof Error) return undefined;
			if (value instanceof RegExp) return value.toString();

			const original = this[key];
			return original instanceof Date ? original.getTime() : value;
		}
		return JSON.parse(JSON.stringify(obj, replacer)) as Serialized<T>;
	} catch (ex) {
		debugger;
		throw ex;
	}
}
