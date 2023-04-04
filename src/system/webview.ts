import type { WebviewIds, WebviewViewIds } from '../constants';

export interface WebviewItemContext<TValue = unknown> {
	webview?: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`;
	webviewItem: string;
	webviewItemValue: TValue;
}

export function isWebviewItemContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemContext<TValue> {
	if (item == null) return false;

	return 'webview' in item && 'webviewItem' in item;
}

export interface WebviewItemGroupContext<TValue = unknown> {
	webview?: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`;
	webviewItemGroup: string;
	webviewItemGroupValue: TValue;
}

export function isWebviewItemGroupContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemGroupContext<TValue> {
	if (item == null) return false;

	return 'webview' in item && 'webviewItemGroup' in item;
}

export function serializeWebviewItemContext<T = WebviewItemContext | WebviewItemGroupContext>(context: T): string {
	return JSON.stringify(context);
}
