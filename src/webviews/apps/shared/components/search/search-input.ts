import { attr, css, customElement, FASTElement, html, observable, ref, volatile, when } from '@microsoft/fast-element';
import type { SearchQuery } from '../../../../../git/search';
import type { Deferrable } from '../../../../../system/function';
import { debounce } from '../../../../../system/function';
import '../code-icon';
import type { PopMenu } from '../overlays/pop-menu';

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
		<pop-menu ${ref('popmenu')} style="margin-left: -0.25rem;">
			<button
				type="button"
				class="action-button"
				slot="trigger"
				aria-label="${x => x.label}"
				title="${x => x.label}"
			>
				<code-icon icon="search" aria-hidden="true"></code-icon>
				<code-icon class="action-button__more" icon="chevron-down" aria-hidden="true"></code-icon>
			</button>
			<menu-list slot="content">
				<menu-label>Search by</menu-label>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('@me')}">
						My changes <small>@me</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('message:')}">
						Message <small>message: or =:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('author:')}">
						Author <small>author: or @:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('commit:')}">
						Commit SHA <small>commit: or #:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('file:')}">
						File <small>file: or ?:</small>
					</button>
				</menu-item>
				<menu-item role="none">
					<button class="menu-button" type="button" @click="${(x, _c) => x.handleInsertToken('change:')}">
						Change <small>change: or ~:</small>
					</button>
				</menu-item>
			</menu-list>
		</pop-menu>
		<div class="field">
			<input
				${ref('input')}
				id="search"
				part="search"
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

	.action-button {
		position: relative;
		appearance: none;
		font-family: inherit;
		font-size: 1.2rem;
		line-height: 2.2rem;
		// background-color: var(--color-graph-actionbar-background);
		background-color: transparent;
		border: none;
		color: inherit;
		color: var(--color-foreground);
		padding: 0 0.75rem;
		cursor: pointer;
		border-radius: 3px;
		height: auto;

		display: grid;
		grid-auto-flow: column;
		grid-gap: 0.5rem;
		gap: 0.5rem;
		max-width: fit-content;
	}

	.action-button[disabled] {
		pointer-events: none;
		cursor: default;
		opacity: 1;
	}

	.action-button:hover {
		background-color: var(--color-graph-actionbar-selectedBackground);
		color: var(--color-foreground);
		text-decoration: none;
	}

	.action-button[aria-checked] {
		border: 1px solid transparent;
	}

	.action-button[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
		border-color: var(--vscode-inputOption-activeBorder);
	}

	.action-button code-icon,
	.action-button .codicon[class*='codicon-'],
	.action-button .glicon[class*='glicon-'] {
		line-height: 2.2rem;
		vertical-align: bottom;
	}

	.action-button__more,
	.action-button__more.codicon[class*='codicon-'] {
		font-size: 1rem;
		margin-right: -0.25rem;
	}

	.action-button__more::before {
		margin-left: -0.25rem;
	}

	menu-item {
		padding: 0 0.5rem;
	}

	menu-list {
		padding-bottom: 0.5rem;
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
`;

@customElement({
	name: 'search-input',
	template: template,
	styles: styles,
})
export class SearchInput extends FASTElement {
	input!: HTMLInputElement;
	popmenu!: PopMenu;

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

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	handleFocus(_e: Event) {
		this.popmenu.close();
	}

	handleClear(_e: Event) {
		this.value = '';
		this.debouncedEmitSearch();
	}

	private _updateHelpTextDebounced: Deferrable<SearchInput['updateHelpText']> | undefined;
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
			const regex =
				/(?:^|[\b\s]*)((=:|message:|@:|author:|#:|commit:|\?:|file:|~:|change:)(?:"[^"]*"?|\w*))(?:$|[\b\s])/gi;

			let match;
			do {
				match = regex.exec(value);
				if (match == null) break;

				const [, part, op] = match;

				console.log('updateHelpText', cursor, match.index, match.index + part.trim().length, match);
				if (cursor > match.index && cursor <= match.index + part.trim().length) {
					this.helpType = operatorsHelpMap.get(op as SearchOperators);
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
		this.updateHelpText();
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
					this.updateHelpText();
					this.debouncedEmitSearch();
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
