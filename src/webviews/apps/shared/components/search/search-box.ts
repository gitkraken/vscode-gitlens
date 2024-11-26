import { isMac } from '@env/platform';
import type { TemplateResult } from 'lit';
import { css, html } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import type { Disposable } from 'vscode';
import type { SearchQuery } from '../../../../../constants.search';
import { pluralize } from '../../../../../system/string';
import { DOM } from '../../dom';
import { GlElement } from '../element';
import type { GlSearchInput, SearchModeChangeEventDetail, SearchNavigationEventDetail } from './search-input';
import '../code-icon';
import '../overlays/tooltip';
import '../progress';
import './search-input';

export { SearchModeChangeEventDetail, SearchNavigationEventDetail };

declare global {
	interface HTMLElementTagNameMap {
		'gl-search-box': GlSearchBox;
	}

	interface GlobalEventHandlersEventMap {
		'gl-search-openinview': CustomEvent<void>;
	}
}

@customElement('gl-search-box')
export class GlSearchBox extends GlElement {
	static override styles = css`
		:host {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 0.8rem;
			color: var(--color-foreground);
			flex: auto 1 1;
			position: relative;
		}
		:host(:focus) {
			outline: 0;
		}
		progress-indicator {
			top: -4px;
		}

		.search-navigation {
			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 0.3rem;
			color: var(--color-foreground);
		}
		.search-navigation:focus {
			outline: 0;
		}

		.count {
			flex: none;
			margin-right: 0.4rem;
			font-size: 1.2rem;
			min-width: 10ch;
		}

		.count.error {
			color: var(--vscode-errorForeground);
		}

		.button {
			width: 2.4rem;
			height: 2.4rem;
			padding: 0;
			color: inherit;
			border: none;
			border-radius: 3px;
			background: none;
			text-align: center;
		}
		.button[disabled] {
			color: var(--vscode-disabledForeground);
		}
		.button:focus {
			background-color: var(--vscode-toolbar-activeBackground);
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		.button:not([disabled]) {
			cursor: pointer;
		}
		.button:hover:not([disabled]) {
			color: var(--vscode-foreground);
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		.button > code-icon[icon='arrow-up'] {
			transform: translateX(-0.1rem);
		}

		.sr-hidden {
			color: var(--vscode-errorForeground);
		}

		.sr-only {
			clip: rect(0 0 0 0);
			clip-path: inset(50%);
			height: 1px;
			overflow: hidden;
			position: absolute;
			white-space: nowrap;
			width: 1px;
		}
	`;

	@property({ type: String })
	errorMessage = '';

	@property({ type: String })
	value = '';

	@property({ type: Boolean })
	matchAll = false;

	@property({ type: Boolean })
	matchCase = false;

	@property({ type: Boolean })
	matchRegex = true;

	@property({ type: Boolean })
	filter = false;

	@property({ type: Number })
	total = 0;

	@property({ type: Number })
	step = 0;

	@property({ type: Boolean })
	more = false;

	@property({ type: Boolean })
	searching = false;

	@property({ type: Boolean })
	valid = false;

	@property({ type: Boolean })
	resultsHidden = false;

	@property({ type: String })
	resultsLabel = 'result';

	@property({ type: Boolean })
	resultsLoaded = false;

	get hasResults() {
		return this.total > 1;
	}

	@query('gl-search-input')
	searchInput!: GlSearchInput;

	private _disposable: Disposable | undefined;

	override connectedCallback(): void {
		super.connectedCallback();

		this._disposable = DOM.on(window, 'keydown', e => this.handleShortcutKeys(e));
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback();

		this._disposable?.dispose();
	}

	override focus(options?: FocusOptions): void {
		this.searchInput?.focus(options);
	}

	navigate(direction: SearchNavigationEventDetail['direction']) {
		this.emit('gl-search-navigate', { direction: direction });
	}

	logSearch(query: SearchQuery) {
		this.searchInput?.logSearch(query);
	}

	handleShortcutKeys(e: KeyboardEvent) {
		if (e.altKey) return;

		if ((e.key === 'F3' && !e.ctrlKey && !e.metaKey) || (e.key === 'g' && e.metaKey && !e.ctrlKey && isMac)) {
			e.preventDefault();
			e.stopImmediatePropagation();

			this.navigate(e.shiftKey ? 'previous' : 'next');

			return;
		}

		if (e.key === 'f' && ((e.metaKey && !e.ctrlKey && isMac) || (e.ctrlKey && !isMac))) {
			e.preventDefault();
			e.stopImmediatePropagation();

			this.focus();
		}
	}

	handlePrevious(e: MouseEvent) {
		e.stopImmediatePropagation();
		this.navigate(e.shiftKey ? 'first' : 'previous');
	}

	handleNext(e: MouseEvent) {
		e.stopImmediatePropagation();
		this.navigate(e.shiftKey ? 'last' : 'next');
	}

	handleOpenInView(e: Event) {
		e.stopImmediatePropagation();
		this.emit('gl-search-openinview');
	}

	private get resultsHtml() {
		if (this.searching) {
			return html`<gl-tooltip hoist placement="top" class="count"
				><code-icon icon="loading" modifier="spin"></code-icon><span slot="content">Searching...</span>
			</gl-tooltip>`;
		}

		const totalFormatted = pluralize(this.resultsLabel, this.total, {
			zero: 'No',
			infix: this.more ? '+ ' : undefined,
		});

		let tooltip: string | TemplateResult = '';
		let formatted = html`<span>${totalFormatted}</span>`;
		if (this.total >= 1) {
			tooltip = this.resultsHidden
				? html`${totalFormatted} found &mdash; some results are hidden or unable to be shown on the Commit Graph`
				: `${totalFormatted} found`;

			const total = `${this.total}${this.more ? '+' : ''}`;
			formatted = html`<span
				><span aria-current="step">${this.step}</span> of
				<span class="${this.resultsHidden ? 'sr-hidden' : ''}">${total}</span
				><span class="sr-only"> ${totalFormatted}</span></span
			>`;
		} else if (this.resultsLoaded) {
			tooltip = `${totalFormatted} found`;
		}

		return html`<gl-tooltip
			hoist
			placement="top"
			?disabled="${!tooltip}"
			class="count${this.total < 1 && this.valid && this.resultsLoaded ? ' error' : ''}"
			>${formatted}<span slot="content">${tooltip}</span></gl-tooltip
		>`;
	}

	override render() {
		return html`<gl-search-input
				id="search-input"
				exportparts="search: search"
				.errorMessage="${this.errorMessage}"
				.filter=${this.filter}
				.matchAll="${this.matchAll}"
				.matchCase="${this.matchCase}"
				.matchRegex="${this.matchRegex}"
				.value="${this.value}"
				@gl-search-navigate="${(e: CustomEvent<SearchNavigationEventDetail>) => {
					e.stopImmediatePropagation();
					this.navigate(e.detail.direction);
				}}"
			></gl-search-input>
			<div class="search-navigation" aria-label="Search navigation">
				${this.resultsHtml}
				<gl-tooltip hoist>
					<button
						type="button"
						class="button"
						?disabled="${!this.hasResults}"
						@click="${this.handlePrevious}"
					>
						<code-icon
							icon="arrow-up"
							aria-label="Previous Match (Shift+Enter)&#10;First Match (Shift+Click)"
						></code-icon>
					</button>
					<span slot="content">Previous Match (Shift+Enter)<br />First Match (Shift+Click)</span>
				</gl-tooltip>
				<gl-tooltip hoist>
					<button type="button" class="button" ?disabled="${!this.hasResults}" @click="${this.handleNext}">
						<code-icon
							icon="arrow-down"
							aria-label="Next Match (Enter)&#10;Last Match (Shift+Click)"
						></code-icon>
					</button>
					<span slot="content">Next Match (Enter)<br />Last Match (Shift+Click)</span>
				</gl-tooltip>
				<gl-tooltip hoist content="Show Results in Side Bar">
					<button
						type="button"
						class="button"
						?disabled="${!this.hasResults}"
						@click="${this.handleOpenInView}"
					>
						<code-icon icon="link-external" aria-label="Show Results in Side Bar"></code-icon>
					</button>
				</gl-tooltip>
			</div>
			<progress-indicator active="${this.searching}"></progress-indicator>`;
	}
}
