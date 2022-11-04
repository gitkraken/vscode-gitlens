import {
	attr,
	css,
	customElement,
	FASTElement,
	html,
	observable,
	slotted,
	volatile,
	when,
} from '@microsoft/fast-element';
import { hasNodes } from '../helpers/slots';
import { elementBase } from '../styles/base';

const template = html<PopOver>`
	<template>
		${when(
			x => x.hasTopNodes,
			html<PopOver>`
				<div class="top">
					<slot ${slotted('typeNodes')} name="type"></slot>
					<slot ${slotted('actionsNodes')} name="actions"></slot>
				</div>
			`,
		)}
		${when(
			x => x.hasHeadingNodes,
			html<PopOver>`<div class="heading"><slot ${slotted('headingNodes')} name="heading"></slot></div>`,
		)}
		<div class="content"><slot></slot></div>
		${when(x => x.caret, html<PopOver>`<span class="caret"></span>`)}
	</template>
`;

const styles = css`
	${elementBase}

	:host {
		position: absolute;
		width: var(--popover-width, 100%);
		max-width: var(--popover-max-width, 30rem);
		padding: 1.2rem 1.2rem 1.2rem;
		/* update with a standardized z-index */
		z-index: 10;

		background-color: var(--popover-bg);

		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	:host([caret]) {
		transform: translateY(0.8rem);
	}

	.top {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		opacity: 0.5;
		margin-top: -0.4rem;
	}

	.heading {
		font-weight: 600;
	}

	.caret {
		position: absolute;
		bottom: 100%;
		width: 0;
		height: 0;
		border-left: 0.8rem solid transparent;
		border-right: 0.8rem solid transparent;
		border-bottom: 0.8rem solid var(--popover-bg);
	}
`;

@customElement({ name: 'pop-over', template: template, styles: styles })
export class PopOver extends FASTElement {
	@attr({ mode: 'boolean' })
	open = false;

	@attr({ mode: 'boolean' })
	caret = true;

	@observable
	typeNodes?: Node[];

	@observable
	actionsNodes?: Node[];

	@observable
	headingNodes?: Node[];

	@volatile
	get hasTopNodes() {
		return hasNodes(this.typeNodes, this.actionsNodes);
	}

	@volatile
	get hasHeadingNodes() {
		return hasNodes(this.headingNodes);
	}
}
