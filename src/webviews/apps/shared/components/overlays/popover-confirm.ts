import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import type { GlButton } from '../button';
import { elementBase } from '../styles/lit/base.css';
import type { GlPopover } from './popover';
import type { GlTooltip } from './tooltip';
import '../button';
import './popover';

declare global {
	interface HTMLElementTagNameMap {
		'gl-popover-confirm': GlPopoverConfirm;
	}

	interface GlobalEventHandlersEventMap {
		'gl-confirm': CustomEvent<void>;
		'gl-cancel': CustomEvent<void>;
	}
}

/**
 * A confirmation popover component for dangerous or important actions.
 *
 * @tag gl-popover-confirm
 *
 * @slot anchor - The element that triggers the popover
 * @slot icon - Optional icon slot (defaults to warning icon)
 *
 * @fires gl-confirm - Fired when the confirm button is clicked
 * @fires gl-cancel - Fired when the cancel button is clicked (if shown)
 *
 * @example
 * ```html
 * <gl-popover-confirm
 *   title="This will abort the rebase"
 *   message="Are you sure you want to continue?"
 *   confirm-text="Yes, continue"
 *   @gl-confirm=${this.onConfirm}
 * >
 *   <gl-button slot="anchor">Delete</gl-button>
 * </gl-popover-confirm>
 * ```
 */
@customElement('gl-popover-confirm')
export class GlPopoverConfirm extends LitElement {
	static override styles = [
		elementBase,
		css`
			:host {
				display: contents;
				--warning-color: var(--vscode-editorWarning-foreground, #cca700);
				--sl-tooltip-border-radius: 0.8rem;
			}

			.confirm-popover {
				display: flex;
				flex-direction: column;
				gap: 0.8rem;
				max-width: 28rem;
				padding: 0.6rem 0.4rem;
			}

			.confirm-popover__header {
				display: flex;
				align-items: flex-start;
				gap: 0.6rem;
			}

			.confirm-popover__icon {
				flex: 0 0 auto;
				color: var(--warning-color);
			}

			.confirm-popover__title {
				margin: 0;
				font-weight: 600;
				font-size: 1.3rem;
				line-height: 1.4;
			}

			.confirm-popover__message {
				margin: 0;
				color: var(--color-foreground--75, inherit);
				line-height: 1.4;
			}

			.confirm-popover__actions {
				display: flex;
				justify-content: flex-end;
				gap: 0.8rem;
				margin-top: 0.4rem;
			}
		`,
	];

	@query('gl-popover')
	private _popover!: GlPopover;

	@query('.confirm-button')
	private _confirmButton!: GlButton;

	@query('.cancel-button')
	private _cancelButton!: GlButton;

	@state()
	private _open = false;

	/** The heading of the confirmation */
	@property()
	heading!: string;

	/** The message/description of the confirmation */
	@property()
	message?: string;

	/** The text for the confirm button */
	@property()
	confirm = 'Confirm';

	/** The appearance for the confirm button */
	@property({ attribute: 'confirm-appearance' })
	confirmAppearance?: GlButton['appearance'];

	/** The variant for the confirm button */
	@property({ attribute: 'confirm-variant' })
	confirmVariant?: GlButton['variant'];

	/** The text for the cancel button */
	@property()
	cancel = 'Cancel';

	/** Which button to focus initially: 'confirm' or 'cancel' */
	@property({ attribute: 'initial-focus' })
	initialFocus: 'confirm' | 'cancel' = 'confirm';

	/** Popover placement */
	@property()
	placement: GlPopover['placement'] = 'top-end';

	/** Optional icon name (uses warning by default) */
	@property()
	icon = 'warning';

	/** Whether to show the icon */
	@property({ type: Boolean, attribute: 'show-icon' })
	showIcon = true;

	override render() {
		return html`
			<gl-popover
				placement=${this.placement}
				trigger="click"
				hoist
				@keydown=${this.onKeydown}
				@gl-popover-show=${this.onPopoverShow}
				@gl-popover-after-show=${this.onPopoverAfterShow}
				@gl-popover-hide=${this.onPopoverHide}
			>
				<slot name="anchor" slot="anchor"></slot>
				<div slot="content" class="confirm-popover" role="alertdialog" aria-labelledby="confirm-title">
					<div class="confirm-popover__header">
						${this.showIcon
							? html`<slot name="icon">
									<code-icon class="confirm-popover__icon" icon=${this.icon}></code-icon>
								</slot>`
							: nothing}
						<h4 id="confirm-title" class="confirm-popover__title">${this.heading}</h4>
					</div>
					${this.message
						? html`<p class="confirm-popover__message">${unsafeHTML(this.message)}</p>`
						: nothing}
					<div class="confirm-popover__actions">
						<gl-button
							class="cancel-button"
							tabindex=${this.initialFocus === 'cancel' ? 1 : 2}
							appearance="secondary"
							@click=${(e: Event) => this.onCancel(e)}
							>${this.cancel}</gl-button
						>
						<gl-button
							class="confirm-button"
							appearance=${ifDefined(this.confirmAppearance)}
							variant=${ifDefined(this.confirmVariant)}
							tabindex=${this.initialFocus === 'confirm' ? 1 : 2}
							@click=${(e: Event) => this.onConfirm(e)}
							>${this.confirm}</gl-button
						>
					</div>
				</div>
			</gl-popover>
		`;
	}

	private onPopoverShow() {
		this._open = true;
		this.setAnchorTooltipsDisabled(true);
	}

	private onPopoverAfterShow() {
		// Use requestAnimationFrame to ensure element is fully rendered before focusing
		requestAnimationFrame(() => {
			if (this.initialFocus === 'cancel') {
				this._cancelButton?.focus();
			} else {
				this._confirmButton?.focus();
			}
		});
	}

	private onPopoverHide() {
		this._open = false;
		this.setAnchorTooltipsDisabled(false);
	}

	private setAnchorTooltipsDisabled(disabled: boolean) {
		// Find tooltips in slotted anchor elements (including their shadow DOMs)
		for (const el of this.querySelectorAll('[slot="anchor"]')) {
			// Check light DOM
			el.querySelectorAll<GlTooltip>('gl-tooltip').forEach(t => (t.disabled = disabled));
			// Check shadow DOM
			el.shadowRoot?.querySelectorAll<GlTooltip>('gl-tooltip').forEach(t => (t.disabled = disabled));
		}
	}

	private onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			const target = e.target as HTMLElement;
			// Let buttons handle their own click events
			if (target.closest('.cancel-button')) {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel();
			} else if (target.closest('.confirm-button')) {
				e.preventDefault();
				e.stopPropagation();
				this.onConfirm();
			}
		}
	}

	private onConfirm(e?: Event) {
		e?.stopPropagation();
		void this.hide();
		this.dispatchEvent(new CustomEvent('gl-confirm', { bubbles: true, composed: true }));
	}

	private onCancel(e?: Event) {
		e?.stopPropagation();
		void this.hide();
		this.dispatchEvent(new CustomEvent('gl-cancel', { bubbles: true, composed: true }));
	}

	/** Programmatically show the popover */
	show() {
		return this._popover?.show();
	}

	/** Programmatically hide the popover */
	hide() {
		return this._popover?.hide();
	}
}
