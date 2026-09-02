import type { DirectiveResult } from 'lit/directive.js';
import type { UnsafeHTMLDirective } from 'lit/directives/unsafe-html.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

export function handleUnsafeOverlayContent(
	content?: string,
): DirectiveResult<typeof UnsafeHTMLDirective> | string | undefined {
	if (content?.includes('\n')) {
		return unsafeHTML(content.replace(/\n\n/g, '<hr>').replace(/\n/g, '<br>'));
	}

	return content;
}
