import type { TemplateResult } from 'lit';
import { css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { Disposable } from 'vscode';
import { isMac } from '@env/platform';
import type { SearchQuery } from '../../../../../constants.search';
import { pluralize } from '../../../../../system/string';
import type { AppState } from '../../../plus/graph/context';
import { DOM } from '../../dom';
import { GlElement } from '../element';
import type { GlSearchInput, SearchModeChangeEventDetail, SearchNavigationEventDetail } from './search-input';
import '../button';
import '../code-icon';
import '../overlays/tooltip';
import './search-input';

export { SearchModeChangeEventDetail, SearchNavigationEventDetail };

declare global {
	interface HTMLElementTagNameMap {
		'gl-search-box': GlSearchBox;
	}

	interface GlobalEventHandlersEventMap {
		'gl-search-openinview': CustomEvent<void>;
		'gl-search-pause': CustomEvent<void>;
		'gl-search-resume': CustomEvent<void>;
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

		@keyframes bounce-up {
			0%,
			100% {
				transform: translateY(0) translateX(-0.1rem);
			}
			50% {
				transform: translateY(-0.3rem) translateX(-0.1rem);
			}
		}

		@keyframes bounce-down {
			0%,
			100% {
				transform: translateY(0);
			}
			50% {
				transform: translateY(0.3rem);
			}
		}

		.button.navigating > code-icon[icon='arrow-up'] {
			animation: bounce-up 0.6s ease-in-out 0.15s infinite;
		}

		.button.navigating > code-icon[icon='arrow-down'] {
			animation: bounce-down 0.6s ease-in-out 0.15s infinite;
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

		.search-button {
			position: relative;
		}

		.search-button__spinner {
			display: block;
		}

		.search-button__stop {
			display: none;
		}

		.search-button:hover .search-button__spinner,
		.search-button:focus-within .search-button__spinner {
			display: none;
		}

		.search-button:hover .search-button__stop,
		.search-button:focus-within .search-button__stop {
			display: block;
		}
	`;

	@query('gl-search-input') searchInput!: GlSearchInput;

	@property({ type: Boolean }) aiAllowed = true;
	@property({ type: String }) errorMessage = '';
	@property({ type: Boolean }) filter = false;
	@property({ type: Boolean }) matchAll = false;
	@property({ type: Boolean }) matchCase = false;
	@property({ type: Boolean }) matchRegex = true;
	@property({ type: Boolean }) matchWholeWord = false;
	@property({ type: Boolean }) naturalLanguage = false;
	@property({ type: String }) navigating: AppState['navigating'] = false;
	@property({ type: Boolean }) resultHidden = false;
	@property({ type: Boolean }) resultsHasMore = false;
	@property({ type: String }) resultsLabel = 'result';
	@property({ type: Boolean }) resultsLoaded = false;
	@property({ type: Boolean }) searching = false;
	@property({ type: Number }) step = 0;
	@property({ type: Number }) total = 0;
	@property({ type: Boolean }) valid = false;
	@property({ type: String })
	get value() {
		return this._value;
	}
	set value(value: string) {
		if (this._value !== undefined) return;
		this._value = value;
	}

	@state() private _value!: string;

	private get hasResults(): boolean {
		return this.total >= 1;
	}

	private get isAtFirstResult(): boolean {
		return this.step <= 1;
	}

	private get isAtLastResult(): boolean {
		// At last result if step equals total AND there are no more results to load
		return this.step >= this.total && !this.resultsHasMore;
	}

	private _disposable: Disposable | undefined;

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._disposable = DOM.on(window, 'keydown', e => this.handleShortcutKeys(e));
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this._disposable?.dispose();
	}

	override focus(options?: FocusOptions): void {
		this.searchInput?.focus(options);
	}

	navigate(direction: SearchNavigationEventDetail['direction']): void {
		this.emit('gl-search-navigate', { direction: direction });
	}

	logSearch(query: SearchQuery): void {
		void this.searchInput?.logSearch(query);
	}

	setSearchQuery(query: string): void {
		this._value = query;
	}

	/**
	 * Updates the search query from an external source (e.g., extension host).
	 * This will update all search properties without triggering a new search.
	 */
	setExternalSearchQuery(search: SearchQuery): void {
		this._value = search.query;
		this.filter = search.filter ?? true;
		this.matchAll = search.matchAll ?? false;
		this.matchCase = search.matchCase ?? false;
		this.matchRegex = search.matchRegex ?? true;
		this.matchWholeWord = search.matchWholeWord ?? false;
		this.naturalLanguage = Boolean(search.naturalLanguage);
		this.searchInput?.setExternalSearchQuery(search);
	}

	private handleShortcutKeys(e: KeyboardEvent) {
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

	private handlePrevious(e: MouseEvent) {
		e.stopImmediatePropagation();
		this.navigate(e.shiftKey ? 'first' : 'previous');
	}

	private handleNext(e: MouseEvent) {
		e.stopImmediatePropagation();
		this.navigate(e.shiftKey ? 'last' : 'next');
	}

	private handleOpenInView(e: Event) {
		e.stopImmediatePropagation();
		this.emit('gl-search-openinview');
	}

	private handleCancel(e: Event) {
		e.preventDefault();
		e.stopPropagation();
		this.emit('gl-search-cancel', { preserveResults: true });
	}

	private get resultsHtml() {
		// Determine the display state based on searching and results
		const hasResults = this.total > 0;
		const isSearching = this.searching;
		const isComplete = this.resultsLoaded && !isSearching;
		const hasNoSearch = !this.resultsLoaded && !isSearching;

		// Build the count display
		let countText: TemplateResult;
		let tooltip: string | TemplateResult = '';

		if (hasResults) {
			// We have results - show count (whether searching or complete)
			const totalFormatted = pluralize(this.resultsLabel, this.total, {
				infix: this.resultsHasMore ? '+ ' : undefined,
			});
			const total = `${this.total}${this.resultsHasMore ? '+' : ''}`;

			if (this.resultHidden) {
				tooltip = html`This result is hidden or unable to be shown on the Commit Graph`;
			} else {
				tooltip = `${totalFormatted} found`;
			}

			countText = html`<span class="${ifDefined(this.resultHidden ? 'sr-hidden' : '')}"
				><span aria-current="step">${this.step}</span> of <span>${total}</span
				><span class="sr-only"> ${totalFormatted}</span></span
			>`;
		} else if (isComplete) {
			// Search is complete with 0 results found
			const totalFormatted = pluralize(this.resultsLabel, 0, { zero: 'No' });
			tooltip = `${totalFormatted} found`;
			countText = html`<span>${totalFormatted}</span>`;
		} else if (hasNoSearch) {
			// No search initiated yet
			countText = html`<span>${pluralize(this.resultsLabel, 0, { zero: 'No' })}</span>`;
		} else {
			// Searching with no results received yet - show blank
			countText = html`<span></span>`;
		}

		// Show combined spinner/stop button when actively searching
		if (isSearching) {
			return html`<gl-button
					class="search-button"
					appearance="toolbar"
					tooltip="Stop Searching"
					@click="${this.handleCancel}"
				>
					<code-icon class="search-button__spinner" icon="loading" modifier="spin"></code-icon>
					<code-icon class="search-button__stop" icon="stop-circle"></code-icon>
				</gl-button>
				<gl-tooltip
					hoist
					placement="top"
					?disabled="${!tooltip}"
					class="count${!hasResults && this.valid && isComplete ? ' error' : ''}"
					>${countText}<span slot="content">${tooltip}</span></gl-tooltip
				>`;
		}

		// Show play button when search is paused with more results
		const isPaused = !isSearching && this.resultsHasMore;
		if (isPaused) {
			return html`<gl-button
					class="search-button"
					appearance="toolbar"
					tooltip="Resume Search"
					@click="${() => this.emit('gl-search-resume')}"
				>
					<code-icon icon="play-circle"></code-icon>
				</gl-button>
				<gl-tooltip
					hoist
					placement="top"
					?disabled="${!tooltip}"
					class="count${!hasResults && this.valid && isComplete ? ' error' : ''}"
					>${countText}<span slot="content">${tooltip}</span></gl-tooltip
				>`;
		}

		// Not searching - just show results
		return html`<gl-tooltip
			hoist
			placement="top"
			?disabled="${!tooltip}"
			class="count${!hasResults && this.valid && isComplete ? ' error' : ''}"
			>${countText}<span slot="content">${tooltip}</span></gl-tooltip
		>`;
	}

	override render(): unknown {
		return html`<gl-search-input
				id="search-input"
				exportparts="search: search"
				?aiAllowed="${this.aiAllowed}"
				.errorMessage="${this.errorMessage}"
				?filter=${this.filter}
				?matchAll="${this.matchAll}"
				?matchCase="${this.matchCase}"
				?matchRegex="${this.matchRegex}"
				?matchWholeWord="${this.matchWholeWord}"
				?naturalLanguage="${this.naturalLanguage}"
				?searching="${this.searching}"
				?hasMoreResults="${this.resultsHasMore}"
				.value="${this._value ?? ''}"
				@gl-search-navigate="${(e: CustomEvent<SearchNavigationEventDetail>) => {
					e.stopImmediatePropagation();
					this.navigate(e.detail.direction);
				}}"
				@gl-search-resume="${(e: Event) => {
					e.stopImmediatePropagation();
					this.emit('gl-search-resume');
				}}"
				@gl-search-pause="${(e: Event) => {
					e.stopImmediatePropagation();
					this.emit('gl-search-pause');
				}}"
			></gl-search-input>
			<div class="search-navigation" aria-label="Search navigation">
				${this.resultsHtml}
				<gl-tooltip hoist>
					<button
						type="button"
						class="button ${this.navigating === 'previous' ? 'navigating' : ''}"
						?disabled="${!this.hasResults || this.isAtFirstResult}"
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
					<button
						type="button"
						class="button ${this.navigating === 'next' ? 'navigating' : ''}"
						?disabled="${!this.hasResults || this.isAtLastResult}"
						@click="${this.handleNext}"
					>
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
			</div>`;
	}
}
