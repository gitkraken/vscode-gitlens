import { parse as parseDiff } from 'diff2html';
import type { DiffFile } from 'diff2html/lib-esm/types';
import { ColorSchemeType } from 'diff2html/lib-esm/types';
import type { Diff2HtmlUIConfig } from 'diff2html/lib-esm/ui/js/diff2html-ui.js';
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { ComposerHunk } from '../../../../../plus/composer/protocol';
import { focusableBaseStyles } from '../../../../shared/components/styles/lit/a11y.css';
import { boxSizingBase, scrollableBase } from '../../../../shared/components/styles/lit/base.css';
import { compiledComposerTemplates } from './diff-templates.compiled';
import { diff2htmlStyles, diffStyles, hljsStyles } from './diff.css';
import '../../../../shared/components/code-icon';

@customElement('gl-diff-file')
export class GlDiffFile extends LitElement {
	static override styles = [
		boxSizingBase,
		scrollableBase,
		focusableBaseStyles,
		css`
			[hidden] {
				display: none !important;
			}

			:host {
				display: block;
			}
		`,
		hljsStyles,
		diff2htmlStyles,
		diffStyles,
	];

	@property({ type: String })
	filename?: string;

	@property({ type: Array })
	hunks?: ComposerHunk[];

	@property({ type: Boolean, attribute: 'side-by-side' })
	sideBySide = false;

	@property({ type: Boolean, attribute: 'default-expanded' })
	defaultExpanded = true;

	@query('#diff')
	targetElement!: HTMLDivElement;

	@state()
	private diffText?: string;

	@state()
	private parsedDiff?: DiffFile[];

	@state()
	private hasRendered = false;

	@state()
	private _isVisible = false;

	@property({ type: Boolean, reflect: true, attribute: 'is-visible' })
	get isVisible(): boolean {
		return this._isVisible;
	}

	private set isVisible(value: boolean) {
		this._isVisible = value;
	}

	// should only ever be one file
	get diffFile(): DiffFile | undefined {
		return this.parsedDiff?.[0];
	}

	private diff2htmlUi?: Diff2HtmlUI;
	private intersectionObserver?: IntersectionObserver;

	override connectedCallback() {
		super.connectedCallback?.();
		this.setupIntersectionObserver();
	}

	override disconnectedCallback() {
		super.disconnectedCallback?.();
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = undefined;
	}

	override firstUpdated() {
		this.processDiff();
		this.renderDiff();
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);

		if (changedProperties.has('diffText') || changedProperties.has('filename') || changedProperties.has('hunks')) {
			this.processDiff();
		}

		if (changedProperties.has('parsedDiff') || changedProperties.has('sideBySide')) {
			this.renderDiff(true);
		} else if (changedProperties.has('defaultExpanded') || changedProperties.has('isVisible')) {
			this.renderDiff();
		}
	}

	override render() {
		return html`<div id="diff" class="diff-container"></div>`;
	}

	private setupIntersectionObserver() {
		this.intersectionObserver = new IntersectionObserver(
			entries => {
				for (const entry of entries) {
					this.isVisible = entry.isIntersecting;
				}
			},
			{
				// Use a margin to start rendering slightly before the element enters the viewport
				rootMargin: '100px',
			},
		);
		this.intersectionObserver.observe(this);
	}

	private clearDiff() {
		if (this.targetElement) {
			this.targetElement.innerHTML = '';
		}
		this.hasRendered = false;
	}

	private renderDiff(force = false) {
		// If not visible or no data, clear and return
		if (!this.isVisible || !this.parsedDiff || !this.filename) {
			this.clearDiff();
			return;
		}

		// Don't re-render if already rendered
		if (this.hasRendered && !force) {
			return;
		}

		if (!this.diff2htmlUi || force) {
			const config: Diff2HtmlUIConfig = {
				colorScheme: ColorSchemeType.AUTO,
				outputFormat: this.sideBySide ? 'side-by-side' : 'line-by-line',
				drawFileList: false,
				highlight: false,
				// NOTE: Avoiding passing rawTemplates to Diff2HtmlUI to prevent Diff2Html from
				// compiling templates at runtime via Hogan.compile (which uses eval), which violates
				// the webview CSP (no 'unsafe-eval'). If we need to customize templates in the future,
				// switch to providing precompiled templates in the bundle instead of raw strings.
				compiledTemplates: compiledComposerTemplates,
			};
			this.diff2htmlUi = new Diff2HtmlUI(this.targetElement, this.parsedDiff, config);
		}
		this.diff2htmlUi.draw();
		// this.diff2htmlUi.highlightCode();

		const detailsElement = this.targetElement?.querySelector('details');
		if (detailsElement) {
			detailsElement.open = this.defaultExpanded;
		}

		this.hasRendered = true;
	}

	private processDiff() {
		// create diff text, then call parseDiff
		if (!this.filename || !this.hunks || this.hunks.length === 0) {
			this.diffText = undefined;
			this.parsedDiff = undefined;
			return;
		}
		const diffLines = this.hunks
			.map((hunk, i) => {
				if (i === 0) {
					return `${hunk.diffHeader}\n${hunk.hunkHeader}\n${hunk.content}`;
				}
				return `\n${hunk.hunkHeader}\n${hunk.content}`;
			})
			.join('\n');

		this.diffText = diffLines.trim();
		const parsedDiff = parseDiff(this.diffText, {
			diffMaxChanges: 10000,
		});
		this.parsedDiff = parsedDiff;
		const lineCount = this.diffFile?.blocks.reduce((p, c) => p + 1 + c.lines.length, 0) ?? -1;
		this.style.setProperty('--d2h-intrinsic-line-count', lineCount > -1 ? `${lineCount}` : '50');
	}
}
