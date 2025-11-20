import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GlTooltip } from './overlays/tooltip';
import './overlays/tooltip';

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

		/* Hide focus outline on slotted copy icon - we show it on the host instead */
		::slotted(.copy-icon) {
			outline: none !important;
		}

		:host([appearance='toolbar']) {
			--copy-background: transparent;
			--copy-foreground: var(--vscode-foreground);
			--copy-hover-background: var(--vscode-toolbar-hoverBackground);
			--copy-border: transparent;
			--copy-border-radius: var(--gk-action-radius, 0.3rem);
			--copy-padding: 0.4rem;

			border: 1px solid var(--copy-border);
			border-radius: var(--copy-border-radius);
			background: var(--copy-background);
			color: var(--copy-foreground);
		}

		:host([appearance='toolbar']:hover) {
			background: var(--copy-hover-background);
		}

		:host([appearance='toolbar']:focus-within) {
			outline: 1px solid var(--color-focus-border);
			outline-offset: -1px;
		}

		:host([appearance='toolbar']) gl-tooltip {
			padding: var(--copy-padding);
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 1.8rem;
			box-sizing: border-box;
		}

		:host([disabled]) {
			pointer-events: none;
			opacity: 0.5;
		}
	`;

	@property({ reflect: true })
	appearance?: 'toolbar';

	@property({ reflect: false })
	content?: string;

	@property()
	copyLabel: string = 'Copy';

	@property()
	copiedLabel: string = 'Copied';

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property()
	placement?: GlTooltip['placement'] = 'top';

	@property({ type: Number })
	timeout: number = 1000;

	private _resetTimer: ReturnType<typeof setTimeout> | undefined;

	@state()
	private label!: string;

	override disconnectedCallback() {
		this.cancelResetTimer();
		super.disconnectedCallback?.();
	}

	override connectedCallback() {
		super.connectedCallback?.();

		this.label = this.copyLabel;
	}

	override render() {
		if (!this.content && !this.disabled) return nothing;

		return html`<gl-tooltip
			.content="${this.label}"
			placement="${ifDefined(this.placement)}"
			@click=${this.onClick}
			@keydown=${this.onKeydown}
		>
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

	private onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			void this.onClick(e as unknown as MouseEvent);
		}
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
