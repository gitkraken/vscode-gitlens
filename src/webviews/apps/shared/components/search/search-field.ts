import { attr, css, customElement, FASTElement, html, observable, ref } from '@microsoft/fast-element';
import type { SearchQuery } from '../../../../../git/search';
import '../codicon';

// match case is disabled unless regex is true
const template = html<SearchField>`
	<template role="search">
		<label htmlFor="search">
			<code-icon icon="search" aria-label="${x => x.label}" title="${x => x.label}"></code-icon>
		</label>
		<div class="field">
			<input
				id="search"
				type="search"
				spellcheck="false"
				placeholder="${x => x.placeholder}"
				value="${x => x.value}"
				aria-valid="${x => x.errorMessage === ''}"
				aria-describedby="${x => (x.errorMessage === '' ? '' : 'error')}"
				@input="${(x, c) => x.handleInput(c.event)}"
				@keyup="${(x, c) => x.handleShortcutKeys(c.event as KeyboardEvent)}"
			/>
			<div class="message" id="error" aria-live="polite">${x => x.errorMessage}</div>
		</div>
		<div class="controls">
			<button
				type="button"
				role="checkbox"
				aria-label="Match All"
				title="Match All"
				aria-checked="${x => x.all}"
				@click="${(x, c) => x.handleAll(c.event)}"
			>
				<code-icon icon="whole-word"></code-icon>
			</button>
			<button
				type="button"
				role="checkbox"
				aria-label="Match Case in Regular Expression"
				title="Match Case in Regular Expression"
				?disabled="${x => !x.regex}"
				aria-checked="${x => x.case}"
				@click="${(x, c) => x.handleCase(c.event)}"
			>
				<code-icon icon="case-sensitive"></code-icon>
			</button>
			<button
				type="button"
				role="checkbox"
				aria-label="Use Regular Expression"
				title="Use Regular Expression"
				aria-checked="${x => x.regex}"
				@click="${(x, c) => x.handleRegex(c.event)}"
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
	}

	label {
		color: var(--vscode-input-foreground);
	}

	.field {
		position: relative;
		width: 30rem;
	}

	input {
		width: 100%;
		height: 2.4rem;
		background-color: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-background);
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
		color: inherit;
		border: none;
		background: none;
		text-align: center;
		border-radius: 0.25rem;
	}
	button:focus:not([disabled]) {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	button:not([disabled]) {
		cursor: pointer;
	}
	button:hover:not([disabled]) {
		background-color: var(--vscode-inputOption-hoverBackground);
	}
	button[disabled] {
		opacity: 0.5;
	}
	button[aria-checked='true'] {
		background-color: var(--vscode-inputOption-activeBackground);
		color: var(--vscode-inputOption-activeForeground);
	}
`;

@customElement({
	name: 'search-field',
	template: template,
	styles: styles,
})
export class SearchField extends FASTElement {
	@observable
	errorMessage = '';

	@attr
	label = 'Search';

	@attr
	placeholder = 'Search...';

	@attr
	value = '';

	@attr({ mode: 'boolean' })
	all = false;

	@attr({ mode: 'boolean' })
	case = false;

	@attr({ mode: 'boolean' })
	regex = true;

	handleInput(e: Event) {
		const value = (e.target as HTMLInputElement)?.value;
		this.value = value;
		this.emitSearch();
	}

	handleShortcutKeys(e: KeyboardEvent) {
		if (e.key !== 'Enter' && e.key !== 'F3') return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;

		e.preventDefault();
		if (e.shiftKey) {
			this.$emit('previous');
		} else {
			this.$emit('next');
		}
	}

	handleAll(_e: Event) {
		this.all = !this.all;
		this.emitSearch();
	}

	handleCase(_e: Event) {
		this.case = !this.case;
		this.emitSearch();
	}

	handleRegex(_e: Event) {
		this.regex = !this.regex;
		if (!this.regex) {
			this.case = false;
		}
		this.emitSearch();
	}

	emitSearch() {
		const search: SearchQuery = {
			query: this.value,
			matchAll: this.all,
			matchCase: this.case,
			matchRegex: this.regex,
		};
		this.$emit('change', search);
	}

	setCustomValidity(errorMessage: string = '') {
		this.errorMessage = errorMessage;
	}
}
