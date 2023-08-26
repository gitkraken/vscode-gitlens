import type { WebviewIds, WebviewViewIds } from '../constants';

export function createWebviewCommandLink(
	command: `${WebviewIds | WebviewViewIds}.${string}`,
	webviewId: WebviewIds | WebviewViewIds,
): string {
	return `command:${command}?${encodeURIComponent(JSON.stringify({ webview: webviewId } satisfies WebviewContext))}`;
}

export interface WebviewContext {
	webview: WebviewIds | WebviewViewIds;
}

export function isWebviewContext(item: object | null | undefined): item is WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null;
}

export interface WebviewItemContext<TValue = unknown> extends Partial<WebviewContext> {
	webviewItem: string;
	webviewItemValue: TValue;
}

export function isWebviewItemContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemContext<TValue> & WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null && 'webviewItem' in item;
}

export interface WebviewItemGroupContext<TValue = unknown> extends Partial<WebviewContext> {
	webviewItemGroup: string;
	webviewItemGroupValue: TValue;
}

export function isWebviewItemGroupContext<TValue = unknown>(
	item: object | null | undefined,
): item is WebviewItemGroupContext<TValue> & WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null && 'webviewItemGroup' in item;
}

export function serializeWebviewItemContext<T = WebviewItemContext | WebviewItemGroupContext>(context: T): string {
	return JSON.stringify(context);
}
