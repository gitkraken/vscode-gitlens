import { attr, css, customElement, FASTElement, html } from '@microsoft/fast-element';

const template = html<ProgressIndicator>`
	<template class="${x => x.mode}${x => (x.active ? ' active' : '')}" role="progressbar">
		<div class="progress-bar"></div>
	</template>
`;

const styles = css`
	* {
		box-sizing: border-box;
	}

	:host {
		position: absolute;
		left: 0;
		bottom: 0;
		z-index: 5;
		height: 2px;
		width: 100%;
		overflow: hidden;
	}

	.progress-bar {
		background-color: var(--vscode-progressBar-background);
		display: none;
		position: absolute;
		left: 0;
		width: 2%;
		height: 2px;
	}

	:host(.active) .progress-bar {
		display: inherit;
	}

	:host(.discrete) .progress-bar {
		left: 0;
		transition: width 0.1s linear;
	}

	:host(.discrete.done) .progress-bar {
		width: 100%;
	}

	:host(.infinite) .progress-bar {
		animation-name: progress;
		animation-duration: 4s;
		animation-iteration-count: infinite;
		animation-timing-function: steps(100);
		transform: translateZ(0);
	}

	@keyframes progress {
		0% {
			transform: translateX(0) scaleX(1);
		}

		50% {
			transform: translateX(2500%) scaleX(3);
		}

		to {
			transform: translateX(4900%) scaleX(1);
		}
	}
`;

@customElement({ name: 'progress-indicator', template: template, styles: styles })
export class ProgressIndicator extends FASTElement {
	@attr({ mode: 'reflect' })
	mode = 'infinite';

	@attr({ mode: 'boolean' })
	active = false;
}
