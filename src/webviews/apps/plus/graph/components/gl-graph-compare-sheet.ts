import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { getAltKeySymbol } from '@env/platform.js';
import { ModifierKeysController } from '../../../shared/controllers/modifier-keys.js';
import { SheetWrapper } from './sheetWrapper.js';
import '../../../shared/components/code-icon.js';
import '../../../shared/components/chips/action-chip.js';
import '../../../shared/components/overlays/detail-sheet.js';
import '../../../shared/components/overlays/tooltip.js';

/** Kept as a small local literal union rather than a shared export — {@link GlGraphDetailsPanel}
 *  keeps its own copy of the same two-value union; not worth a shared type for this. */
type PanelOrientation = 'horizontal' | 'vertical';

declare global {
	interface HTMLElementTagNameMap {
		'gl-graph-compare-sheet': GlGraphCompareSheet;
	}

	interface GlobalEventHandlersEventMap {
		/** Requests promoting this sheet to the pinned split-panel form. `orientation` is set only for
		 *  an Alt-click (an explicit choice that sticks); plain click leaves it undefined so the split
		 *  stays in auto (shape-following) mode. */
		'gl-graph-compare-promote': CustomEvent<{ orientation: PanelOrientation | undefined }>;
	}
}

/**
 * Compare sheet chrome — owns the `gl-detail-sheet` (title, "Move Beside/Below" promote-to-panel
 * action) and wraps the compare body (slotted in by the panel — see
 * `GlGraphDetailsPanel.renderCompareMode`) as its default-slot content.
 *
 * Emits (bubbles + composed):
 * - `gl-graph-compare-promote` {orientation} — the promote-to-panel action chip
 * - `gl-detail-sheet-close` — re-emitted for the inner sheet's own dismissal (see {@link SheetWrapper})
 */
@customElement('gl-graph-compare-sheet')
export class GlGraphCompareSheet extends SheetWrapper(LitElement) {
	static override styles = [
		css`
			:host {
				display: block;
			}

			* {
				box-sizing: border-box;
			}

			/* Title + the slotted onboarding hint sit together on the header's start side, so the hint
			   reads as annotating the title rather than joining the action chips. */
			.title {
				display: inline-flex;
				gap: var(--gl-space-6);
				align-items: center;
				min-width: 0;
			}
		`,
	];

	/** Panel-width-driven preference (see the panel's own `ResizeObserver`) — passed through so the
	 *  promote chip's default (non-Alt) action matches the panel's current width. */
	@property({ attribute: false })
	preferredOrientation: PanelOrientation = 'vertical';

	private readonly _modifiers = new ModifierKeysController(this);

	override render(): unknown {
		// Click pins to preferred orientation; Alt-click flips it. Icon + tooltip update live with
		// the Alt-key so the affordance previews the actual action.
		const labelFor = (o: PanelOrientation) => (o === 'horizontal' ? 'Move Beside' : 'Move Below');
		const iconFor = (o: PanelOrientation) => (o === 'horizontal' ? 'layout-sidebar-right' : 'layout-panel');
		const preferred = this.preferredOrientation;
		const alternate = preferred === 'horizontal' ? 'vertical' : 'horizontal';
		const effective = this._modifiers.altKey ? alternate : preferred;
		const actionLabel = labelFor(effective);
		const actionIcon = iconFor(effective);
		const tooltipContent = this._modifiers.altKey
			? actionLabel
			: `${actionLabel}\n[${getAltKeySymbol()}] ${labelFor(alternate)}`;

		return html`<gl-detail-sheet
			esc-managed
			aria-label="Compare"
			close-label="Close"
			@gl-detail-sheet-close=${this.handleInnerClose}
		>
			<span slot="title" class="title">Comparing References<slot name="title-hint"></slot></span>
			<gl-action-chip
				slot="actions"
				icon=${actionIcon}
				label=${tooltipContent}
				overlay="tooltip"
				@click=${this.handlePromoteClick}
			></gl-action-chip>
			<slot name="actions" slot="actions"></slot>
			<slot></slot>
		</gl-detail-sheet>`;
	}

	/** The promote-to-panel action — replaces the panel's old `querySelector('gl-detail-sheet')`
	 *  hack, which couldn't reach an inner sheet owned by a shadow-DOM wrapper like this one. */
	private handlePromoteClick = (e: MouseEvent): void => {
		// Skip this sheet's own focus-restoration — the user is transitioning INTO the panel,
		// not dismissing the sheet.
		const sheet = this.shadowRoot?.querySelector('gl-detail-sheet');
		if (sheet != null) {
			sheet.skipFocusRestore = true;
		}

		// Plain click keeps the orientation in auto (shape-following) mode; Alt-click is an
		// explicit choice that sticks.
		const preferred = this.preferredOrientation;
		const target = e.altKey ? (preferred === 'horizontal' ? 'vertical' : 'horizontal') : undefined;
		this.dispatchEvent(
			new CustomEvent<{ orientation: PanelOrientation | undefined }>('gl-graph-compare-promote', {
				detail: { orientation: target },
				bubbles: true,
				composed: true,
			}),
		);
	};
}
