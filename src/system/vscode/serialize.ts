import { Uri } from 'vscode';
import type { Branded } from '../brand';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export type Serialized<T> = T extends Function
	? never
	: T extends Date
	  ? number
	  : T extends Uri
	    ? string
	    : T extends Branded<infer U, any>
	      ? U
	      : T extends any[]
	        ? Serialized<T[number]>[]
	        : T extends object
	          ? {
								[K in keyof T]: T[K] extends Date ? number : Serialized<T[K]>;
	            }
	          : T;

export function serialize<T extends object>(obj: T): Serialized<T>;
export function serialize<T extends object>(obj: T | undefined): Serialized<T> | undefined;
export function serialize<T extends object>(obj: T | undefined): Serialized<T> | undefined {
	if (obj == null) return undefined;

	try {
		function replacer(this: any, key: string, value: unknown) {
			if (value instanceof Date) return value.getTime();
			if (value instanceof Map || value instanceof Set) return [...value.entries()];
			if (value instanceof Function || value instanceof Error) return undefined;
			if (value instanceof RegExp) return value.toString();
			if (value instanceof Uri) return value.toString();

			const original = this[key];
			return original instanceof Date
				? original.getTime()
				: original instanceof Uri
				  ? original.toString()
				  : value;
		}
		return JSON.parse(JSON.stringify(obj, replacer)) as Serialized<T>;
	} catch (ex) {
		debugger;
		throw ex;
	}
}
