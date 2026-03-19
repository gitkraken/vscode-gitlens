import type { Uri } from 'vscode';
import { serializeJsonReplacer } from '@env/json.js';
import type { Branded } from '@gitlens/utils/brand.js';
import type { Container } from '../container.js';

// prettier-ignore
type _Serialized<T, TDate extends number | string = number, TExclude = never, TStringify = never> =
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	T extends Error | Function | TExclude
	? never
	: T extends Date
	? TDate
	: T extends RegExp | TStringify
	? string
	: T extends Map<infer K, infer V>
	? [_Serialized<K, TDate, TExclude, TStringify>, _Serialized<V, TDate, TExclude, TStringify>][]
	: T extends Set<infer U>
	? _Serialized<U, TDate, TExclude, TStringify>[]
	: T extends Branded<infer U, any>
	? U
	: T extends any[]
	? _Serialized<T[number], TDate, TExclude, TStringify>[]
	: T extends object
	? { [K in keyof T]: T[K] extends Date ? TDate : _Serialized<T[K], TDate, TExclude, TStringify> }
	: T;

export type Serialized<T, TDate extends number | string = number> = _Serialized<T, TDate, Container, Uri>;

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
