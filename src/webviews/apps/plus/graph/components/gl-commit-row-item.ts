import { css, html, LitElement, nothing } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { isUncommitted } from '@gitlens/git/utils/revision.utils.js';
import type { CommitSignatureShape } from '../../../../commitDetails/protocol.js';
import type { Preferences } from '../../../../plus/graph/detailsProtocol.js';
import {
	commitPopoverStyles,
	renderCommitPopoverContent,
} from '../../../shared/components/commit/commit-popover-content.js';
import type { GlPopover } from '../../../shared/components/overlays/popover.js';
import { scrollableBase } from '../../../shared/components/styles/lit/base.css.js';
import type { CommitRowData } from './gl-commit-row.js';
import './gl-commit-row.js';
import '../../../shared/components/commit/signature-badge.js';
import '../../../shared/components/overlays/popover.js';

export interface CommitRowItemSelectEventDetail {
	sha: string;
}

/**
 * Canonical interactive commit row: wraps the presentational `gl-commit-row` in a hover/focus
 * details popover and a clickable, optionally-selectable anchor. Used by the graph details surfaces
 * (conflict sheet, multi-commit poles, compare list) so every commit row behaves identically.
 *
 * - Hover or keyboard-focus reveals the shared `renderCommitPopoverContent` card (author, date, sha,
 *   optional signature, full message); a click dismisses it and emits `gl-commit-row-item-select`.
 * - `selectable` + `selected` render a selection affordance (toggled by the consumer).
 * - `signature` adds a leading badge on the row and a signature section in the popover.
 */
@customElement('gl-commit-row-item')
export class GlCommitRowItem extends LitElement {
	static override styles = [
		scrollableBase,
		commitPopoverStyles,
		css`
			:host {
				/* Make the internal gl-popover anchor span the row's container so the commit row is
				   full-width (not shrink-to-content) in every consumer. */
				--gl-popover-anchor-width: 100%;

				display: block;
			}

			.item {
				position: relative;
				/* border-box so inline-size:100% INCLUDES the padding — otherwise 100% + padding overflows
				   the gl-popover anchor (overflow:hidden) and clips the row's right edge (the date). */
				box-sizing: border-box;
				display: flex;
				gap: var(--gl-space-4);
				align-items: center;
				inline-size: 100%;
				min-width: 0;
				padding-block: var(--gl-commit-row-item-padding-block, var(--gl-space-2));
				padding-inline: var(--gl-commit-row-item-padding-inline, var(--gl-space-8));
				font: inherit;
				color: inherit;
				text-align: start;
				cursor: pointer;
				background: transparent;
				border: none;
				border-radius: var(--gl-radius-sm);
			}

			.item > gl-commit-row {
				flex: 1 1 auto;
				min-width: 0;
			}

			/* Overlay the signature badge on the avatar's TOP-right edge (the avatar is 2.4rem, leading +
			   vertically centered inside gl-commit-row): top-right keeps it clear of the bottom-right
			   committer-overlay convention, and pulling it onto the circular avatar's edge (not the
			   bounding-box corner) keeps it off the sha/message text in the column to the right.
			   Center-anchored (translate -50%) so the notch backing can't shift it. */
			.item__signature {
				position: absolute;
				inset-block-start: calc(50% - 0.9rem);
				inset-inline-start: calc(var(--gl-commit-row-item-padding-inline, var(--gl-space-8)) + 2rem);
				z-index: 1;
				padding: 0.1rem;
				pointer-events: none;
				background: var(--vscode-editor-background);
				border-radius: 50%;
				transform: translate(-50%, -50%);
			}

			.item:hover {
				background: var(--vscode-list-hoverBackground);
			}

			.item:focus-visible {
				outline: var(--gl-border-width) solid var(--vscode-focusBorder);
				outline-offset: -1px;
			}

			/* Selection look is themable so consumers can express their own semantics (e.g. compare-mode's
			   warning-hue "active scope" indicator) — defaults to a neutral list-selection tint + accent rail. */
			:host([selected]) .item {
				background: var(
					--gl-commit-row-item-selected-background,
					var(--vscode-list-inactiveSelectionBackground)
				);
				box-shadow: inset var(--gl-commit-row-item-selected-rail-width, var(--gl-border-width)) 0 0 0
					var(--gl-commit-row-item-selected-accent, var(--vscode-charts-green, #4ec9b0));
			}
		`,
	];

	@property({ type: Object })
	commit?: CommitRowData;

	@property({ type: Object })
	preferences?: Preferences;

	@property({ reflect: true, attribute: 'date-position' })
	datePosition: 'inline' | 'right' = 'right';

	/** Popover placement (conflict sheet stacks upward with `top`; others default to `bottom`). */
	@property()
	placement: 'top' | 'bottom' | 'left' | 'right' = 'bottom';

	/** Optional commit signature — adds a leading badge and a signature section in the popover. */
	@property({ type: Object })
	signature?: CommitSignatureShape;

	@property({ attribute: 'committer-email' })
	committerEmail?: string;

	/** Overrides the anchor's accessible name (defaults to the row's rendered content). */
	@property()
	label?: string;

	@property({ reflect: true, type: Boolean })
	selectable = false;

	@property({ reflect: true, type: Boolean })
	selected = false;

	/** Roving tabindex for listbox `option` mode — the container marks only the active row tabbable. */
	@property({ type: Boolean })
	tabbable = true;

	@query('gl-popover')
	private _popover?: GlPopover;

	@query('.item')
	private _anchor?: HTMLElement;

	override render(): unknown {
		const commit = this.commit;
		if (commit == null) return nothing;

		// WIP/uncommitted rows carry no author/date/history, so the hover card would show empty fields
		// and an "Invalid Date" — skip the popover and render just the row (mirrors gl-commit-row's WIP case).
		if (isUncommitted(commit.sha)) return this.renderAnchor(commit);

		return html`<gl-popover placement=${this.placement} trigger="hover focus-visible">
			${this.renderAnchor(commit)}
			<div slot="content">
				${renderCommitPopoverContent(
					{
						name: commit.author,
						email: commit.authorEmail,
						avatar: commit.avatarUrl,
						date: new Date(commit.date),
					},
					commit.message,
					commit.shortSha,
					this.preferences?.dateFormat,
					this.signature,
					this.committerEmail,
					commit.committerName != null || commit.committerEmail != null
						? {
								name: commit.committerName,
								email: commit.committerEmail,
								avatarUrl: commit.committerAvatarUrl,
								date: commit.committerDate != null ? new Date(commit.committerDate) : undefined,
							}
						: undefined,
				)}
			</div>
		</gl-popover>`;
	}

	private renderAnchor(commit: CommitRowData): unknown {
		const inner = html`${this.signature != null
				? html`<gl-signature-badge
						class="item__signature"
						.signature=${this.signature}
						.committerEmail=${this.committerEmail}
					></gl-signature-badge>`
				: nothing}
			<gl-commit-row
				.commit=${commit}
				.preferences=${this.preferences}
				date-position=${this.datePosition}
			></gl-commit-row>`;

		// `selectable` → single-select listbox option (compare-mode): the parent wraps the rows in a
		// role="listbox" and drives roving focus, so the option carries aria-selected + roving tabindex
		// and activates on Enter/Space. Otherwise the row is a standalone action button (conflict sheet,
		// multi-commit poles) that opens changes on click.
		if (this.selectable) {
			return html`<div
				slot="anchor"
				part="item"
				class="item"
				role="option"
				aria-selected=${this.selected}
				aria-label=${ifDefined(this.label)}
				tabindex=${this.tabbable ? 0 : -1}
				@click=${this.onClick}
				@keydown=${this.onOptionKeydown}
			>
				${inner}
			</div>`;
		}

		return html`<button
			slot="anchor"
			part="item"
			class="item"
			type="button"
			aria-label=${ifDefined(this.label)}
			@click=${this.onClick}
		>
			${inner}
		</button>`;
	}

	/** Focus the inner anchor so a parent listbox's roving `.focus()` reaches the row, not the host. */
	override focus(options?: FocusOptions): void {
		this._anchor?.focus(options);
	}

	private readonly onOptionKeydown = (e: KeyboardEvent): void => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			this.onClick();
		}
	};

	private onClick = (): void => {
		const commit = this.commit;
		if (commit == null) return;

		// A click should dismiss the hover card, not leave it pinned.
		void this._popover?.hide();
		this.dispatchEvent(
			new CustomEvent<CommitRowItemSelectEventDetail>('gl-commit-row-item-select', {
				detail: { sha: commit.sha },
				bubbles: true,
				composed: true,
			}),
		);
	};
}

declare global {
	interface HTMLElementTagNameMap {
		'gl-commit-row-item': GlCommitRowItem;
	}
}
