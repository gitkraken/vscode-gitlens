import { attr, css, customElement, FASTElement, html, observable, ref, volatile, when } from '@microsoft/fast-element';
import type { SearchQuery } from '../../../../../git/search';
import { debounce } from '../../../../../system/function';
import '../codicon';

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

const searchRegex = /(?:^|(?<= ))(message:|@:|author:|#:|commit:|\?:|file:|~:|change:)/gi;
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
				type="search"
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
					html<SearchInput>`<span>Changes: use a regex pattern, e.g. change:update&#92;(param</span>`,
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
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('message:')}">
				Search by Message <small>message: or =:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('author:')}">
				Search by Author <small>author: or @:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('commit:')}">
				Search by Commit SHA <small>commit: or #:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('file:')}">
				Search by File <small>file: or ?:</small>
			</button>
			<button class="helper-button" type="button" @click="${(x, _c) => x.handleInsertToken('change:')}">
				Search by Changes <small>change: or ~:</small>
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
	}
	label[aria-expanded='true'] {
		background-color: var(--vscode-input-background);
		border-radius: 0.3rem 0.3rem 0 0;
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
		background-color: var(--vscode-input-background);
		border-radius: 0 0.3rem 0.3rem 0.3rem;
		outline: none;
	}
	label[aria-expanded='true'] ~ .helper {
		display: block;
	}

	.helper-button {
		display: block;
		width: 100%;
		padding: 0.3rem 0.6rem;
		text-align: left;
	}
	.helper-button:hover {
		background-color: var(--vscode-inputOption-hoverBackground);
	}
	.helper-button:first-child {
		border-top-right-radius: 0.3rem;
	}
	.helper-button:last-child {
		border-bottom-left-radius: 0.3rem;
		border-bottom-right-radius: 0.3rem;
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
		if (!composedPath.includes(this)) {
			this.showHelp = false;
		}
	}

	handleFocus(_e: Event) {
		this.showHelp = false;
	}

	handleClear(_e: Event) {
		this.value = '';
		this.emitSearch();
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

	handleInputClick(e: MouseEvent) {
		this.updateHelpText();
	}

	handleInput(e: InputEvent) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;
		this.updateHelpText();
		this.emitSearch();
	}

	handleMatchAll(_e: Event) {
		this.matchAll = !this.matchAll;
		this.emitSearch();
	}

	handleMatchCase(_e: Event) {
		this.matchCase = !this.matchCase;
		this.emitSearch();
	}

	handleMatchRegex(_e: Event) {
		this.matchRegex = !this.matchRegex;
		this.emitSearch();
	}

	handleKeyup(e: KeyboardEvent) {
		this.updateHelpText();
	}

	handleShortcutKeys(e: KeyboardEvent) {
		if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.altKey) return true;

		e.preventDefault();
		if (e.shiftKey) {
			this.$emit('previous');
		} else {
			this.$emit('next');
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
			this.updateHelpText();
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

	setCustomValidity(errorMessage: string = '') {
		this.errorMessage = errorMessage;
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
