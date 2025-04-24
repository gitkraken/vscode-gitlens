import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import './overlays/tooltip';
import type { GlTooltip } from './overlays/tooltip.react';

const tagName = 'gl-copy-container';

@customElement(tagName)
export class GlCopyContainer extends LitElement {
	static readonly tagName = tagName;

	static override styles = css`
		:host {
			display: inline-block;
		}

		gl-tooltip {
			cursor: pointer;
		}
	`;

	@property({ reflect: false })
	content?: string;

	@property()
	copyLabel: string = 'Copy';

	@property()
	copiedLabel: string = 'Copied';

	@property()
	placement?: GlTooltip['placement'] = 'top';

	@property({ type: Number })
	timeout: number = 1000;

	private _resetTimer: ReturnType<typeof setTimeout> | undefined;

	@state()
	private label: string = this.copyLabel;

	override disconnectedCallback() {
		this.cancelResetTimer();
		super.disconnectedCallback();
	}

	override render() {
		if (!this.content) return nothing;

		return html`<gl-tooltip .content="${this.label}" placement="${this.placement}" @click=${this.onClick}>
			<slot></slot>
		</gl-tooltip>`;
	}

	private async onClick(_e: MouseEvent) {
		this.cancelResetTimer();

		if (this.content) {
			try {
				await navigator.clipboard.writeText(this.content);
				this.label = this.copiedLabel;
			} catch {
				this.label = 'Unable to Copy';
			}
		} else {
			this.label = 'Nothing to Copy';
		}
		this.createResetTimer();
	}

	private cancelResetTimer() {
		if (this._resetTimer != null) {
			clearTimeout(this._resetTimer);
			this._resetTimer = undefined;
		}
	}

	private createResetTimer() {
		this._resetTimer = setTimeout(() => {
			this._resetTimer = undefined;
			this.label = this.copyLabel;
		}, this.timeout);
	}
}
