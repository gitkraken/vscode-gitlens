export function encodeUrl(url: string): string;
export function encodeUrl(url: string | undefined): string | undefined;
export function encodeUrl(url: string | undefined): string | undefined {
	if (url == null) return undefined;

	// Not a fan of this, but it's hard to gauge previous encoding and this is the most common case
	return encodeURI(url.replace(/%20/g, ' '));
}
