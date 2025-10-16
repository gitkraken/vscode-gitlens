import { Uri } from 'vscode';
import { isContainer } from '../../container';
import { isBranch } from '../../git/models/branch';
import { isCommit } from '../../git/models/commit';
import { isRemote } from '../../git/models/remote';
import { isRepository } from '../../git/models/repository';
import { isTag } from '../../git/models/tag';
import { isWorktree } from '../../git/models/worktree';
import { isViewNode } from '../../views/nodes/utils/-webview/node.utils';
import type { IpcDate, IpcPromise, IpcUri } from '../../webviews/ipc';
import { getIpcTaggedType, isIpcPromise } from '../../webviews/ipc';
import { IpcPromiseSettled } from '../../webviews/protocol';

export function loggingJsonReplacer(key: string, value: unknown): unknown {
	if (key === '' || value == null || typeof value !== 'object') return value;
	if (key.charCodeAt(0) === 95) return undefined; // '_' = 95

	if (value instanceof Uri) {
		if ('sha' in value && typeof value.sha === 'string' && value.sha) {
			return `${value.sha}:${value.toString()}`;
		}
		return value.toString();
	}
	if (value instanceof Error) return String(value);

	// Checks for toString first to avoid function calls if possible
	if (
		'toString' in value &&
		typeof value.toString === 'function' &&
		(isRepository(value) ||
			isBranch(value) ||
			isCommit(value) ||
			isRemote(value) ||
			isTag(value) ||
			isWorktree(value) ||
			isViewNode(value))
	) {
		return value.toString();
	}
	if (isContainer(value)) return '<container>';

	return value;
}

export function serializeJsonReplacer(this: any, key: string, value: unknown): unknown {
	if (typeof value === 'object' && value != null) {
		// Dates and Uris are automatically converted by JSON.stringify, so we check the original below
		// if (value instanceof Date) return value.getTime();
		// if (value instanceof Uri) return value.toString();
		if (value instanceof RegExp) return value.toString();
		if (value instanceof Map || value instanceof Set) return [...value.entries()];
		if (value instanceof Error || value instanceof Function) return undefined;
		if (isContainer(value)) return undefined;
	}

	const original = this[key];
	if (original !== value && typeof original === 'object' && original != null) {
		if (original instanceof Date) return original.getTime();
		if (original instanceof Uri) return original.toString();
	}
	return value;
}

export function serializeIpcJsonReplacer(
	this: any,
	key: string,
	value: unknown,
	nextIpcId: () => string,
	pendingPromises: IpcPromise[],
): unknown {
	// Filter out __promise property from IpcPromise objects to avoid circular references
	if (key === '__promise') return undefined;

	if (typeof value === 'object' && value != null) {
		if ('__ipc' in value) {
			if (isIpcPromise(value)) {
				value.value.id = nextIpcId();
				pendingPromises.push(value);
			}
			return value;
		}

		// Dates and Uris are automatically converted by JSON.stringify, so we check the original below
		// if (value instanceof Date) {
		// 	return { __ipc: 'date', value: value.getTime() } satisfies IpcDate;
		// }
		// if (value instanceof Uri) {
		// 	return { __ipc: 'uri', value: value.toJSON() } satisfies IpcUri;
		// }
		if (value instanceof Promise) {
			const ipcPromise: IpcPromise = {
				__ipc: 'promise',
				__promise: value,
				value: {
					id: nextIpcId(),
					method: IpcPromiseSettled.method,
				},
			};
			pendingPromises.push(ipcPromise);
			return ipcPromise;
		}

		if (value instanceof RegExp) return value.toString();
		if (value instanceof Map || value instanceof Set) return [...value.entries()];
		if (value instanceof Error || value instanceof Function) return undefined;
		if (isContainer(value)) return undefined;
	}

	if (!key) return value;

	const original = this[key];
	if (original !== value && typeof original === 'object' && original != null) {
		if (original instanceof Date) {
			return { __ipc: 'date', value: original.getTime() } satisfies IpcDate;
		}
		if (original instanceof Uri) {
			return { __ipc: 'uri', value: original.toJSON() } satisfies IpcUri;
		}
	}
	return value;
}

export function deserializeIpcJsonReviver(
	_key: string,
	value: unknown,
	promiseFactory: (value: IpcPromise['value']) => Promise<unknown>,
): unknown {
	const tagged = getIpcTaggedType(value);
	if (tagged == null) return value;

	switch (tagged.__ipc) {
		case 'date':
			return new Date(tagged.value);
		case 'promise':
			return promiseFactory(tagged.value);
		case 'uri':
			return Uri.from(tagged.value);
	}
}
