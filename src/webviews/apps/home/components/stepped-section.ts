import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';
import { numberConverter } from '../../shared/components/converters/number-converter';
import '../../shared/components/codicon';

const template = html<SteppedSection>`<template role="region">
	<header class="heading" role="heading" aria-level="${x => x.headingLevel}">
		<button
			id="button"
			class="button"
			type="button"
			aria-expanded="${x => !x.completed}"
			aria-controls="content"
			@click="${(x, c) => x.handleClick(c.event)}"
		>
			<slot name="heading"></slot>
			<small class="description"><slot name="description"></slot></small>
		</button>
	</header>
	<div class="content${x => (x.completed ? ' is-hidden' : '')}" id="content" aria-labelledby="button">
		<slot></slot>
	</div>
	<span class="checkline">
		<span
			class="checkbox"
			title="${x => (x.completed ? 'Uncheck step' : 'Check step')}"
			@click="${(x, c) => x.handleClick(c.event)}"
			><code-icon
				class="check-icon"
				icon="${x => (x.completed ? 'pass-filled' : 'circle-large-outline')}"
			></code-icon
			><code-icon class="check-hover-icon" icon="${x => (x.completed ? 'pass-filled' : 'pass')}"></code-icon
		></span>
	</span>
</template>`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		display: grid;
		gap: 0 0.8rem;
		grid-template-columns: 16px auto;
		grid-auto-flow: column;
		margin-bottom: 2.4rem;
	}

	.button {
		width: 100%;
		padding: 0.1rem 0 0 0;
		font-size: var(--vscode-editor-font-size);
		line-height: 1.6rem;
		font-family: inherit;
		border: none;
		color: inherit;
		background: none;
		text-align: left;
		text-transform: uppercase;
		cursor: pointer;
	}

	.button:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 0.2rem;
	}

	.checkline {
		position: relative;
		grid-column: 1;
		grid-row: 1 / span 2;
		color: var(--vscode-textLink-foreground);
	}

	:host(:not(:last-of-type)) .checkline:after {
		content: '';
		position: absolute;
		border-left: 0.1rem solid currentColor;
		width: 0;
		top: 1.6rem;
		bottom: -2.4rem;
		left: 50%;
		transform: translateX(-50%);
		opacity: 0.3;
	}

	.checkbox {
		cursor: pointer;
	}
	.checkbox code-icon {
		pointer-events: none;
	}

	.heading:hover ~ .checkline .check-icon,
	.checkbox:hover .check-icon {
		display: none;
	}

	.check-hover-icon {
		display: none;
	}
	.heading:hover ~ .checkline .check-hover-icon,
	.checkbox:hover .check-hover-icon {
		display: unset;
	}

	.content {
		margin-top: 1rem;
	}

	.content.is-hidden {
		display: none;
	}

	.description {
		margin-left: 0.2rem;
		text-transform: none;
		color: var(--gitlens-brand-color-2);
		opacity: 0.6;
		font-style: italic;
	}
`;

@customElement({ name: 'stepped-section', template: template, styles: styles })
export class SteppedSection extends FASTElement {
	@attr({ attribute: 'heading-level', converter: numberConverter })
	headingLevel = 2;

	@attr({ mode: 'boolean' })
	completed = false;

	handleClick(_e: Event) {
		this.completed = !this.completed;
		this.$emit('complete', this.completed);
	}
}
