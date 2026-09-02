import type { PropertyValues } from 'lit';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { RendererObject, RendererThis, Tokens } from 'marked';
import { Marked } from 'marked';
import type { ThemeIcon } from 'vscode';
import { ruleStyles } from '../../../plus/shared/components/vscode.css.js';
import { applyCspSafeStyles, rewriteInlineStylesToData } from './css-inline-styles.js';
import '@gitlens/components/components/overlays/tooltip.js';

let inlineMarked: Marked | undefined;
let blockMarked: Marked | undefined;
let blockMarkedWithImageChips: Marked | undefined;

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
				color: var(--vscode-textLink-foreground);
				text-decoration: none;
			}

			a:hover,
			a:hover code {
				color: var(--vscode-textLink-activeForeground);
			}

			a:hover:not(.disabled) {
				cursor: pointer;
			}

			.image {
				display: inline-flex;
				gap: var(--gl-space-4);
				align-items: center;
				padding: var(--gl-space-2) var(--gl-space-6) var(--gl-space-2) var(--gl-space-4);
				line-height: 1.4;
				vertical-align: middle;
				background: color-mix(in srgb, transparent 88%, var(--color-foreground));
				border-radius: var(--gl-radius-sm);
			}

			/* The chip's own padding and gap place the icon; the general icon nudge below would double it.
			   The :not() matches that rule's specificity so this earlier rule can win. */
			.image > code-icon:not(.leading) {
				margin-left: 0;
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

			/* A paragraph that LEADS with an image (the hover formats' avatar) lays out as a card: the
			   image in one column, everything after it in the other, so the author/date/sha lines wrap
			   against a single left edge beside the avatar rather than under a baseline-aligned picture.
			   (The block renderer strips the format's spacing after the image; the gap replaces it.) */
			p:has(> img:first-child) {
				display: flex;
				gap: var(--gl-space-4);
				align-items: flex-start;
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
				padding: 0 4px 2px;
				font-family: var(--vscode-editor-font-family);
				background: var(--vscode-textCodeBlock-background);
				border-radius: var(--gl-radius-sm);
			}

			code code-icon {
				font-size: inherit;
				vertical-align: middle;
				color: inherit;
			}

			/* An icon labels the ref that follows it, but the literal space plus code's own left
  padding put more room on that side than on the side of the word before it, so it read as
  attached to the wrong neighbour. Pull it toward its ref and give the preceding text room. */
			/* The child combinator keeps this off icons nested inside a code span. The graph's row
  hovercard wraps icon and sha in one span (CommitFormatter.link), where the icon can't be
  row-leading and an indent would just push it off the chip's own padding. */
			:not(code) > code-icon:not(.leading) {
				margin-left: 0.3em;
			}

			/* An icon that starts a row is an emblem for the whole line, not a word in it, so it keeps
  the full size a caller's --code-icon-size would otherwise shrink, and needs no leading
  space. Tagged during rendering rather than selected here — see renderThemeIconsWithinText. */
			code-icon.leading {
				--code-icon-size: 1.6rem;

				margin-left: 0;
			}

			/* Fully absorbs the literal space, so the only separation left is the chip's own padding —
  which is also trimmed here, since the icon already reads as attached. */
			code-icon + code {
				padding-left: 3px;
				margin-left: -0.3em;
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
		`,
	];

	@property({ type: String })
	markdown = '';

	@property({ type: String, reflect: true })
	density: 'compact' | 'document' = 'compact';

	@property({ type: Boolean, reflect: true })
	inline = false;

	/** Renders every image (markdown `![]()` and raw `<img>`) as a chip that opens the image in the
	 *  browser rather than an `<img>` — for content like PR descriptions whose images can't load in
	 *  the webview (no cookies for private repos, GitHub's pasted-image URLs). Off by default so
	 *  GitLens's own generated images (e.g. hover avatars) still render inline. */
	@property({ type: Boolean, reflect: true, attribute: 'image-chips' })
	imageChips = false;

	override render(): unknown {
		return html`${this.markdown ? this.renderMarkdown(this.markdown) : ''}`;
	}

	// The `style-src` CSP blocks inline `style="…"` attributes, so `renderMarkdown` rewrites them to
	// inert `data-gl-style` placeholders; re-apply them via CSSOM here once the rendered content is
	// committed. `unsafeHTML` recreates its nodes whenever the string changes (e.g. an `until()` hover
	// resolving), so this must run on every update — never gate it behind a one-time flag.
	override updated(changed: PropertyValues): void {
		super.updated(changed);

		for (const el of this.renderRoot.querySelectorAll<HTMLElement>('[data-gl-style]')) {
			const declarations = el.dataset.glStyle;
			if (declarations) {
				applyCspSafeStyles(el, declarations);
			}
			el.removeAttribute('data-gl-style');
		}
	}

	private renderMarkdown(markdown: string) {
		let rendered;
		if (this.inline) {
			inlineMarked ??= new Marked({ breaks: false, gfm: true, renderer: getInlineMarkdownRenderer() });
			// Not using parseInline here, since our custom inline renderer handles lists and other block elements manually for prettier formatting
			rendered = inlineMarked.parse(markdownEscapeEscapedIcons(markdown), { async: false });
			rendered = renderThemeIconsWithinText(rendered);
			return html`<span>${unsafeHTML(rewriteInlineStylesToData(rendered))}</span>`;
		}

		let marked;
		if (this.imageChips) {
			blockMarkedWithImageChips ??= new Marked({ breaks: true, gfm: true, renderer: getMarkdownRenderer(true) });
			marked = blockMarkedWithImageChips;
		} else {
			blockMarked ??= new Marked({ breaks: true, gfm: true, renderer: getMarkdownRenderer(false) });
			marked = blockMarked;
		}

		rendered = marked.parse(markdownEscapeEscapedIcons(markdown), { async: false });
		rendered = renderThemeIconsWithinText(rendered);
		return unsafeHTML(rewriteInlineStylesToData(rendered));
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

const leadingImageSpacingRegex = /^(<img\b[^>]*>)(?:\s|&nbsp;)+/i;

function getMarkdownRenderer(imageChips: boolean): RendererObject {
	return {
		image: function (this: RendererThis, { href, title, text }: Tokens.Image): string {
			if (imageChips) {
				return renderImagePlaceholder(href ? parseHrefAndDimensions(href).href : href, text);
			}

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
				attributes = [...attributes, ...dimensions];
			}
			return `<img ${attributes.join(' ')}>`;
		},
		codespan: function (this: RendererThis, { text }: Tokens.Codespan): string {
			return `<code>${escape(text)}</code>`;
		},
		paragraph: function (this: RendererThis, { tokens }: Tokens.Paragraph): string {
			let text = this.parser.parseInline(tokens);
			if (!imageChips) {
				// A leading image lays out as a card column (see the `p:has(> img:first-child)` rule),
				// where the gap supplies the spacing — drop the format's own spaces/`&nbsp;` so the first
				// line doesn't start indented relative to the lines that wrap beneath it.
				text = text.replace(leadingImageSpacingRegex, '$1');
			}

			return `<p>${text}</p>`;
		},
		html: function (this: RendererThis, { text }: Tokens.HTML | Tokens.Tag): string {
			if (imageChips) {
				const images = renderImagePlaceholdersFromHtml(text);
				if (images) return images;
			}

			const match = text.match(/^(<span[^>]+>)|(<\/\s*span>)$/);
			return match ? text : '';
		},
	};
}

/** GitHub-flavored pasted images and private-repo images can't render in the webview — no cookies, and
 *  the `html` renderer otherwise drops raw `<img>` tags entirely (see `getMarkdownRenderer`'s `html`
 *  case). This renders a clickable chip in their place instead of the image itself. */
function renderImagePlaceholder(src: string | undefined, alt: string | undefined): string {
	const label = escape(alt || 'Image');
	const icon = renderThemeIcon({ id: 'file-media' });
	if (src && /^https?:\/\//i.test(src)) {
		return `<gl-tooltip content="Open image in browser"><a class="image" href="${escapeDoubleQuotes(src)}">${icon}${label}</a></gl-tooltip>`;
	}

	return `<span class="image">${icon}${label}</span>`;
}

const htmlImageTagRegex = /<img\b[^>]*>/gis;
const htmlImageSrcRegex = /\bsrc=(?:"([^"]*)"|'([^']*)')/i;
const htmlImageAltRegex = /\balt=(?:"([^"]*)"|'([^']*)')/i;

/** Extracts every `<img …>` tag out of a raw HTML block (e.g. a `<picture>` wrapper) and renders each as
 *  a placeholder chip — see `renderImagePlaceholder`. */
function renderImagePlaceholdersFromHtml(text: string): string {
	const tags = text.match(htmlImageTagRegex);
	if (!tags?.length) return '';

	let result = '';
	for (const tag of tags) {
		const srcMatch = htmlImageSrcRegex.exec(tag);
		const altMatch = htmlImageAltRegex.exec(tag);
		result += renderImagePlaceholder(srcMatch?.[1] ?? srcMatch?.[2], altMatch?.[1] ?? altMatch?.[2]);
	}

	return result;
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
		// Block-level elements that need special handling in inline mode
		blockquote: function (this: RendererThis, { tokens }: Tokens.Blockquote): string {
			// In inline mode, render blockquote content without block formatting
			const text = this.parser.parse(tokens);
			return text;
		},
		code: function (this: RendererThis, { text }: Tokens.Code): string {
			// In inline mode, wrap in code tag but without pre block formatting
			return `<code>${escape(text)}</code>`;
		},
		codespan: function (this: RendererThis, { text }: Tokens.Codespan): string {
			return `<code>${escape(text)}</code>`;
		},
		heading: function (this: RendererThis, { tokens }: Tokens.Heading): string {
			// In inline mode, disable heading styles to prevent text starting with '#' (e.g. commit messages)
			// from being rendered as large headings that cause visual overlap. Just return the plain text.
			const text = this.parser.parseInline(tokens);
			return text;
		},
		hr: function (): string {
			// In inline mode, skip horizontal rules
			return '';
		},
		image: function (this: RendererThis, { text }: Tokens.Image): string {
			// In inline mode, use alt text if available, otherwise skip
			return text || '';
		},
		link: function (this: RendererThis, { tokens }: Tokens.Link): string | false {
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
		paragraph: function (this: RendererThis, { tokens }: Tokens.Paragraph): string {
			const text = this.parser.parseInline(tokens);
			return text;
		},
		table: function (): string {
			// In inline mode, skip tables entirely as they don't make sense in inline context
			return '';
		},
		// Inline-level elements
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

/** Whether everything preceding an icon is a block/break tag plus whitespace — i.e. it opens a row. */
const rowLeadingRegex = /(?:^|<p>|<br\s*\/?>|<li>|<h[1-6]>)\s*$/i;
const iconBeforeCodeRegex = /<\/code-icon> <code/g;

function renderThemeIconsWithinText(text: string): string {
	const elements: string[] = [];
	let match: RegExpExecArray | null;

	let textStart = 0;
	let textStop: number;
	while ((match = themeIconsWithinTextRegex.exec(text)) !== null) {
		textStop = match.index || 0;
		if (textStart < textStop) {
			elements.push(text.substring(textStart, textStop));
		}
		textStart = (match.index || 0) + match[0].length;

		const [, escaped, codicon] = match;
		// An icon opening a row is an emblem for the line rather than a word inside it. This runs over
		// already-rendered HTML, so "opens a row" means the only thing between it and the last block or
		// break is whitespace. `:first-child` can't express that — it ignores text nodes, so it also
		// matches the icon in `Merges $(git-branch) x`.
		elements.push(
			escaped
				? `$(${codicon})`
				: renderThemeIcon({ id: codicon }, rowLeadingRegex.test(text.substring(0, textStop))),
		);
	}

	if (textStart < text.length) {
		elements.push(text.substring(textStart));
	}

	// Bind an icon to the ref it labels: the space between them is a wrap opportunity, and breaking
	// there strands the icon at the end of a line away from what it names.
	return elements.join('').replace(iconBeforeCodeRegex, '</code-icon>&nbsp;<code');
}

function renderThemeIcon(icon: ThemeIcon, leading = false): string {
	const match = themeIconIdRegex.exec(icon.id);
	let [, id, modifier] = match ?? [undefined, 'error', undefined];
	if (id.startsWith('gitlens-')) {
		id = `gl-${id.substring(8)}`;
	}
	return /*html*/ `<code-icon icon="${id}"${modifier ? ` modifier="${modifier}"` : ''}${
		leading ? ' class="leading"' : ''
	}></code-icon>`;
}

const quoteRegex = /"/g;
function escapeDoubleQuotes(input: string) {
	return input.replace(quoteRegex, '&quot;');
}
