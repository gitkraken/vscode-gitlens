import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';
import '../codicon';

// match case is disabled unless regex is true
const template = html<SearchField>`
	<template role="search">
		<label htmlFor="search">
			<code-icon icon="search" aria-label="${x => x.label}" title="${x => x.label}"></code-icon>
		</label>
		<input
			id="search"
			type="search"
			spellcheck="false"
			placeholder="${x => x.placeholder}"
			value="${x => x.value}"
			@input="${(x, c) => x.handleInput(c.event)}"
		/>
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

	input {
		width: 30rem;
		height: 2.4rem;
		background-color: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-background);
		border-radius: 0.25rem;
		padding: 0 6.6rem 0 0.4rem;
		font-family: inherit;
		font-size: 1rem;
	}
	input:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	input::placeholder {
		color: var(--vscode-input-placeholderForeground);
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
		this.$emit('change', {
			pattern: this.value,
			matchAll: this.all,
			matchCase: this.case,
			matchRegex: this.regex,
		});
	}
}
