import { html } from 'lit';

/** Preserve tooltip line breaks while keeping translations and user data as text. */
export function renderOverlayContent(content?: string): unknown {
	if (!content?.includes('\n')) return content;

	return content.split(/(\n\n|\n)/g).map(part => {
		if (part === '\n\n') return html`<hr />`;
		if (part === '\n') return html`<br />`;

		return part;
	});
}
