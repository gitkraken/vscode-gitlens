/** Tagged type for Promises that get resolved asynchronously over IPC */
export interface IpcPromise {
	__ipc: 'promise';
	value: {
		id: string;
		method: string;
	};
	__promise: Promise<unknown>;
}

export function isIpcPromise(value: unknown): value is IpcPromise {
	return (
		typeof value === 'object' &&
		value != null &&
		(value as IpcPromise).__ipc === 'promise' &&
		typeof (value as IpcPromise).value.id === 'string' &&
		typeof (value as IpcPromise).value.method === 'string'
	);
}
