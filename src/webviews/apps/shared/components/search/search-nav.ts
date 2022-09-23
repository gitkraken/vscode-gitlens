import { attr, css, customElement, FASTElement, html, volatile, when } from '@microsoft/fast-element';
import { pluralize } from '../../../../../system/string';
import { numberConverter } from '../converters/number-converter';
import '../codicon';

const template = html<SearchNav>`<template>
	<span class="count${x => (x.total < 1 && x.valid ? ' error' : '')}">
		${when(x => x.total < 1, html<SearchNav>`${x => x.formattedLabel}`)}
		${when(
			x => x.total > 0,
			html<SearchNav>`<span aria-current="step">${x => x.step}</span> of
				${x => x.total}${x => (x.more ? '+' : '')}<span class="sr-only"> ${x => x.formattedLabel}</span>`,
		)}
	</span>
	<button
		type="button"
		class="button"
		?disabled="${x => !x.hasPrevious}"
		@click="${(x, c) => x.handlePrevious(c.event)}"
	>
		<code-icon
			icon="arrow-up"
			aria-label="Go to previous ${x => x.label}"
			title="Go to previous ${x => x.label}"
		></code-icon>
	</button>
	<button type="button" class="button" ?disabled="${x => !x.hasNext}" @click="${(x, c) => x.handleNext(c.event)}">
		<code-icon
			icon="arrow-down"
			aria-label="Go to next ${x => x.label}"
			title="Go to next ${x => x.label}"
		></code-icon>
	</button>
</template>`;

const styles = css`
	:host {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		/* gap: 0.8rem; */
		color: var(--vscode-titleBar-inactiveForeground);
	}
	:host(:focus) {
		outline: 0;
	}

	.count {
		flex: none;
		margin-right: 0.4rem;
		font-size: 1.2rem;
	}

	.count.error {
		color: var(--vscode-errorForeground);
	}

	.button {
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		color: inherit;
		border: none;
		background: none;
		text-align: center;
	}
	.button:focus {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}
	.button:not([disabled]) {
		cursor: pointer;
	}
	.button:hover:not([disabled]) {
		background-color: var(--vscode-titleBar-activeBackground);
	}

	.button > code-icon[icon='arrow-up'] {
		transform: translateX(-0.1rem);
	}

	.sr-only {
		clip: rect(0 0 0 0);
		clip-path: inset(50%);
		height: 1px;
		overflow: hidden;
		position: absolute;
		white-space: nowrap;
		width: 1px;
	}
`;

@customElement({ name: 'search-nav', template: template, styles: styles })
export class SearchNav extends FASTElement {
	@attr({ converter: numberConverter })
	total = 0;

	@attr({ converter: numberConverter })
	step = 0;

	@attr({ mode: 'boolean' })
	more = false;

	@attr({ mode: 'boolean' })
	valid = false;

	@attr
	label = 'result';

	@volatile
	get formattedLabel() {
		return pluralize(this.label, this.total, { zero: 'No' });
	}

	@volatile
	get hasPrevious() {
		if (this.total === 0) {
			return false;
		}

		return this.step > 1;
	}

	@volatile
	get hasNext() {
		if (this.total === 0) {
			return false;
		}

		return this.step < this.total;
	}

	handlePrevious(_e: Event) {
		this.$emit('previous');
	}

	handleNext(_e: Event) {
		this.$emit('next');
	}
}
