import type { UriComponents } from '../../../system/uri.js';

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
