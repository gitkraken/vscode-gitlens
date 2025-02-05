import type { Uri } from 'vscode';
import { serializeJsonReplacer } from '@env/json';
import type { Branded } from './brand';

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
		return JSON.parse(JSON.stringify(obj, serializeJsonReplacer)) as Serialized<T>;
	} catch (ex) {
		debugger;
		throw ex;
	}
}
