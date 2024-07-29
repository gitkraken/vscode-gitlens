import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('gl-progress-tracker')
export class ProgressTracker extends LitElement {
	@property({ type: Number })
	stepCount = 0;

	@property({ type: Number })
	progress = 0;

	static override readonly styles = css`
		:host {
			padding: initial;
			display: flex;
			align-items: center;
			gap: 12px;
			--gl-progress-background-color: gray;
			--gl-progress-foreground-color: var(--vscode-progressBar-background, blue);
		}
		span {
			flex-shrink: 0;
			font-weight: 700;
			font-size: 13px;
		}
		progress::-webkit-progress-bar {
			background-color: var(--gl-progress-background-color);
			border-radius: 4px;
		}
		progress::-webkit-progress-value {
			background: var(--gl-progress-foreground-color);
			transition: 0.1s ease-in;
			border-radius: 4px;
		}
		progress {
			background: unset;
			height: 7px;
			flex: 1;
		}
	`;

	protected override render() {
		return html`
			<label for="progress-bar">${this.progress}/${this.stepCount}</label>
			<progress id="progress-bar" value=${this.progress} max=${this.stepCount}></progress>
		`;
	}
}
