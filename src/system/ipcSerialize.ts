import type { Uri } from 'vscode';
import { deserializeIpcJsonReviver, serializeIpcJsonReplacer } from '@env/json';
import type { Container } from '../container';
import type { IpcPromise } from '../webviews/ipc';
import type { Branded } from './brand';

// prettier-ignore
export type IpcSerialized<T> =
	// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
	T extends Error | Function | RegExp | Container
	? never
	: T extends Date
	? Date
	: T extends Uri
	? Uri
	: T extends Promise<infer U>
	? Promise<IpcSerialized<U>>
	: T extends Map<infer K, infer V>
	? [IpcSerialized<K>, IpcSerialized<V>][]
	: T extends Set<infer U>
	? IpcSerialized<U>[]
	: T extends Branded<infer U, any>
	? U
	: T extends any[]
	? IpcSerialized<T[number]>[]
	: T extends object
	? { [K in keyof T]: T[K] extends Date ? Date : IpcSerialized<T[K]> }
	: T;

export function serializeIpcData<T>(obj: T, nextIpcId: () => string, pendingPromises: IpcPromise[]): string;
export function serializeIpcData<T>(
	obj: T | undefined,
	nextIpcId: () => string,
	pendingPromises: IpcPromise[],
): string | undefined;
export function serializeIpcData<T>(
	obj: T | undefined,
	nextIpcId: () => string,
	pendingPromises: IpcPromise[],
): string | undefined {
	if (obj == null) return undefined;

	return JSON.stringify(obj, function (this: any, key: string, value: unknown) {
		return serializeIpcJsonReplacer.call(this, key, value, nextIpcId, pendingPromises);
	});
}

export function deserializeIpcData<T>(
	data: string,
	promiseFactory: (value: IpcPromise['value']) => Promise<unknown>,
): T {
	return JSON.parse(data, (k, v) => deserializeIpcJsonReviver(k, v, promiseFactory)) as T;
}
