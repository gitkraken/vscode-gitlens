import type { UriComponents } from '@gitlens/utils/uri.js';

// Tagged values allow transparent serialization/deserialization of special types across the webview boundary

/** Tagged type for Dates that get serialized as timestamps */
export interface IpcDate {
	__ipc: 'date';
	value: number;
}

/** Tagged type for Uris that get serialized as UriComponents */
export interface IpcUri {
	__ipc: 'uri';
	value: UriComponents;
}

export type IpcTaggedType = IpcDate | IpcUri;

/**
 * @returns the tagged type if the value is one, otherwise undefined
 * More efficient than calling multiple isIpc* functions when you need to handle different types
 */
export function getIpcTaggedType(value: unknown): IpcTaggedType | undefined {
	if (typeof value !== 'object' || value == null) return undefined;

	const ipc = (value as any).__ipc;
	if (ipc == null) return undefined;

	switch (ipc) {
		case 'date':
			return typeof (value as IpcDate).value === 'number' ? (value as IpcDate) : undefined;
		case 'uri':
			return typeof (value as IpcUri).value === 'object' && typeof (value as IpcUri).value?.scheme === 'string'
				? (value as IpcUri)
				: undefined;
		default:
			return undefined;
	}
}
