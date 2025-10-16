import type { UriComponents } from '../system/uri';

// Unified IPC Tagged Types System - allows transparent serialization/deserialization of special types across the IPC boundary

/** Tagged type for Dates that get serialized as timestamps */
export interface IpcDate {
	__ipc: 'date';
	value: number;
}

/** Tagged type for Promises that get resolved asynchronously over IPC */
export interface IpcPromise {
	__ipc: 'promise';
	value: {
		id: string;
		method: string;
	};
	__promise: Promise<unknown>;
}

/** Tagged type for Uris that get serialized as UriComponents */
export interface IpcUri {
	__ipc: 'uri';
	value: UriComponents;
}

export type IpcTaggedType = IpcPromise | IpcDate | IpcUri;

/**
 * @returns the IPC tagged type if the value is one, otherwise undefined
 * More efficient than calling multiple isIpc* functions when you need to handle different types
 */
export function getIpcTaggedType(value: unknown): IpcTaggedType | undefined {
	if (typeof value !== 'object' || value == null) return undefined;

	const ipc = (value as any).__ipc;
	if (ipc == null) return undefined;

	switch (ipc) {
		case 'date':
			return typeof (value as IpcDate).value === 'number' ? (value as IpcDate) : undefined;
		case 'promise':
			return typeof (value as IpcPromise).value === 'object' &&
				typeof (value as IpcPromise).value.id === 'string' &&
				typeof (value as IpcPromise).value.method === 'string'
				? (value as IpcPromise)
				: undefined;
		case 'uri':
			return typeof (value as IpcUri).value === 'object' && typeof (value as IpcUri).value?.scheme === 'string'
				? (value as IpcUri)
				: undefined;
		default:
			return undefined;
	}
}

export function isIpcTaggedType(value: unknown): value is IpcTaggedType {
	return getIpcTaggedType(value) != null;
}

export function isIpcDate(value: unknown): value is IpcDate {
	return getIpcTaggedType(value)?.__ipc === 'date';
}

export function isIpcPromise(value: unknown): value is IpcPromise {
	return getIpcTaggedType(value)?.__ipc === 'promise';
}

export function isIpcUri(value: unknown): value is IpcUri {
	return getIpcTaggedType(value)?.__ipc === 'uri';
}
