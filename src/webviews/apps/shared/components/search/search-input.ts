import { attr, css, customElement, FASTElement, html, observable, ref, volatile } from '@microsoft/fast-element';
import type { SearchQuery } from '../../../../../git/search';
import '../codicon';

// match case is disabled unless regex is true
const template = html<SearchInput>`
	<template role="search">
		<label htmlFor="search">
			<code-icon icon="search" aria-label="${x => x.label}" title="${x => x.label}"></code-icon>
		</label>
		<div class="field">
			<input
				${ref('input')}
				id="search"
				part="search"
				type="search"
				spellcheck="false"
				placeholder="${x => x.placeholder}"
				:value="${x => x.value}"
				aria-valid="${x => !x.errorMessage}"
				aria-describedby="${x => (!x.errorMessage ? '' : 'error')}"
				@input="${(x, c) => x.handleInput(c.event)}"
				@keydown="${(x, c) => x.handleShortcutKeys(c.event as KeyboardEvent)}"
			/>
			<div class="message" id="error" aria-live="polite">${x => x.errorMessage}</div>
		</div>
		<div class="controls">
			<button
				class="clear-button${x => (x.value ? '' : ' clear-button__hidden')}"
				type="button"
				role="button"
				aria-label="Clear"
				title="Clear"
				@click="${(x, c) => x.handleClear(c.event)}"
			>
				<code-icon icon="close"></code-icon>
			</button>
			<button
				type="button"
				role="checkbox"
				aria-label="Match All"
				title="Match All"
				aria-checked="${x => x.matchAll}"
				@click="${(x, c) => x.handleMatchAll(c.event)}"
			>
				<code-icon icon="whole-word"></code-icon>
			</button>
			<button
				type="button"
				role="checkbox"
				aria-label="Match Case${x =>
					x.matchCaseOverride && !x.matchCase ? ' (always on without regular expressions)' : ''}"
				title="Match Case${x =>
					x.matchCaseOverride && !x.matchCase ? ' (always on without regular expressions)' : ''}"
				?disabled="${x => !x.matchRegex}"
				aria-checked="${x => x.matchCaseOverride}"
				@click="${(x, c) => x.handleMatchCase(c.event)}"
			>
				<code-icon icon="case-sensitive"></code-icon>
			</button>
			<button
				type="button"
				role="checkbox"
				aria-label="Use Regular Expression"
				title="Use Regular Expression"
				aria-checked="${x => x.matchRegex}"
				@click="${(x, c) => x.handleMatchRegex(c.event)}"
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
		gap: 0.8rem;
		position: relative;

		flex: auto 1 1;
	}

	label {
		color: var(--vscode-input-foreground);
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

	input[aria-valid='false'] {
		border-color: var(--vscode-inputValidation-errorBorder);
	}
	input[aria-valid='false']:focus {
		outline-color: var(--vscode-inputValidation-errorBorder);
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}

	.message {
		position: absolute;
		top: 100%;
		left: 0;
		width: 100%;
		padding: 0.4rem;
		transform: translateY(-0.1rem);
		z-index: 1000;
		background-color: var(--vscode-inputValidation-errorBackground);
		border: 1px solid var(--vscode-inputValidation-errorBorder);
		color: var(--vscode-input-foreground);
		font-size: 1.2rem;
		line-height: 1.4;
	}

	input:not([aria-valid='false']:focus) + .message {
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
		display: inline-flex;
		justify-content: center;
		align-items: center;
		width: 2rem;
		height: 2rem;
		padding: 0;
		color: var(--vscode-input-foreground);
		border: 1px solid transparent;
		background: none;
		text-align: center;
		border-radius: 0.25rem;
	}
	button[role='checkbox']:focus:not([disabled]) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	button:not([disabled]) {
		cursor: pointer;
	}
	button:hover:not([disabled]):not([aria-checked='true']) {
		background-color: var(--vscode-inputOption-hoverBackground);
	}
	button[disabled] {
		opacity: 0.5;
	}
	button[disabled][aria-checked='true'] {
		opacity: 0.8;
	}
	button[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
		border-color: var(--vscode-inputOption-activeBorder);
	}

	.clear-button__hidden {
		display: none;
	}
`;

@customElement({
	name: 'search-input',
	template: template,
	styles: styles,
})
export class SearchInput extends FASTElement {
	@observable
	errorMessage = '';

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

	override focus(options?: FocusOptions): void {
		this.input.focus(options);
	}

	handleClear(_e: Event) {
		this.value = '';
		this.emitSearch();
	}

	handleInput(e: Event) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;
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
