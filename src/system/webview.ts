import type { WebviewIds, WebviewViewIds } from '../constants.views';

export function createWebviewCommandLink<T>(
	command: `${WebviewIds | WebviewViewIds}.${string}` | `gitlens.plus.${string}`,
	webviewId: WebviewIds | WebviewViewIds,
	webviewInstanceId: string | undefined,
	args?: T,
): string {
	return `command:${command}?${encodeURIComponent(
		JSON.stringify({ webview: webviewId, webviewInstance: webviewInstanceId, ...args } satisfies WebviewContext),
	)}`;
}

export interface WebviewContext {
	webview: WebviewIds | WebviewViewIds;
	webviewInstance: string | undefined;
}

export function isWebviewContext(item: object | null | undefined): item is WebviewContext {
	if (item == null) return false;

	return 'webview' in item && item.webview != null;
}

export interface WebviewItemContext<TValue = unknown> extends Partial<WebviewContext> {
	webviewItem: string;
	webviewItemValue: TValue;
	webviewItemsValues?: { webviewItem: string; webviewItemValue: TValue }[];
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
