import type { UriComponents } from '@gitlens/utils/uri.js';

// Tagged values allow transparent serialization/deserialization of special types across the webview boundary

/** Tagged type for Dates that get serialized as timestamps */
export interface WireDate {
	__wire: 'date';
	value: number;
}

/** Tagged type for Uris that get serialized as UriComponents */
export interface WireUri {
	__wire: 'uri';
	value: UriComponents;
}

export type WireTaggedType = WireDate | WireUri;

/**
 * @returns the tagged type if the value is one, otherwise undefined
 * More efficient than calling multiple isWire* functions when you need to handle different types
 */
export function getWireTaggedType(value: unknown): WireTaggedType | undefined {
	if (typeof value !== 'object' || value == null) return undefined;

	const wire = (value as any).__wire;
	if (wire == null) return undefined;

	switch (wire) {
		case 'date':
			return typeof (value as WireDate).value === 'number' ? (value as WireDate) : undefined;
		case 'uri':
			return typeof (value as WireUri).value === 'object' && typeof (value as WireUri).value?.scheme === 'string'
				? (value as WireUri)
				: undefined;
		default:
			return undefined;
	}
}
