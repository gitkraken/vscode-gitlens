import type { Uri } from 'vscode';
import { serializeJsonReplacer } from '@env/json';
import type { Container } from '../container';
import type { Branded } from './brand';

// prettier-ignore
export type Serialized<T, TDate extends number | string = number> =
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	T extends Error |Function |  Container
	? never
	: T extends Date
	? TDate
	: T extends Uri | RegExp
	? string
	: T extends Map<infer K, infer V>
	? [Serialized<K, TDate>, Serialized<V, TDate>][]
	: T extends Set<infer U>
	? Serialized<U, TDate>[]
	: T extends Branded<infer U, any>
	? U
	: T extends any[]
	? Serialized<T[number], TDate>[]
	: T extends object
	? { [K in keyof T]: T[K] extends Date ? TDate : Serialized<T[K], TDate> }
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
