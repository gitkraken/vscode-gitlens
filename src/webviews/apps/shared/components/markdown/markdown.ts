import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { until } from 'lit/directives/until.js';
import type { RendererObject, RendererThis, Tokens } from 'marked';
import { marked } from 'marked';
import type { ThemeIcon } from 'vscode';

@customElement('gl-markdown')
export class GlMarkdown extends LitElement {
	static override styles = css`
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
			margin: 8px 0;
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

		hr {
			border: none;
			border-top: 1px solid var(--color-foreground--25);
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
			padding-left: 20px;
		}
		ol {
			padding-left: 20px;
		}

		li > p {
			margin-bottom: 0;
		}

		li > ul {
			margin-top: 0;
		}
	`;

	@property({ type: String })
	private markdown = '';

	override render() {
		return html`${this.markdown ? until(this.renderMarkdown(this.markdown), 'Loading...') : ''}`;
	}

	private async renderMarkdown(markdown: string) {
		marked.setOptions({
			gfm: true,
			// smartypants: true,
			// langPrefix: 'language-',
		});

		marked.use({ renderer: getMarkdownRenderer() });

		let rendered = await marked.parse(markdownEscapeEscapedIcons(markdown));
		rendered = renderThemeIconsWithinText(rendered);
		return unsafeHTML(rendered);
	}
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
		link: function (this: RendererThis, { href, title, tokens }: Tokens.Link): string | false {
			if (typeof href !== 'string') return '';

			// Remove markdown escapes. Workaround for https://github.com/chjj/marked/issues/829
			let text = this.parser.parseInline(tokens);
			if (href === text) {
				// raw link case
				text = removeMarkdownEscapes(text);
			}

			title = typeof title === 'string' ? escapeDoubleQuotes(removeMarkdownEscapes(title)) : '';

			// HTML Encode href
			href = removeMarkdownEscapes(href)
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');

			return `<a href="${href}" title="${title || href}" draggable="false">${text}</a>`;
		},
		code: function (this: RendererThis, { text, lang }: Tokens.Code): string {
			// Remote code may include characters that need to be escaped to be visible in HTML
			text = text.replace(/</g, '&lt;');
			return `<pre class="language-${lang}"><code>${text}</code></pre>`;
		},
		codespan: function (this: RendererThis, { text }: Tokens.Codespan): string {
			// Remote code may include characters that need to be escaped to be visible in HTML
			text = text.replace(/</g, '&lt;');
			return `<code>${text}</code>`;
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

function removeMarkdownEscapes(text: string): string {
	if (!text) {
		return text;
	}
	return text.replace(/\\([\\`*_{}[\]()#+\-.!~])/g, '$1');
}
