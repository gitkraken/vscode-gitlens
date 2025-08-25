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

	@query('#diff')
	targetElement!: HTMLDivElement;

	@state()
	private diffText?: string;

	@state()
	private parsedDiff?: DiffFile[];

	// should only ever be one file
	get diffFile(): DiffFile | undefined {
		return this.parsedDiff?.[0];
	}

	private diff2htmlUi?: Diff2HtmlUI;

	override firstUpdated() {
		this.processDiff();
		this.renderDiff();
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);
		if (changedProperties.has('filename') || changedProperties.has('hunks')) {
			this.processDiff();
		}
		if (changedProperties.has('diffText')) {
			this.renderDiff();
		}
	}

	override render() {
		return html`<div id="diff"></div>`;
	}

	private renderDiff() {
		if (!this.parsedDiff) {
			this.targetElement.innerHTML = '';
			return;
		}
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
		this.diff2htmlUi.draw();
		// this.diff2htmlUi.highlightCode();
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
		const parsedDiff = parseDiff(this.diffText);
		this.parsedDiff = parsedDiff;
		const lineCount = this.diffFile?.blocks.reduce((p, c) => p + 1 + c.lines.length, 0) ?? -1;
		this.style.setProperty('--d2h-intrinsic-line-count', lineCount > -1 ? `${lineCount}` : '50');
	}
}
