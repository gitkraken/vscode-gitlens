import { attr, css, customElement, FASTElement, html, when } from '@microsoft/fast-element';
import { numberConverter } from '../../shared/components/converters/number-converter';
import '../../shared/components/codicon';

const template = html<CardSection>`<template role="region">
	${when(
		x => x.noHeading === false,
		html<CardSection>`<header>
			<div class="heading" role="heading" aria-level="${x => x.headingLevel}">
				<slot name="heading"></slot>
				<small class="description"><slot name="description"></slot></small>
			</div>
			${when(
				x => x.dismissable,
				html<CardSection>`<button
					class="dismiss"
					type="button"
					@click="${(x, c) => x.handleDismiss(c.event)}"
					title="dismiss"
					aria-label="dismiss"
				>
					<code-icon icon="close"></code-icon>
				</button>`,
			)}
		</header>`,
	)}
	<div class="content"><slot></slot></div>
</template>`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		display: block;
		padding: 1.2rem;
		background-color: var(--card-background);
		margin-bottom: 1rem;
		border-radius: 0.4rem;
		background-repeat: no-repeat;
		background-size: cover;
		transition: aspect-ratio linear 100ms, background-color linear 100ms;
	}

	:host(:hover) {
		background-color: var(--card-hover-background);
	}

	header {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		gap: 0.4rem;
		margin-bottom: 1rem;
	}

	.dismiss {
		width: 2rem;
		height: 2rem;
		padding: 0;
		font-size: var(--vscode-editor-font-size);
		line-height: 2rem;
		font-family: inherit;
		border: none;
		color: inherit;
		background: none;
		text-align: left;
		cursor: pointer;
		opacity: 0.5;
		flex: none;
		text-align: center;
	}

	.dismiss:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: 0.2rem;
	}

	.heading {
		text-transform: uppercase;
	}

	.description {
		margin-left: 0.2rem;
		text-transform: none;
		/* color needs to come from some sort property */
		color: #b68cd8;
	}
`;

@customElement({ name: 'card-section', template: template, styles: styles })
export class CardSection extends FASTElement {
	@attr({ attribute: 'no-heading', mode: 'boolean' })
	noHeading = false;

	@attr({ attribute: 'heading-level', converter: numberConverter })
	headingLevel = 2;

	@attr({ mode: 'boolean' })
	dismissable = false;

	@attr({ mode: 'boolean' })
	expanded = true;

	handleDismiss(_e: Event) {
		this.$emit('dismiss');
	}
}
