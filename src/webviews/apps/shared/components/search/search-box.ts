import { attr, css, customElement, FASTElement, html, observable, ref, volatile, when } from '@microsoft/fast-element';
import { isMac } from '@env/platform';
import type { SearchQuery } from '../../../../../git/search';
import { pluralize } from '../../../../../system/string';
import type { Disposable } from '../../dom';
import { DOM } from '../../dom';
import { numberConverter } from '../converters/number-converter';
import type { SearchInput } from './search-input';
import '../code-icon';
import '../progress';
import './search-input';

export type SearchNavigationDirection = 'first' | 'previous' | 'next' | 'last';
export interface SearchNavigationEventDetail {
	direction: SearchNavigationDirection;
}

const template = html<SearchBox>`<template>
	<search-input
		${ref('searchInput')}
		id="search-input"
		:errorMessage="${x => x.errorMessage}"
		label="${x => x.label}"
		placeholder="${x => x.placeholder}"
		matchAll="${x => x.matchAll}"
		matchCase="${x => x.matchCase}"
		matchRegex="${x => x.matchRegex}"
		value="${x => x.value}"
		@previous="${(x, c) => {
			c.event.stopImmediatePropagation();
			x.navigate('previous');
		}}"
		@next="${(x, c) => {
			c.event.stopImmediatePropagation();
			x.navigate('next');
		}}"
	></search-input>
	<div class="search-navigation" aria-label="Search navigation">
		<span class="count${x => (x.total < 1 && x.valid && x.resultsLoaded ? ' error' : '')}">
			${when(x => x.searching, html<SearchBox>`<code-icon icon="loading" modifier="spin"></code-icon>`)}
			${when(x => !x.searching && x.total < 1, html<SearchBox>`${x => x.formattedLabel}`)}
			${when(
				x => !x.searching && x.total > 0,
				html<SearchBox>`<span aria-current="step">${x => x.step}</span> of
					<span
						class="${x => (x.resultsHidden ? 'sr-hidden' : '')}"
						title="${x =>
							x.resultsHidden
								? 'Some search results are hidden or unable to be shown on the Commit Graph'
								: ''}"
						>${x => x.total}${x => (x.more ? '+' : '')}</span
					><span class="sr-only"> ${x => x.formattedLabel}</span>`,
			)}
		</span>
		<button
			type="button"
			class="button"
			?disabled="${x => !x.hasResults}"
			@click="${(x, c) => x.handlePrevious(c.event as MouseEvent)}"
		>
			<code-icon
				icon="arrow-up"
				aria-label="Previous Match (Shift+Enter)
First Match (Shift+Click)"
				title="Previous Match (Shift+Enter)
First Match (Shift+Click)"
			></code-icon>
		</button>
		<button
			type="button"
			class="button"
			?disabled="${x => !x.hasResults}"
			@click="${(x, c) => x.handleNext(c.event as MouseEvent)}"
		>
			<code-icon
				icon="arrow-down"
				aria-label="Next Match (Enter)
Last Match (Shift+Click)"
				title="Next Match (Enter)
Last Match (Shift+Click)"
			></code-icon>
		</button>
		<button
			type="button"
			class="button"
			?disabled="${x => !x.hasResults}"
			@click="${(x, c) => x.handleOpenInView(c.event)}"
		>
			<code-icon
				icon="link-external"
				aria-label="Show Results in Side Bar"
				title="Show Results in Side Bar"
			></code-icon>
		</button>
	</div>
	<progress-indicator active="${x => x.searching}"></progress-indicator>
</template>`;

const styles = css`
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

@customElement({ name: 'search-box', template: template, styles: styles })
export class SearchBox extends FASTElement {
	@observable
	errorMessage = '';

	@attr
	label = 'Search';

	@attr
	placeholder = 'Search commits (↑↓ for history), e.g. "Updates dependencies" author:eamodio';

	@attr
	value = '';

	@attr({ mode: 'boolean' })
	matchAll = false;

	@attr({ mode: 'boolean' })
	matchCase = false;

	@attr({ mode: 'boolean' })
	matchRegex = true;

	@attr({ converter: numberConverter })
	total = 0;

	@attr({ converter: numberConverter })
	step = 0;

	@attr({ mode: 'boolean' })
	more = false;

	@attr({ mode: 'boolean' })
	searching = false;

	@attr({ mode: 'boolean' })
	valid = false;

	@attr({ mode: 'boolean' })
	resultsHidden = false;

	@attr
	resultsLabel = 'result';

	@attr({ mode: 'boolean' })
	resultsLoaded = false;

	@volatile
	get formattedLabel() {
		return pluralize(this.resultsLabel, this.total, { zero: 'No' });
	}

	@volatile
	get hasResults() {
		return this.total > 1;
	}

	searchInput!: SearchInput;

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
		const details: SearchNavigationEventDetail = { direction: direction };
		this.$emit('navigate', details);
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
		this.$emit('openinview');
	}
}
