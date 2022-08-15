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
	function replacer(this: any, key: string, value: unknown) {
		const original = this[key];
		return original instanceof Date ? original.getTime() : value;
	}
	return JSON.parse(JSON.stringify(obj, replacer)) as Serialized<T>;
}
