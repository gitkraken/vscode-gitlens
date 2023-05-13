import { attr, css, customElement, FASTElement, html, observable, ref, volatile, when } from '@microsoft/fast-element';
import type { SearchQuery } from '../../../../../git/search';
import { debounce } from '../../../../../system/function';
import '../code-icon';

export type SearchOperators =
	| '=:'
	| 'message:'
	| '@:'
	| 'author:'
	| '#:'
	| 'commit:'
	| '?:'
	| 'file:'
	| '~:'
	| 'change:';

export type HelpTypes = 'message:' | 'author:' | 'commit:' | 'file:' | 'change:';

const searchRegex = /(?:^|(?<= ))(=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)/gi;
const operatorsHelpMap = new Map<SearchOperators, HelpTypes>([
	['=:', 'message:'],
	['message:', 'message:'],
	['@:', 'author:'],
	['author:', 'author:'],
	['#:', 'commit:'],
	['commit:', 'commit:'],
	['?:', 'file:'],
	['file:', 'file:'],
	['~:', 'change:'],
	['change:', 'change:'],
]);

// match case is disabled unless regex is true
const template = html<SearchInput>`
	<template role="search">
		<label
			for="search"
			aria-controls="helper"
			aria-expanded="${x => x.showHelp}"
			@click="${(x, c) => x.handleShowHelper(c.event)}"
		>
			<code-icon icon="search" aria-label="${x => x.label}" title="${x => x.label}"></code-icon>
			<code-icon class="icon-small" icon="chevron-down" aria-hidden="true"></code-icon>
		</label>
		<div class="field">
			<input
				${ref('input')}
				id="search"
				part="search"
				class="${x => (x.showHelp ? 'has-helper' : '')}"
				type="text"
				spellcheck="false"
				placeholder="${x => x.placeholder}"
				:value="${x => x.value}"
				aria-valid="${x => !x.errorMessage}"
				aria-describedby="${x => (x.errorMessage !== '' || x.helpType != null ? 'help-text' : '')}"
				@input="${(x, c) => x.handleInput(c.event as InputEvent)}"
				@keydown="${(x, c) => x.handleShortcutKeys(c.event as KeyboardEvent)}"
				@keyup="${(x, c) => x.handleKeyup(c.event as KeyboardEvent)}"
				@click="${(x, c) => x.handleInputClick(c.event as MouseEvent)}"
				@focus="${(x, c) => x.handleFocus(c.event)}"
			/>
			<div class="message" id="help-text" aria-live="polite">
				${when(
					x => x.errorMessage !== '',
					html<SearchInput>`${x => x.errorMessage}${x => (x.helpType ? html`<br />` : '')}`,
				)}
				${when(
					x => x.helpType === 'message:',
					html<SearchInput>`<span
						>Message: use quotes to search for phrases, e.g. message:"Updates dependencies"</span
					>`,
				)}
				${when(
					x => x.helpType === 'author:',
					html<SearchInput>`<span>Author: use a user's account, e.g. author:eamodio</span>`,
				)}
				${when(
					x => x.helpType === 'commit:',
					html<SearchInput>`<span>Commit: use a full or short Commit SHA, e.g. commit:4ce3a</span>`,
				)}
				${when(
					x => x.helpType === 'file:',
					html<SearchInput>`<span
						>File: use a filename with extension, e.g. file:package.json, or a glob pattern, e.g.
						file:*graph*
					</span>`,
				)}
				${when(
					x => x.helpType === 'change:',
					html<SearchInput>`<span>Change: use a regex pattern, e.g. change:update&#92;(param</span>`,
				)}
			</div>
		</div>
		<div class="controls">
			<button
				class="control${x => (x.value ? '' : ' is-hidden')}"
				type="button"
				role="button"
				aria-label="Clear"
				title="Clear"
				@click="${(x, c) => x.handleClear(c.event)}"
				@focus="${(x, c) => x.handleFocus(c.event)}"
			>
				<code-icon icon="close"></code-icon>
			</button>
			<button
				class="control"
				type="button"
				role="checkbox"
				aria-label="Match All"
				title="Match All"
				aria-checked="${x => x.matchAll}"
				@click="${(x, c) => x.handleMatchAll(c.event)}"
				@focus="${(x, c) => x.handleFocus(c.event)}"
			>
				<code-icon icon="whole-word"></code-icon>
			</button>
			<button
				class="control"
				type="button"
				role="checkbox"
				aria-label="Match Case${x =>
					x.matchCaseOverride && !x.matchCase ? ' (always on without regular expressions)' : ''}"
				title="Match Case${x =>
					x.matchCaseOverride && !x.matchCase ? ' (always on without regular expressions)' : ''}"
				?disabled="${x => !x.matchRegex}"
				aria-checked="${x => x.matchCaseOverride}"
				@click="${(x, c) => x.handleMatchCase(c.event)}"
				@focus="${(x, c) => x.handleFocus(c.event)}"
			>
				<code-icon icon="case-sensitive"></code-icon>
			</button>
			<button
				class="control"
				type="button"
				role="checkbox"
				aria-label="Use Regular Expression"
				title="Use Regular Expression"
				aria-checked="${x => x.matchRegex}"
				@click="${(x, c) => x.handleMatchRegex(c.event)}"
				@focus="${(x, c) => x.handleFocus(c.event)}"
			>
				<code-icon icon="regex"></code-icon>
			</button>
		</div>
		<div class="helper" id="helper" tabindex="-1" ${ref('helper')}>
			<p class="helper-label">Search by</p>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('@me')}">
				My changes <small>@me</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('message:')}">
				Message <small>message: or =:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('author:')}">
				Author <small>author: or @:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('commit:')}">
				Commit SHA <small>commit: or #:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('file:')}">
				File <small>file: or ?:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('change:')}">
				Change <small>change: or ~:</small>
			</button>
		</div>
	</template>
`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
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
		color: var(--vscode-input-foreground);
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
		background-color: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border);
		border-radius: 0.25rem;
		padding: 0 6.6rem 1px 0.4rem;
		font-family: inherit;
		font-size: inherit;
	}
	input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	input::placeholder {
		color: var(--vscode-input-placeholderForeground);
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
		color: var(--vscode-input-foreground);
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
		align-items: center;
		gap: 0.1rem;
	}

	button {
		padding: 0;
		color: var(--vscode-input-foreground);
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

	.control {
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2rem;
		height: 2rem;
		text-align: center;
		border-radius: 0.25rem;
	}
	.control:hover:not([disabled]):not([aria-checked='true']) {
		background-color: var(--vscode-inputOption-hoverBackground);
	}
	.control[disabled] {
		opacity: 0.5;
	}
	.control[disabled][aria-checked='true'] {
		opacity: 0.8;
	}
	.control[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
		border-color: var(--vscode-inputOption-activeBorder);
	}

	.control.is-hidden {
		display: none;
	}

	.helper {
		display: none;
		position: absolute;
		top: 100%;
		left: 0;
		z-index: 5000;
		width: fit-content;
		background-color: var(--vscode-menu-background);
		border: 1px solid var(--vscode-menu-border);
		outline: none;
	}
	label[aria-expanded='true'] ~ .helper {
		display: block;
	}

	.helper::before {
		font: normal normal normal 14px/1 codicon;
		display: inline-block;
		text-decoration: none;
		text-rendering: auto;
		text-align: center;
		-webkit-font-smoothing: antialiased;
		-moz-osx-font-smoothing: grayscale;
		user-select: none;
		-webkit-user-select: none;
		-ms-user-select: none;

		vertical-align: middle;
		line-height: 2rem;
		letter-spacing: normal;

		content: '\\ea76';
		position: absolute;
		top: 2px;
		right: 5px;
		cursor: pointer;
		pointer-events: all;
		z-index: 10001;
		opacity: 0.6;
	}

	.helper-label {
		text-transform: uppercase;
		font-size: 0.84em;
		line-height: 2.2rem;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
		margin: 0;
		opacity: 0.6;
		user-select: none;
	}

	.helper-button {
		display: block;
		width: 100%;
		padding-left: 0.6rem;
		padding-right: 0.6rem;
		line-height: 2.2rem;
		text-align: left;
		color: var(--vscode-menu-foreground);
	}
	.helper-button:hover {
		color: var(--vscode-menu-selectionForeground);
		background-color: var(--vscode-menu-selectionBackground);
	}
	.helper-button small {
		opacity: 0.5;
	}
`;

@customElement({
	name: 'search-input',
	template: template,
	styles: styles,
})
export class SearchInput extends FASTElement {
	@observable
	showHelp = false;

	@observable
	errorMessage = '';

	@observable
	helpType?: HelpTypes;

	@attr
	label = 'Search';

	@attr
	placeholder = 'Search...';

	@attr
	value = '';

	@attr({ mode: 'boolean' })
	matchAll = false;

	@attr({ mode: 'boolean' })
	matchCase = false;

	@attr({ mode: 'boolean' })
	matchRegex = true;

	@volatile
	get matchCaseOverride() {
		return this.matchRegex ? this.matchCase : true;
	}

	input!: HTMLInputElement;
	helper!: HTMLElement;

	override connectedCallback() {
		super.connectedCallback();
		document.addEventListener('click', this.handleDocumentClick.bind(this));
	}

	override disconnectedCallback() {
		super.disconnectedCallback();
		document.removeEventListener('click', this.handleDocumentClick.bind(this));
	}

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	handleDocumentClick(e: MouseEvent) {
		if (this.showHelp === false) return;

		const composedPath = e.composedPath();
		if (
			!composedPath.includes(this) ||
			// If the ::before element is clicked and is the close icon, close the menu
			(e.type === 'click' &&
				window.getComputedStyle(composedPath[0] as Element, '::before').content === '"\uEA76"')
		) {
			this.showHelp = false;
		}
	}

	handleFocus(_e: Event) {
		this.showHelp = false;
	}

	handleClear(_e: Event) {
		this.value = '';
		this.debouncedEmitSearch();
	}

	updateHelpText() {
		if (this.input == null || this.value === '' || !this.value.includes(':') || this.input.selectionStart == null) {
			this.helpType = undefined;
			return;
		}

		const query = getSubstringFromCursor(this.value, this.input.selectionStart, this.input.selectionEnd);
		const helpOperator = query ? getHelpOperatorsFromQuery(query) : undefined;

		// console.log('updateHelpText operator', helpOperator, 'start', this.input.selectionStart, 'end', this.input.selectionEnd);
		this.helpType = helpOperator;
	}

	debouncedUpdateHelpText = debounce(this.updateHelpText.bind(this), 200);

	handleInputClick(_e: MouseEvent) {
		this.debouncedUpdateHelpText();
	}

	handleInput(e: InputEvent) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;
		this.debouncedUpdateHelpText();
		this.debouncedEmitSearch();
	}

	handleMatchAll(_e: Event) {
		this.matchAll = !this.matchAll;
		this.debouncedEmitSearch();
	}

	handleMatchCase(_e: Event) {
		this.matchCase = !this.matchCase;
		this.debouncedEmitSearch();
	}

	handleMatchRegex(_e: Event) {
		this.matchRegex = !this.matchRegex;
		this.debouncedEmitSearch();
	}

	handleKeyup(_e: KeyboardEvent) {
		this.debouncedUpdateHelpText();
	}

	handleShortcutKeys(e: KeyboardEvent) {
		if (!['Enter', 'ArrowUp', 'ArrowDown'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return true;

		e.preventDefault();
		if (e.key === 'Enter') {
			if (e.shiftKey) {
				this.$emit('previous');
			} else {
				this.$emit('next');
			}
		} else if (this.searchHistory.length !== 0) {
			const direction = e.key === 'ArrowDown' ? 1 : -1;
			const nextPos = this.searchHistoryPos + direction;
			if (nextPos > -1 && nextPos < this.searchHistory.length) {
				this.searchHistoryPos = nextPos;
				const value = this.searchHistory[nextPos];
				if (value !== this.value) {
					this.value = value;
					this.debouncedUpdateHelpText();
					this.debouncedEmitSearch();
				}
			}
		}

		return false;
	}

	handleShowHelper(_e: Event) {
		this.showHelp = !this.showHelp;
		if (this.showHelp) {
			window.requestAnimationFrame(() => {
				this.helper.focus();
			});
		}
	}

	handleInsertToken(token: string) {
		this.value += `${this.value.length > 0 ? ' ' : ''}${token}`;
		window.requestAnimationFrame(() => {
			this.debouncedUpdateHelpText();
			// `@me` can be searched right away since it doesn't need additional text
			if (token === '@me') {
				this.debouncedEmitSearch();
			}
			this.input.focus();
		});
	}

	private emitSearch() {
		const search: SearchQuery = {
			query: this.value,
			matchAll: this.matchAll,
			matchCase: this.matchCase,
			matchRegex: this.matchRegex,
		};
		this.$emit('change', search);
	}
	private debouncedEmitSearch = debounce(this.emitSearch.bind(this), 250);

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
}

function getSubstringFromCursor(value: string, start: number | null, end: number | null): string | undefined {
	if (value === '' || !value.includes(':') || start === null) {
		return;
	}

	const len = value.length;
	const cursor = end === null ? start : Math.max(start, end);
	if (cursor === len) {
		return value;
	}

	let query = cursor === 0 ? '' : value.substring(0, cursor);
	if (cursor < len - 1) {
		const next = value.charAt(cursor);
		if (next !== ' ') {
			// If the cursor is touching a word, include that word in the query
			const match = /^[^\s]+/gi.exec(value.substring(cursor));
			if (match !== null) {
				query += match[0];
			}
		}
	}

	return query;
}

function getHelpOperatorsFromQuery(value: string): HelpTypes | undefined {
	const matches = value.match(searchRegex);
	if (matches === null) {
		return;
	}

	const operator = operatorsHelpMap.get(matches.pop() as SearchOperators);
	return operator;
}
