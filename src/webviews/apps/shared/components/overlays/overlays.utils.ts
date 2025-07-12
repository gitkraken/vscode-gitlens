import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export function handleUnsafeOverlayContent(content?: string) {
	if (content?.includes('\n')) {
		return unsafeHTML(content.replace(/\n\n/g, '<hr>').replace(/\n/g, '<br>'));
	}

	return content;
}
