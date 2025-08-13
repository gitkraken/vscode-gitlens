import { css, html, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '../../../../../constants.search';
import { searchOperationHelpRegex, searchOperatorsToLongFormMap } from '../../../../../constants.search';
import type { Deferrable } from '../../../../../system/function/debounce';
import { debounce } from '../../../../../system/function/debounce';
import { GlElement } from '../element';
import type { GlPopover } from '../overlays/popover';
import '../button';
import '../code-icon';
import '../copy-container';
import '../menu/menu-divider';
import '../menu/menu-label';
import '../menu/menu-item';
import '../overlays/popover';

export interface SearchNavigationEventDetail {
	direction: 'first' | 'previous' | 'next' | 'last';
}

export interface SearchModeChangeEventDetail {
	searchMode: 'normal' | 'filter';
	useNaturalLanguage: boolean;
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-search-input': GlSearchInput;
	}

	interface GlobalEventHandlersEventMap {
		'gl-search-inputchange': CustomEvent<SearchQuery>;
		'gl-search-navigate': CustomEvent<SearchNavigationEventDetail>;
		'gl-search-modechange': CustomEvent<SearchModeChangeEventDetail>;
	}
}

@customElement('gl-search-input')
export class GlSearchInput extends GlElement {
	static override styles = css`
		* {
			box-sizing: border-box;
		}

		:host {
			--gl-search-input-background: var(--vscode-input-background);
			--gl-search-input-foreground: var(--vscode-input-foreground);
			--gl-search-input-border: var(--vscode-input-border);
			--gl-search-input-placeholder: var(
				--vscode-editor-placeholder\\\.foreground,
				var(--vscode-input-placeholderForeground)
			);
			--gl-search-input-buttons-left: 2;
			--gl-search-input-buttons-right: 4;

			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			position: relative;

			flex: auto 1 1;
		}

		:host([data-ai-allowed]) {
			--gl-search-input-buttons-left: 3;
		}

		:host([data-natural-language-mode]) {
			--gl-search-input-buttons-left: 2;
			--gl-search-input-buttons-right: 0;
		}

		:host([data-natural-language-mode][data-has-input]) {
			--gl-search-input-buttons-right: 2;
		}

		:host(:not([data-natural-language-mode])[data-has-input]) {
			--gl-search-input-buttons-right: 5;
		}

		label {
			display: flex;
			justify-content: center;
			align-items: center;
			gap: 0.2rem;
			width: 3.2rem;
			height: 2.4rem;
			color: var(--gl-search-input-foreground);
			cursor: pointer;
			border-radius: 3px;
		}
		label:hover {
			background-color: var(--vscode-toolbar-hoverBackground);
		}
		label:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}

		.icon-small {
			font-size: 1rem;
		}

		.field {
			position: relative;
			flex: auto 1 1;
		}

		input {
			width: 100%;
			height: 2.7rem;
			background-color: var(--gl-search-input-background);
			color: var(--gl-search-input-foreground);
			border: 1px solid var(--gl-search-input-border);
			border-radius: 0.25rem;
			padding-top: 0;
			padding-bottom: 1px;
			padding-left: calc(1.7rem + calc(1.96rem * var(--gl-search-input-buttons-left)));
			padding-right: calc(0.7rem + calc(1.96rem * var(--gl-search-input-buttons-right)));
			font-family: inherit;
			font-size: inherit;
		}

		:host([data-natural-language-mode]) input {
			padding-left: calc(0.7rem + calc(1.96rem * (var(--gl-search-input-buttons-left))));
		}

		input:focus {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		input::placeholder {
			color: var(--gl-search-input-placeholder);
		}

		input::-webkit-search-cancel-button {
			display: none;
		}

		input[aria-describedby='help-text']:focus {
			outline-color: var(--vscode-inputValidation-infoBorder);
			border-bottom-left-radius: 0;
			border-bottom-right-radius: 0;
		}

		input[aria-valid='false'] {
			border-color: var(--vscode-inputValidation-errorBorder);
		}
		input[aria-valid='false']:focus {
			outline-color: var(--vscode-inputValidation-errorBorder);
		}

		.message {
			position: absolute;
			top: 100%;
			left: 0;
			width: 100%;
			padding: 0.4rem;
			transform: translateY(-0.1rem);
			z-index: 1000;
			background-color: var(--vscode-inputValidation-infoBackground);
			border: 1px solid var(--vscode-inputValidation-infoBorder);
			color: var(--gl-search-input-foreground);
			font-size: 1.2rem;
			line-height: 1.4;
		}

		input[aria-valid='false'] + .message {
			background-color: var(--vscode-inputValidation-errorBackground);
			border-color: var(--vscode-inputValidation-errorBorder);
		}

		input:not([aria-describedby='help-text']:focus) + .message {
			display: none;
		}

		.controls {
			position: absolute;
			top: 0.2rem;
			right: 0.2rem;
			display: inline-flex;
			flex-direction: row;
			gap: 0.1rem;
		}

		.controls.controls__start {
			--button-compact-padding: 0.4rem;
			--button-line-height: 1;

			left: 0.2rem;
			right: auto;
		}

		button {
			padding: 0;
			color: var(--gl-search-input-foreground);
			border: 1px solid transparent;
			background: none;
		}
		button:focus:not([disabled]) {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: -1px;
		}
		button:not([disabled]) {
			cursor: pointer;
		}

		.is-hidden {
			display: none;
		}

		menu-item {
			padding: 0 0.5rem;
		}

		.menu-button {
			display: block;
			width: 100%;
			padding: 0.1rem 0.6rem 0 0.6rem;
			line-height: 2.2rem;
			text-align: left;
			color: var(--vscode-menu-foreground);
			border-radius: 3px;
		}

		.menu-button:hover {
			color: var(--vscode-menu-selectionForeground);
			background-color: var(--vscode-menu-selectionBackground);
		}

		code {
			display: inline-block;
			backdrop-filter: brightness(1.3);
			border-radius: 3px;
			padding: 0px 4px;
			font-family: var(--vscode-editor-font-family);
		}

		.popover {
			margin-left: -0.25rem;
		}
		.popover::part(body) {
			padding: 0 0 0.5rem 0;
			font-size: var(--vscode-font-size);
			background-color: var(--vscode-menu-background);
		}

		gl-copy-container {
			margin-top: -0.1rem;
		}
	`;

	@query('input') input!: HTMLInputElement;
	@query('gl-popover') popoverEl!: GlPopover;

	@property({ type: Boolean }) aiAllowed = true;
	@property({ type: Boolean }) filter = false;
	@property({ type: Boolean }) matchAll = false;
	@property({ type: Boolean }) matchCase = false;
	@property({ type: Boolean }) matchRegex = true;
	@property({ type: Boolean }) matchWholeWord = false;
	@property({ type: Boolean }) naturalLanguage = false;
	@property({ type: Boolean }) searching = false;
	@property({ type: String })
	get value() {
		return this._value;
	}
	set value(value: string) {
		if (this._value !== undefined) return;
		this._value = value;
	}

	@state() private errorMessage = '';
	@state() private helpType?: SearchOperatorsLongForm;
	@state() private processedQuery: string | undefined;
	@state() private _value!: string;

	private get label() {
		return this.filter ? 'Filter' : 'Search';
	}

	get matchCaseOverride(): boolean {
		return this.matchRegex ? this.matchCase : true;
	}

	get matchWholeWordOverride(): boolean {
		return this.matchRegex ? this.matchWholeWord : false;
	}

	private get placeholder() {
		if (this.naturalLanguage) {
			return `${this.label} commits using natural language (↑↓ for history), e.g. Show my commits from last month`;
		}
		return `${this.label} commits (↑↓ for history), e.g. "Updates dependencies" author:eamodio`;
	}

	private showNaturalLanguageHelpText = true;

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>) {
		if (changedProperties.has('aiAllowed')) {
			if (!this.aiAllowed && this.naturalLanguage) {
				this.updateNaturalLanguage(false);
			}
		}

		super.willUpdate(changedProperties);
	}

	override updated(changedProperties: Map<PropertyKey, unknown>) {
		this.toggleAttribute('data-ai-allowed', this.aiAllowed);
		this.toggleAttribute('data-has-input', Boolean(this._value?.length));
		this.toggleAttribute('data-natural-language-mode', this.naturalLanguage);

		super.updated(changedProperties);
	}

	private handleFocus(_e: Event) {
		void this.popoverEl.hide();
	}

	private handleClear(_e: Event) {
		this.focus();
		this._value = '';
		this.errorMessage = '';
		this.processedQuery = undefined;
		this.debouncedOnSearchChanged();
	}

	private _updateHelpTextDebounced: Deferrable<GlSearchInput['updateHelpText']> | undefined;
	private updateHelpText() {
		if (this.naturalLanguage) return;

		this._updateHelpTextDebounced ??= debounce(this.updateHelpTextCore.bind(this), 200);
		this._updateHelpTextDebounced();
	}

	private updateHelpTextCore() {
		const cursor = this.input?.selectionStart;
		const value = this.value;
		if (cursor != null && value.length !== 0 && value.includes(':')) {
			const regex = new RegExp(searchOperationHelpRegex, 'g');
			let match;
			do {
				match = regex.exec(value);
				if (match == null) break;

				const [, , part, op] = match;

				if (cursor > match.index && cursor <= match.index + (part?.trim().length ?? 0)) {
					this.helpType = searchOperatorsToLongFormMap.get(op as SearchOperators);
					return;
				}
			} while (true);
		}
		this.helpType = undefined;
	}

	private handleInputClick(_e: MouseEvent) {
		this.updateHelpText();
	}

	private handleInput(e: InputEvent) {
		this.errorMessage = '';
		this.processedQuery = undefined;

		const value = (e.target as HTMLInputElement)?.value;
		this._value = value;
		this.updateHelpText();

		// Don't auto-search when in natural language mode - require explicit trigger
		if (!this.naturalLanguage || !value) {
			this.debouncedOnSearchChanged();
		}
	}

	private handleMatchAll(_e: Event) {
		this.matchAll = !this.matchAll;
		this.debouncedOnSearchChanged();
	}

	private handleMatchCase(_e: Event) {
		this.matchCase = !this.matchCase;
		this.debouncedOnSearchChanged();
	}

	private handleMatchRegex(_e: Event) {
		this.matchRegex = !this.matchRegex;
		this.debouncedOnSearchChanged();
	}

	private handleMatchWholeWord(_e: Event) {
		this.matchWholeWord = !this.matchWholeWord;
		this.debouncedOnSearchChanged();
	}

	// private handleShowNaturalLanguageHelpText(_e: Event) {
	// 	if (!this.naturalLanguage) {
	// 		this.showNaturalLanguageHelpText = false;
	// 		return;
	// 	}

	// 	this.showNaturalLanguageHelpText = !this.showNaturalLanguageHelpText;
	// 	this.focus();
	// 	this.updateHelpText();
	// }

	private handleFilterClick(_e: Event) {
		this.filter = !this.filter;
		this.emit('gl-search-modechange', {
			searchMode: this.filter ? 'filter' : 'normal',
			useNaturalLanguage: this.naturalLanguage,
		});
		this.debouncedOnSearchChanged();
	}

	private handleNaturalLanguageClick(_e: Event) {
		this.updateNaturalLanguage(!this.naturalLanguage);

		// Only trigger search when switching FROM natural language mode TO regular mode
		// When switching TO natural language mode, wait for explicit user action
		if (!this.naturalLanguage) {
			this.debouncedOnSearchChanged();
		}
	}

	private updateNaturalLanguage(useNaturalLanguage: boolean) {
		this.processedQuery = undefined;

		this.naturalLanguage = useNaturalLanguage && this.aiAllowed;
		this.emit('gl-search-modechange', {
			searchMode: this.filter ? 'filter' : 'normal',
			useNaturalLanguage: this.naturalLanguage,
		});
	}

	private handleKeyup(_e: KeyboardEvent) {
		this.updateHelpText();
	}

	private handleShortcutKeys(e: KeyboardEvent) {
		if (!['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return true;

		e.preventDefault();
		if (e.key === 'Enter') {
			// In natural language mode, Enter triggers search instead of navigation
			if (this.naturalLanguage) {
				this.debouncedOnSearchChanged();
			} else {
				this.emit('gl-search-navigate', { direction: e.shiftKey ? 'previous' : 'next' });
			}
		} else if (this.searchHistory.length !== 0) {
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			const nextPos = this.searchHistoryPos + direction;
			if (nextPos > -1 && nextPos < this.searchHistory.length) {
				this.searchHistoryPos = nextPos;
				const value = this.searchHistory[nextPos];
				if (value !== this.value) {
					this._value = value;
					this.updateHelpText();
					// Don't auto-search when in natural language mode - require explicit trigger
					if (!this.naturalLanguage) {
						this.debouncedOnSearchChanged();
					}
				}
			}
		}

		return false;
	}

	private handleInsertToken(token: string) {
		this._value += `${this.value.length > 0 ? ' ' : ''}${token}`;
		window.requestAnimationFrame(() => {
			this.updateHelpText();
			// `@me` can be searched right away since it doesn't need additional text
			// But don't auto-search in natural language mode
			if (!this.naturalLanguage && (token === '@me' || token === 'is:stash' || token === 'type:stash')) {
				this.debouncedOnSearchChanged();
			}
			this.input.focus();
			this.input.selectionStart = this.value.length;
		});
	}

	private onSearchChanged() {
		const search: SearchQuery = {
			query: this.value,
			naturalLanguage: this.naturalLanguage ? { query: this.value } : undefined,
			filter: this.filter,
			matchAll: this.matchAll,
			matchCase: this.matchCase,
			matchRegex: this.matchRegex,
			matchWholeWord: this.matchWholeWord,
		};
		this.emit('gl-search-inputchange', search);
	}
	private debouncedOnSearchChanged = debounce(this.onSearchChanged.bind(this), 250);

	setCustomValidity(errorMessage: string = ''): void {
		this.errorMessage = errorMessage;
	}

	searchHistory: string[] = [];
	searchHistoryPos = 0;
	logSearch(query: SearchQuery): void {
		if (query.naturalLanguage) {
			if (typeof query.naturalLanguage === 'boolean') {
				this.processedQuery = undefined;
				this.errorMessage = '';
			} else if (query.naturalLanguage.error) {
				this.processedQuery = undefined;
				this.errorMessage = query.naturalLanguage.error;
			} else {
				this.processedQuery = query.naturalLanguage.processedQuery;
				this.errorMessage = '';
			}
		}

		const lastIndex = this.searchHistory.length - 1;

		// prevent duplicate entries
		if (this.searchHistoryPos < lastIndex || this.searchHistory[lastIndex] === query.query) {
			return;
		}

		this.searchHistory.push(query.query);
		this.searchHistoryPos = this.searchHistory.length - 1;
	}

	setSearchQuery(query: string): void {
		this._value = query;
	}

	override render(): unknown {
		return html`<div class="field">
				<div class="controls controls__start">
					<gl-button
						appearance="input"
						role="checkbox"
						aria-checked="${this.filter}"
						tooltip="Filter Commits"
						aria-label="Filter Commits"
						@click="${this.handleFilterClick}"
						@focus="${this.handleFocus}"
					>
						<code-icon icon="list-filter"></code-icon>
					</gl-button>
					${this.aiAllowed
						? html`<gl-button
								appearance="input"
								role="checkbox"
								aria-checked="${this.naturalLanguage}"
								tooltip="Natural Language Search (AI Preview)"
								aria-label="Natural Language Search (AI Preview)"
								@click="${this.handleNaturalLanguageClick}"
								@focus="${this.handleFocus}"
							>
								<code-icon icon="sparkle"></code-icon>
							</gl-button>`
						: nothing}
					${this.renderSearchByPopover()}
				</div>
				<input
					id="search"
					part="search"
					type="text"
					spellcheck="false"
					placeholder="${this.placeholder}"
					.value="${this._value ?? ''}"
					aria-valid="${!this.errorMessage}"
					aria-describedby="${this.errorMessage !== '' ||
					this.helpType != null ||
					(this.naturalLanguage && this.showNaturalLanguageHelpText)
						? 'help-text'
						: ''}"
					@input="${this.handleInput}"
					@keydown="${this.handleShortcutKeys}"
					@keyup="${this.handleKeyup}"
					@click="${this.handleInputClick}"
					@focus="${this.handleFocus}"
				/>
				${this.renderHelpText()}
			</div>
			<div class="controls">
				<gl-button
					appearance="input"
					class="${ifDefined(this.value ? undefined : 'is-hidden')}"
					tooltip="Clear"
					aria-label="Clear"
					@click="${this.handleClear}"
					@focus="${this.handleFocus}"
				>
					<code-icon icon="close"></code-icon>
				</gl-button>
				${this.renderSearchOptions()}
			</div>`;
	}

	private renderHelpText() {
		return html`<div class="message" id="help-text" aria-live="polite">
			${this.renderSpecificHelpText(this.helpType)}
		</div>`;
	}

	private renderSpecificHelpText(type?: SearchOperatorsLongForm) {
		if (this.errorMessage) {
			return html`<span>${this.errorMessage}</span>`;
		}

		if (this.naturalLanguage) {
			if (this.showNaturalLanguageHelpText) {
				if (!this.processedQuery) {
					if (this.searching) {
						return html`<span>Query: <code-icon icon="loading" modifier="spin"></code-icon></span>`;
					}
					return html`<span
						>Type your natural language query and press Enter. Click
						<code-icon icon="sparkle"></code-icon> to toggle modes.</span
					>`;
				}

				return html`<span> Query: <code>${this.processedQuery}</code></span>`;
			}

			return nothing;
		}

		switch (type) {
			case 'message:':
				return html`<span
					>Message: use quotes to search for phrases, e.g. <code>message:"Updates dependencies"</code></span
				>`;
			case 'author:':
				return html`<span>Author: use a user's account, e.g. <code>author:eamodio</code></span>`;
			case 'commit:':
				return html`<span>Commit: use a full or short Commit SHA, e.g. <code>commit:4ce3a</code></span>`;
			case 'type:':
				return html`<span
					>Type: use <code>stash</code> to search only stashes, e.g. <code>type:stash</code></span
				>`;
			case 'file:':
				return html`<span
					>File: use a filename with extension, e.g. <code>file:package.json</code> or a glob pattern, e.g.
					<code>file:*graph*</code></span
				>`;
			case 'change:':
				return html`<span>Change: use a regex pattern, e.g. <code>change:update&#92;(param</code></span>`;
			case 'after:':
				return html`<span
					>After Date: use a date string, e.g. <code>after:2022-01-01</code> or a relative date, e.g.
					<code>since:6.months.ago</code></span
				>`;
			case 'before:':
				return html`<span
					>Before Date: use a date string, e.g. <code>before:2022-01-01</code> or a relative date, e.g.
					<code>until:6.months.ago</code></span
				>`;
		}

		return nothing;
	}

	private renderSearchByPopover() {
		if (this.naturalLanguage) return nothing;

		return html`<gl-popover
			class="popover"
			trigger="click focus"
			hoist
			placement="bottom-start"
			.arrow=${false}
			distance="0"
		>
			<gl-button
				style="height:100%;"
				slot="anchor"
				appearance="input"
				tooltip="${this.label} By"
				tooltipPlacement="top"
				aria-label="${this.label} By"
			>
				<code-icon icon="search" size="14" aria-hidden="true"></code-icon>
				<code-icon slot="suffix" icon="chevron-down" size="10" aria-hidden="true"></code-icon>
			</gl-button>
			<div slot="content">
				<menu-label>${this.label} By</menu-label>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('@me')}">
						My changes <small>@me</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('message:')}">
						Message <small>message: or =:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('author:')}">
						Author <small>author: or @:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('commit:')}">
						Commit SHA <small>commit: or #:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('type:stash')}">
						Type <small>type:stash or is:stash</small>
					</button>
				</menu-item>
				<menu-divider></menu-divider>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('file:')}">
						File <small>file: or ?:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('change:')}">
						Change <small>change: or ~:</small>
					</button>
				</menu-item>
				<menu-divider></menu-divider>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('after:')}">
						After Date <small>after: or since:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${() => this.handleInsertToken('before:')}">
						Before Date <small>before: or until:</small>
					</button>
				</menu-item>
			</div>
		</gl-popover>`;
	}

	private renderSearchOptions() {
		if (this.naturalLanguage) {
			return html`<gl-copy-container
				class="${ifDefined(this.value ? undefined : 'is-hidden')}"
				appearance="toolbar"
				copyLabel="Copy Query"
				.content=${this.processedQuery}
				placement="bottom"
				?disabled=${!this.processedQuery}
			>
				<code-icon icon="copy" aria-hidden="true"></code-icon>
			</gl-copy-container>`;

			// <gl-button
			// 	appearance="input"
			// 	role="checkbox"
			// 	aria-checked="${this.showNaturalLanguageHelpText}"
			// 	tooltip="Show Query"
			// 	aria-label="Show Query"
			// 	@click="${this.handleShowNaturalLanguageHelpText}"
			// 	@focus="${this.handleFocus}"
			// >
			// 	<code-icon icon="symbol-namespace"></code-icon>
			// </gl-button>
		}

		return html`<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchCaseOverride}"
				tooltip="Match Case${this.matchCaseOverride && !this.matchCase
					? ' (always on without regular expressions)'
					: ''}"
				aria-label="Match Case${this.matchCaseOverride && !this.matchCase
					? ' (always on without regular expressions)'
					: ''}"
				?disabled="${!this.matchRegex}"
				@click="${this.handleMatchCase}"
				@focus="${this.handleFocus}"
			>
				<code-icon icon="case-sensitive"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchWholeWordOverride}"
				tooltip="Match Whole Word${this.matchWholeWordOverride && !this.matchWholeWord
					? ' (requires regular expressions)'
					: ''}"
				aria-label="Match Whole Word${this.matchWholeWordOverride && !this.matchWholeWord
					? ' (requires regular expressions)'
					: ''}"
				?disabled="${!this.matchRegex}"
				@click="${this.handleMatchWholeWord}"
				@focus="${this.handleFocus}"
			>
				<code-icon icon="whole-word"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchRegex}"
				tooltip="Use Regular Expression"
				aria-label="Use Regular Expression"
				@click="${this.handleMatchRegex}"
				@focus="${this.handleFocus}"
			>
				<code-icon icon="regex"></code-icon>
			</gl-button>
			<gl-button
				appearance="input"
				role="checkbox"
				aria-checked="${this.matchAll}"
				tooltip="Match All"
				aria-label="Match All"
				@click="${this.handleMatchAll}"
				@focus="${this.handleFocus}"
			>
				<code-icon icon="check-all"></code-icon>
			</gl-button>`;
	}
}
