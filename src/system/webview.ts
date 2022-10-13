export interface WebviewItemContext<TValue = unknown> {
	webview?: string;
	webviewItem: string;
	webviewItemValue: TValue;
}

export function isWebviewItemContext<TValue = unknown>(item: unknown): item is WebviewItemContext<TValue> {
	if (item == null) return false;

	return 'webview' in item && 'webviewItem' in item;
}

export interface WebviewItemGroupContext<TValue = unknown> {
	webview?: string;
	webviewItemGroup: string;
	webviewItemGroupValue: TValue;
}

export function isWebviewItemGroupContext<TValue = unknown>(item: unknown): item is WebviewItemGroupContext<TValue> {
	if (item == null) return false;

	return 'webview' in item && 'webviewItemGroup' in item;
}

export function serializeWebviewItemContext<T = WebviewItemContext | WebviewItemGroupContext>(context: T): string {
	return JSON.stringify(context);
}
