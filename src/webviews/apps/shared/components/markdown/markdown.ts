import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { until } from 'lit/directives/until.js';
import type { RendererObject, RendererThis, Tokens } from 'marked';
import { Marked } from 'marked';
import type { ThemeIcon } from 'vscode';
import { ruleStyles } from '../../../plus/shared/components/vscode.css';

let inlineMarked: Marked | undefined;
let blockMarked: Marked | undefined;

@customElement('gl-markdown')
export class GlMarkdown extends LitElement {
	static override styles = [
		ruleStyles,
		css`
			:host {
				display: contents;

				--markdown-compact-block-spacing: 8px;
				--markdown-list-spacing: 20px;
			}

			a,
			a code {
				text-decoration: none;
				color: var(--vscode-textLink-foreground);
			}

			a:hover,
			a:hover code {
				color: var(--vscode-textLink-activeForeground);
			}

			a:hover:not(.disabled) {
				cursor: pointer;
			}

			p,
			.code,
			ul,
			h1,
			h2,
			h3,
			h4,
			h5,
			h6 {
				margin-inline: 0;
			}

			:where(:host([density='compact'])) p,
			:where(:host([density='compact'])) .code,
			:where(:host([density='compact'])) ul,
			:where(:host([density='compact'])) h1,
			:where(:host([density='compact'])) h2,
			:where(:host([density='compact'])) h3,
			:where(:host([density='compact'])) h4,
			:where(:host([density='compact'])) h5,
			:where(:host([density='compact'])) h6 {
				margin-block: var(--markdown-compact-block-spacing);
			}

			h1,
			h2,
			h3,
			h4,
			h5,
			h6 {
				line-height: 1.1;
			}

			code {
				background: var(--vscode-textCodeBlock-background);
				border-radius: 3px;
				padding: 0px 4px 2px 4px;
				font-family: var(--vscode-editor-font-family);
			}

			code code-icon {
				color: inherit;
				font-size: inherit;
				vertical-align: middle;
			}

			p:first-child,
			.code:first-child,
			ul:first-child {
				margin-top: 0;
			}

			p:last-child,
			.code:last-child,
			ul:last-child {
				margin-bottom: 0;
			}

			/* MarkupContent Layout */
			ul {
				padding-left: var(--markdown-list-spacing);
			}
			ol {
				padding-left: var(--markdown-list-spacing);
			}

			li > p {
				margin-bottom: 0;
			}

			li > ul {
				margin-top: 0;
			}
=		`,
	];

	@property({ type: String })
	markdown = '';

	@property({ type: String, reflect: true })
	density: 'compact' | 'document' = 'compact';

	@property({ type: Boolean, reflect: true })
	inline = false;

	override render(): unknown {
		return html`${this.markdown ? until(this.renderMarkdown(this.markdown), 'Loading...') : ''}`;
	}

	private async renderMarkdown(markdown: string) {
		let rendered;
		if (this.inline) {
			inlineMarked ??= new Marked({ breaks: false, gfm: true, renderer: getInlineMarkdownRenderer() });
			// Not using parseInline here, since our custom inline renderer handles lists and other block elements manually for prettier formatting
			rendered = await inlineMarked.parse(markdownEscapeEscapedIcons(markdown));
		} else {
			blockMarked ??= new Marked({ breaks: true, gfm: true, renderer: getMarkdownRenderer() });
			rendered = await blockMarked.parse(markdownEscapeEscapedIcons(markdown));
		}

		rendered = renderThemeIconsWithinText(rendered);
		return unsafeHTML(rendered);
	}
}

const escapeReplacements: { [index: string]: string } = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&#39;',
};
const getEscapeReplacement = (ch: string) => escapeReplacements[ch];

export function escape(html: string, encode?: boolean) {
	if (encode) {
		if (/[&<>"']/.test(html)) {
			return html.replace(/[&<>"']/g, getEscapeReplacement);
		}
	} else if (/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/.test(html)) {
		return html.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, getEscapeReplacement);
	}

	return html;
}

function getMarkdownRenderer(): RendererObject {
	return {
		image: function (this: RendererThis, { href, title, text }: Tokens.Image): string {
			let dimensions: string[] = [];
			let attributes: string[] = [];
			if (href) {
				({ href, dimensions } = parseHrefAndDimensions(href));
				attributes.push(`src="${escapeDoubleQuotes(href)}"`);
			}
			if (text) {
				attributes.push(`alt="${escapeDoubleQuotes(text)}"`);
			}
			if (title) {
				attributes.push(`title="${escapeDoubleQuotes(title)}"`);
			}
			if (dimensions.length) {
				attributes = attributes.concat(dimensions);
			}
			return `<img ${attributes.join(' ')}>`;
		},
		paragraph: function (this: RendererThis, { tokens }: Tokens.Paragraph): string {
			const text = this.parser.parseInline(tokens);
			return `<p>${text}</p>`;
		},
		html: function (this: RendererThis, { text }: Tokens.HTML | Tokens.Tag): string {
			const match = text.match(/^(<span[^>]+>)|(<\/\s*span>)$/);
			return match ? text : '';
		},
	};
}

function getInlineMarkdownRenderer(): RendererObject {
	let listIndex = 0;
	let isOrderedList = false;

	const renderListItem = function (this: RendererThis, item: Tokens.ListItem): string {
		// In inline mode, render list item with symbol prefix
		const text = this.parser.parse(item.tokens);
		// Get the symbol: task checkbox, number for ordered, bullet for unordered
		let symbol: string;
		if (item.task) {
			symbol = item.checked ? '☑' : '☐';
		} else if (isOrderedList) {
			symbol = `${listIndex}.`;
			listIndex++;
		} else {
			symbol = '•';
		}
		return `${symbol} ${text.trim()} `;
	};

	return {
		image: function (this: RendererThis, { text }: Tokens.Image): string {
			// In inline mode, use alt text if available, otherwise skip
			return text || '';
		},
		paragraph: function (this: RendererThis, { tokens }: Tokens.Paragraph): string {
			const text = this.parser.parseInline(tokens);
			return text;
		},
		list: function (this: RendererThis, token: Tokens.List): string {
			// In inline mode, render list items separated by spaces with their symbols
			isOrderedList = token.ordered;
			listIndex = typeof token.start === 'number' ? token.start : 1;
			let body = '';
			for (const item of token.items) {
				body += renderListItem.call(this, item);
			}
			return body;
		},
		listitem: renderListItem,
		link: function (this: RendererThis, { tokens }: Tokens.Link): string | false {
			const text = this.parser.parseInline(tokens);
			return text;
		},
		code: function (this: RendererThis, { text }: Tokens.Code): string {
			// In inline mode, wrap in code tag but without pre block formatting
			return `<code>${escape(text, true)}</code>`;
		},

		br: function (): string {
			// In inline mode, render as a space instead of line break
			return ' ';
		},
		html: function (): string {
			// In inline mode, skip HTML tags
			return '';
		},
	};
}

const themeIconNameExpression = '[A-Za-z0-9-]+';
const themeIconModifierExpression = '~[A-Za-z]+';
const themeIconIdRegex = new RegExp(`^(${themeIconNameExpression})(${themeIconModifierExpression})?$`);
const themeIconsRegex = new RegExp(`\\$\\(${themeIconNameExpression}(?:${themeIconModifierExpression})?\\)`, 'g');
const themeIconsMarkdownEscapedRegex = new RegExp(`\\\\${themeIconsRegex.source}`, 'g');
const themeIconsWithinTextRegex = new RegExp(
	`(\\\\)?\\$\\((${themeIconNameExpression}(?:${themeIconModifierExpression})?)\\)`,
	'g',
);

function markdownEscapeEscapedIcons(text: string): string {
	// Need to add an extra \ for escaping in markdown
	return text.replace(themeIconsMarkdownEscapedRegex, match => `\\${match}`);
}

function parseHrefAndDimensions(href: string): { href: string; dimensions: string[] } {
	const dimensions: string[] = [];
	const splitted = href.split('|').map(s => s.trim());
	href = splitted[0];
	const parameters = splitted[1];
	if (parameters) {
		const heightFromParams = /height=(\d+)/.exec(parameters);
		const widthFromParams = /width=(\d+)/.exec(parameters);
		const height = heightFromParams ? heightFromParams[1] : '';
		const width = widthFromParams ? widthFromParams[1] : '';
		const widthIsFinite = isFinite(parseInt(width));
		const heightIsFinite = isFinite(parseInt(height));
		if (widthIsFinite) {
			dimensions.push(`width="${width}"`);
		}
		if (heightIsFinite) {
			dimensions.push(`height="${height}"`);
		}
	}
	return { href: href, dimensions: dimensions };
}

function renderThemeIconsWithinText(text: string): string {
	const elements: string[] = [];
	let match: RegExpExecArray | null;

	let textStart = 0;
	let textStop = 0;
	while ((match = themeIconsWithinTextRegex.exec(text)) !== null) {
		textStop = match.index || 0;
		if (textStart < textStop) {
			elements.push(text.substring(textStart, textStop));
		}
		textStart = (match.index || 0) + match[0].length;

		const [, escaped, codicon] = match;
		elements.push(escaped ? `$(${codicon})` : renderThemeIcon({ id: codicon }));
	}

	if (textStart < text.length) {
		elements.push(text.substring(textStart));
	}
	return elements.join('');
}

function renderThemeIcon(icon: ThemeIcon): string {
	const match = themeIconIdRegex.exec(icon.id);
	let [, id, modifier] = match ?? [undefined, 'error', undefined];
	if (id.startsWith('gitlens-')) {
		id = `gl-${id.substring(8)}`;
	}
	return /*html*/ `<code-icon icon="${id}"${modifier ? ` modifier="${modifier}"` : ''}></code-icon>`;
}

function escapeDoubleQuotes(input: string) {
	return input.replace(/"/g, '&quot;');
}
