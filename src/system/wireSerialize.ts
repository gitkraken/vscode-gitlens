import type { Uri } from 'vscode';
import { deserializeWireJsonReviver, serializeWireJsonReplacer } from '@env/json.js';
import type { Branded } from '@gitlens/utils/brand.js';
import type { Container } from '../container.js';

// prettier-ignore
export type WireSerialized<T> =
	// oxlint-disable-next-line typescript/no-unsafe-function-type
	T extends Error | Function | RegExp | Container
	? never
	: T extends Date
	? Date
	: T extends Uri
	? Uri
	: T extends Promise<infer U>
	? Promise<WireSerialized<U>>
	: T extends Map<infer K, infer V>
	? [WireSerialized<K>, WireSerialized<V>][]
	: T extends Set<infer U>
	? WireSerialized<U>[]
	: T extends Branded<infer U, any>
	? U
	: T extends any[]
	? WireSerialized<T[number]>[]
	: T extends object
	? { [K in keyof T]: T[K] extends Date ? Date : WireSerialized<T[K]> }
	: T;

export function serializeWireData<T>(obj: T): string;
export function serializeWireData<T>(obj: T | undefined): string | undefined;
export function serializeWireData<T>(obj: T | undefined): string | undefined {
	if (obj == null) return undefined;

	return JSON.stringify(obj, function (this: any, key: string, value: unknown) {
		return serializeWireJsonReplacer.call(this, key, value);
	});
}

export function deserializeWireData<T>(data: string): T {
	return JSON.parse(data, deserializeWireJsonReviver) as T;
}
