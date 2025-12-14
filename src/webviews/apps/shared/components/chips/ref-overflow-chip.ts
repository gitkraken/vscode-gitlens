import { css, html, LitElement, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '../overlays/tooltip';
import '../code-icon';

export interface RefItem {
	name: string;
	icon?: string;
}

/**
 * A chip component that displays refs (branches, tags) with overflow handling.
 * - 1 ref: Shows a single chip with tooltip
 * - Multiple refs: Shows "ref1 ... refN | +X" range chip with popover (if range=true)
 *   or "ref1 | +X" chip with popover (if range=false)
 *
 * @tag gl-ref-overflow-chip
 */
@customElement('gl-ref-overflow-chip')
export class GlRefOverflowChip extends LitElement {
	static override styles = css`
		:host {
			display: inline-flex;
			align-items: center;
			max-width: 100%;

			--color-focus-border: var(--vscode-focusBorder);
		}

		:focus,
		:focus-within {
			outline-color: var(--color-focus-border);
		}

		.chip {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			padding: 0.1rem 0.4rem;
			border-radius: 0.3rem;
			background-color: var(--vscode-badge-background);
			color: var(--vscode-badge-foreground);
			font-size: 0.85em;
			white-space: nowrap;
			max-width: 100%;
			overflow: hidden;
			opacity: 0.8;
			transition:
				opacity 0.3s ease-in-out,
				color 0.3s ease-in-out;
		}

		.chip:hover,
		.chip:focus {
			color: var(--color-foreground);
			opacity: 1;
		}

		.chip--range {
			cursor: pointer;
		}

		.chip__label {
			flex: 1 1 auto;
			min-width: 0;
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.chip__name {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.chip__ellipsis {
			opacity: 0.8;
			padding: 0 0.4rem;
		}

		.chip__count {
			padding-left: 0.4rem;
			font-weight: 600;
			font-size: 0.85em;
		}

		.chip code-icon {
			flex-shrink: 0;
			font-size: 0.9em;
		}

		/* Tooltip content styles */
		.tooltip-content {
			max-width: 400px;
		}

		.tooltip-header {
			padding-bottom: 0.6rem;
			font-weight: 500;
		}

		.tooltip-list {
			display: flex;
			flex-direction: column;
			gap: 0.2rem;
			max-height: 300px;
			overflow-y: auto;
		}

		.tooltip-item {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.3rem 0.4rem;
			font-size: 0.95em;
			line-height: 1.4;
		}

		.tooltip-item__icon {
			flex-shrink: 0;
			opacity: 0.8;
			font-size: 1.1em;
		}

		.tooltip-item__name {
			flex: 1;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	`;

	/** Default icon for refs that don't specify one */
	@property()
	icon = 'git-branch';

	/** Header text for the tooltip */
	@property()
	label: string | undefined;

	/** Whether to show range format (ref1 ... refN) for multiple refs */
	@property({ type: Boolean })
	range = false;

	/** Array of refs to display */
	@property({ type: Array })
	refs: RefItem[] = [];

	override render() {
		const { refs, icon } = this;

		if (!refs?.length) return nothing;

		const [first] = refs;
		const count = refs.length;

		// Single ref - just show chip with tooltip
		if (count === 1) {
			return html`<gl-tooltip hoist .content=${first.name}>
				<span class="chip" tabindex="0">
					<code-icon icon=${first.icon ?? icon}></code-icon>
					<span class="chip__name">${first.name}</span>
				</span>
			</gl-tooltip>`;
		}

		// Multiple refs - show tooltip with list
		const last = refs.at(-1)!;

		return html`<gl-tooltip hoist>
			<span class="chip chip--range" tabindex="0">
				<span class="chip__label">
					<code-icon icon=${first.icon ?? icon}></code-icon>${first.name}
					${this.range
						? html`<span class="chip__ellipsis">...</span>
								<code-icon icon=${last.icon ?? icon}></code-icon>${last.name}`
						: nothing}
				</span>
				<span class="chip__count">+${count}</span>
			</span>
			<div slot="content" class="tooltip-content">
				${this.label ? html`<div class="tooltip-header">${this.label}</div>` : nothing}
				<div class="tooltip-list">
					${refs.map(
						ref => html`
							<div class="tooltip-item">
								<code-icon class="tooltip-item__icon" icon=${ref.icon ?? icon}></code-icon>
								<span class="tooltip-item__name">${ref.name}</span>
							</div>
						`,
					)}
				</div>
			</div>
		</gl-tooltip>`;
	}
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-ref-overflow-chip': GlRefOverflowChip;
	}
}
