import { css, html } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { SearchOperators, SearchOperatorsLongForm, SearchQuery } from '../../../../../constants.search';
import { searchOperationHelpRegex, searchOperatorsToLongFormMap } from '../../../../../constants.search';
import type { Deferrable } from '../../../../../system/function';
import { debounce } from '../../../../../system/function';
import { GlElement } from '../element';
import type { GlPopover } from '../overlays/popover';
import '../button';
import '../code-icon';
import '../menu';
import '../overlays/popover';

export interface SearchNavigationEventDetail {
	direction: 'first' | 'previous' | 'next' | 'last';
}

export interface SearchModeChangeEventDetail {
	searchMode: 'normal' | 'filter';
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

			display: inline-flex;
			flex-direction: row;
			align-items: center;
			gap: 0.4rem;
			position: relative;

			flex: auto 1 1;
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
			height: 2.4rem;
			background-color: var(--gl-search-input-background);
			color: var(--gl-search-input-foreground);
			border: 1px solid var(--gl-search-input-border);
			border-radius: 0.25rem;
			padding: 0 6.8rem 1px 5.6rem; /* Adjust padding to make space for the button */
			font-family: inherit;
			font-size: inherit;
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

		input[aria-describedby='help-text'] {
			border-color: var(--vscode-inputValidation-infoBorder);
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
	`;

	@query('input') input!: HTMLInputElement;
	@query('gl-popover') popoverEl!: GlPopover;

	@state() errorMessage = '';
	@state() helpType?: SearchOperatorsLongForm;

	private get label() {
		return this.filter ? 'Filter' : 'Search';
	}

	private get placeholder() {
		return `${this.label} commits (↑↓ for history), e.g. "Updates dependencies" author:eamodio`;
	}

	@property({ type: String }) value = '';
	@property({ type: Boolean }) filter = false;
	@property({ type: Boolean }) matchAll = false;
	@property({ type: Boolean }) matchCase = false;
	@property({ type: Boolean }) matchRegex = true;

	get matchCaseOverride() {
		return this.matchRegex ? this.matchCase : true;
	}

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	handleFocus(_e: Event) {
		void this.popoverEl.hide();
	}

	handleClear(_e: Event) {
		this.focus();
		this.value = '';
		this.debouncedOnSearchChanged();
	}

	private _updateHelpTextDebounced: Deferrable<GlSearchInput['updateHelpText']> | undefined;
	updateHelpText() {
		if (this._updateHelpTextDebounced == null) {
			this._updateHelpTextDebounced = debounce(this.updateHelpTextCore.bind(this), 200);
		}

		this._updateHelpTextDebounced();
	}

	updateHelpTextCore() {
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

	handleInputClick(_e: MouseEvent) {
		this.updateHelpText();
	}

	handleInput(e: InputEvent) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;
		this.updateHelpText();
		this.debouncedOnSearchChanged();
	}

	handleMatchAll(_e: Event) {
		this.matchAll = !this.matchAll;
		this.debouncedOnSearchChanged();
	}

	handleMatchCase(_e: Event) {
		this.matchCase = !this.matchCase;
		this.debouncedOnSearchChanged();
	}

	handleMatchRegex(_e: Event) {
		this.matchRegex = !this.matchRegex;
		this.debouncedOnSearchChanged();
	}

	handleFilter(_e: Event) {
		this.filter = !this.filter;
		this.emit('gl-search-modechange', { searchMode: this.filter ? 'filter' : 'normal' });
		this.debouncedOnSearchChanged();
	}

	handleKeyup(_e: KeyboardEvent) {
		this.updateHelpText();
	}

	handleShortcutKeys(e: KeyboardEvent) {
		if (!['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return true;

		e.preventDefault();
		if (e.key === 'Enter') {
			this.emit('gl-search-navigate', { direction: e.shiftKey ? 'previous' : 'next' });
		} else if (this.searchHistory.length !== 0) {
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			const nextPos = this.searchHistoryPos + direction;
			if (nextPos > -1 && nextPos < this.searchHistory.length) {
				this.searchHistoryPos = nextPos;
				const value = this.searchHistory[nextPos];
				if (value !== this.value) {
					this.value = value;
					this.updateHelpText();
					this.debouncedOnSearchChanged();
				}
			}
		}

		return false;
	}

	handleInsertToken(token: string) {
		this.value += `${this.value.length > 0 ? ' ' : ''}${token}`;
		window.requestAnimationFrame(() => {
			this.updateHelpText();
			// `@me` can be searched right away since it doesn't need additional text
			if (token === '@me' || token === 'is:stash' || token === 'type:stash') {
				this.debouncedOnSearchChanged();
			}
			this.input.focus();
			this.input.selectionStart = this.value.length;
		});
	}

	private onSearchChanged() {
		const search: SearchQuery = {
			query: this.value,
			filter: this.filter,
			matchAll: this.matchAll,
			matchCase: this.matchCase,
			matchRegex: this.matchRegex,
		};
		this.emit('gl-search-inputchange', search);
	}
	private debouncedOnSearchChanged = debounce(this.onSearchChanged.bind(this), 250);

	setCustomValidity(errorMessage: string = '') {
		this.errorMessage = errorMessage;
	}

	searchHistory: string[] = [];
	searchHistoryPos = 0;
	logSearch(query: SearchQuery) {
		const lastIndex = this.searchHistory.length - 1;

		// prevent duplicate entries
		if (this.searchHistoryPos < lastIndex || this.searchHistory[lastIndex] === query.query) {
			return;
		}

		this.searchHistory.push(query.query);
		this.searchHistoryPos = this.searchHistory.length - 1;
	}

	override render() {
		return html`<div class="field">
				<div class="controls controls__start">
					<gl-button
						appearance="input"
						role="checkbox"
						aria-checked="${this.filter}"
						tooltip="Filter Commits"
						aria-label="Filter Commits"
						@click="${this.handleFilter}"
						@focus="${this.handleFocus}"
					>
						<code-icon icon="list-filter"></code-icon>
					</gl-button>
					<gl-popover
						class="popover"
						trigger="click focus"
						hoist
						placement="bottom-start"
						.arrow=${false}
						distance="0"
					>
						<gl-button
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
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('@me')}"
								>
									My changes <small>@me</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('message:')}"
								>
									Message <small>message: or =:</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('author:')}"
								>
									Author <small>author: or @:</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('commit:')}"
								>
									Commit SHA <small>commit: or #:</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('file:')}"
								>
									File <small>file: or ?:</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('change:')}"
								>
									Change <small>change: or ~:</small>
								</button>
							</menu-item>
							<menu-item role="none">
								<button
									class="menu-button"
									type="button"
									@click="${() => this.handleInsertToken('type:stash')}"
								>
									Type <small>type:stash or is:stash</small>
								</button>
							</menu-item>
						</div>
					</gl-popover>
				</div>
				<input
					id="search"
					part="search"
					type="text"
					spellcheck="false"
					placeholder="${this.placeholder}"
					.value="${this.value}"
					aria-valid="${!this.errorMessage}"
					aria-describedby="${this.errorMessage !== '' || this.helpType != null ? 'help-text' : ''}"
					@input="${this.handleInput}"
					@keydown="${this.handleShortcutKeys}"
					@keyup="${this.handleKeyup}"
					@click="${this.handleInputClick}"
					@focus="${this.handleFocus}"
				/>
				<div class="message" id="help-text" aria-live="polite">
					${this.errorMessage !== '' ? html`${this.errorMessage}${this.helpType ? html`<br />` : ''}` : ''}
					${this.helpType === 'message:'
						? html`<span
								>Message: use quotes to search for phrases, e.g.
								<code>message:"Updates dependencies"</code></span
						  >`
						: ''}
					${this.helpType === 'author:'
						? html`<span>Author: use a user's account, e.g. <code>author:eamodio</code></span>`
						: ''}
					${this.helpType === 'commit:'
						? html`<span>Commit: use a full or short Commit SHA, e.g. <code>commit:4ce3a</code></span>`
						: ''}
					${this.helpType === 'file:'
						? html`<span
								>File: use a filename with extension, e.g. <code>file:package.json</code>, or a glob
								pattern, e.g. <code>file:*graph*</code></span
						  >`
						: ''}
					${this.helpType === 'change:'
						? html`<span>Change: use a regex pattern, e.g. <code>change:update&#92;(param</code></span>`
						: ''}
					${this.helpType === 'type:'
						? html`<span
								>Type: use <code>stash</code> to search only stashes, e.g. <code>type:stash</code></span
						  >`
						: ''}
				</div>
			</div>
			<div class="controls">
				<gl-button
					appearance="input"
					class="${this.value ? '' : ' is-hidden'}"
					tooltip="Clear"
					aria-label="Clear"
					@click="${this.handleClear}"
					@focus="${this.handleFocus}"
				>
					<code-icon icon="close"></code-icon>
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
					<code-icon icon="whole-word"></code-icon>
				</gl-button>
				<gl-button
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
					aria-checked="${this.matchRegex}"
					tooltip="Use Regular Expression"
					aria-label="Use Regular Expression"
					@click="${this.handleMatchRegex}"
					@focus="${this.handleFocus}"
				>
					<code-icon icon="regex"></code-icon>
				</gl-button>
			</div>`;
	}
}
