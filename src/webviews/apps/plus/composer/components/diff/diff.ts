import { ColorSchemeType } from 'diff2html/lib-esm/types';
import type { Diff2HtmlUIConfig } from 'diff2html/lib-esm/ui/js/diff2html-ui.js';
import { Diff2HtmlUI } from 'diff2html/lib-esm/ui/js/diff2html-ui.js';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { boxSizingBase } from '../../../../shared/components/styles/lit/base.css';
import { compiledComposerTemplates } from './diff-templates.compiled';
import { diff2htmlStyles, diffStyles, hljsStyles } from './diff.css';

@customElement('gl-diff-hunk')
export class GlDiffHunk extends LitElement {
	static override styles = [
		boxSizingBase,
		css`
			:host {
				display: block;
			}
		`,
		hljsStyles,
		diff2htmlStyles,
		diffStyles,
	];

	@property({ attribute: 'diff-header' })
	diffHeader = '';

	@property({ attribute: 'hunk-header' })
	hunkHeader = '';

	@property({ attribute: 'hunk-content' })
	hunkContent = '';

	@query('#diff')
	targetElement!: HTMLDivElement;

	get isDarkMode() {
		const classList = document.body.classList;
		return (
			classList.contains('vscode-dark') ||
			(classList.contains('vscode-high-contrast') && !classList.contains('vscode-high-contrast-light'))
		);
	}

	get rawTemplates() {
		return {};
	}

	private diff2htmlUi?: Diff2HtmlUI;

	override firstUpdated() {
		this.renderDiff();
	}

	override updated(changedProperties: Map<string | number | symbol, unknown>) {
		super.updated(changedProperties);
		if (changedProperties.has('diffText')) {
			this.renderDiff();
		}
	}

	override render() {
		return html`<div id="diff"></div>`;
	}
	// override render() {
	// 	return this.renderDiff2();
	// }

	private renderDiff() {
		const diffHeader = this.diffHeader.trim();
		const hunkHeader = this.hunkHeader.trim();
		const hunkContent = this.hunkContent.trim();
		if (!diffHeader || !hunkHeader || !hunkContent) {
			this.targetElement.innerHTML = '';
			return;
		}
		const config: Diff2HtmlUIConfig = {
			colorScheme: ColorSchemeType.AUTO,
			outputFormat: 'line-by-line',
			drawFileList: false,
			highlight: false,
			// NOTE: Avoiding passing rawTemplates to Diff2HtmlUI to prevent Diff2Html from
			// compiling templates at runtime via Hogan.compile (which uses eval), which violates
			// the webview CSP (no 'unsafe-eval'). If we need to customize templates in the future,
			// switch to providing precompiled templates in the bundle instead of raw strings.
			compiledTemplates: compiledComposerTemplates,
		};
		const diff = `${diffHeader}\n${hunkHeader}\n${hunkContent}`;
		this.diff2htmlUi = new Diff2HtmlUI(this.targetElement, diff, config);
		this.diff2htmlUi.draw();
		// this.diff2htmlUi.highlightCode();
	}
}
