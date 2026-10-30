import * as l10n from '@vscode/l10n';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import type { GlTooltip } from '@gitlens/components/components/overlays/tooltip.js';
import { srOnlyStyles } from '@gitlens/components/components/styles/lit/a11y.css.js';
import '@gitlens/components/components/overlays/tooltip.js';

declare global {
	interface HTMLElementTagNameMap {
		['gl-copy-container']: GlCopyContainer;
	}
}

@customElement('gl-copy-container')
export class GlCopyContainer extends LitElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	static override styles = css`
		:host {
			display: inline-block;
		}

		gl-tooltip {
			cursor: pointer;
		}

		gl-tooltip:focus-visible {
			outline: var(--gl-border-width) solid var(--vscode-focusBorder);
			outline-offset: 2px;
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
			--copy-border-radius: var(--gl-radius-sm);
			--copy-padding: 0 0.4rem;

			color: var(--copy-foreground);
			background: var(--copy-background);
			border: var(--gl-border-width) solid var(--copy-border);
			border-radius: var(--copy-border-radius);
		}

		:host([appearance='toolbar']:hover) {
			background: var(--copy-hover-background);
		}

		:host([appearance='toolbar']:focus-within) {
			outline: var(--gl-border-width) solid var(--color-focus-border);
			outline-offset: -1px;
		}

		:host([appearance='toolbar']) gl-tooltip {
			box-sizing: border-box;
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 2rem;
			padding: var(--copy-padding);
		}

		:host([disabled]) {
			pointer-events: none;
			opacity: 0.5;
		}

		.sr-only {
			${srOnlyStyles}
		}
	`;

	@property({ reflect: true })
	appearance?: 'toolbar';

	@property({ reflect: false })
	content?: string;

	@property()
	copyLabel: string = l10n.t('Copy');

	@property()
	copiedLabel: string = l10n.t('Copied');

	@property({ type: Boolean, reflect: true })
	disabled = false;

	@property()
	placement?: GlTooltip['placement'] = 'top';

	@property({ type: Number })
	timeout: number = 1000;

	/** The copy control's accessible name, for when the copy label isn't one (it is cleared, or it reads
	 *  differently than the action). Defaults to the copy label. */
	@property({ type: String, attribute: 'aria-label' })
	override ariaLabel: string | null = null;

	private _resetTimer: ReturnType<typeof setTimeout> | undefined;
	private _isMouseDown = false;

	@state()
	private label!: string;

	@query('gl-tooltip')
	private tooltip!: GlTooltip;

	override connectedCallback() {
		super.connectedCallback?.();
		this.label = this.copyLabel;
		this.addEventListener('mousedown', this.onMouseDown);
		this.addEventListener('focusin', this.onFocusIn);
		this.addEventListener('focusout', this.onFocusOut);
	}

	override willUpdate(changedProperties: Map<PropertyKey, unknown>) {
		// Keep label in sync with copyLabel when it hasn't been temporarily changed (e.g. to "Copied!")
		if (changedProperties.has('copyLabel') && this._resetTimer == null) {
			this.label = this.copyLabel;
		}
	}

	override disconnectedCallback() {
		this.cancelResetTimer();
		this.removeEventListener('mousedown', this.onMouseDown);
		this.removeEventListener('focusin', this.onFocusIn);
		this.removeEventListener('focusout', this.onFocusOut);
		super.disconnectedCallback?.();
	}

	private onMouseDown = () => {
		this._isMouseDown = true;
		window.addEventListener('mouseup', () => (this._isMouseDown = false), { once: true });
	};

	private onFocusIn = () => {
		// Skip showing on mouse-triggered focus — onClick handles it after copy
		if (this._isMouseDown) return;

		void this.tooltip?.show();
	};

	private onFocusOut = () => {
		void this.tooltip?.hide();
	};

	override render() {
		if (!this.content && !this.disabled) return nothing;

		// The tooltip is the focusable control, so it carries the button role and the name — an icon-only
		// copy control is otherwise announced as nothing. The name stays the action's: what a copy did
		// ("Copied!") is spoken from the status region, which a name changing under focus is not reliably.
		return html`<gl-tooltip
				tabindex="0"
				role="button"
				aria-label=${ifDefined(this.ariaLabel ?? (this.copyLabel || undefined))}
				aria-disabled=${ifDefined(this.disabled ? 'true' : undefined)}
				.content="${this.label}"
				placement="${ifDefined(this.placement)}"
				@click=${this.onClick}
				@keydown=${this.onKeydown}
			>
				<slot></slot>
			</gl-tooltip>
			<span class="sr-only" role="status">${this._resetTimer != null ? this.label : nothing}</span>`;
	}

	private async onClick(_e: MouseEvent) {
		// A copy made while the last one is still being said would leave the status text as it was, which
		// nothing announces — empty the region first, so the same words are spoken again
		const repeat = this._resetTimer != null;
		this.cancelResetTimer();
		if (repeat) {
			this.requestUpdate();
			await this.updateComplete;
		}

		if (this.content) {
			try {
				await navigator.clipboard.writeText(this.content);
				this.label = this.copiedLabel;
			} catch {
				this.label = l10n.t('Unable to Copy');
			}
		} else {
			this.label = l10n.t('Nothing to Copy');
		}
		this.createResetTimer();
		// The timer isn't reactive, and the label may read as before
		this.requestUpdate();
		await this.updateComplete;
		await this.tooltip?.updateComplete;
		void this.tooltip?.show();
	}

	private onKeydown(e: KeyboardEvent) {
		// A disabled control stays focusable, so it can be found and read, but does nothing — as a click on it
		if (this.disabled) return;

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
		// A second click can land while the first awaits the clipboard — one timer, or the label reverts early
		this.cancelResetTimer();
		this._resetTimer = setTimeout(() => {
			this._resetTimer = undefined;
			this.label = this.copyLabel;
		}, this.timeout);
	}
}
