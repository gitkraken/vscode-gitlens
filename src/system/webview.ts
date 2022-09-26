export interface WebviewItemContext<TValue = unknown> {
	webview?: string;
	webviewItem: string;
	webviewItemValue: TValue;
}

export function isWebviewItemContext<TValue = unknown>(item: unknown): item is WebviewItemContext<TValue> {
	if (item == null) return false;

	return 'webview' in item && 'webviewItem' in item;
}

export function serializeWebviewItemContext<T = WebviewItemContext>(context: T): string {
	return JSON.stringify(context);
}
