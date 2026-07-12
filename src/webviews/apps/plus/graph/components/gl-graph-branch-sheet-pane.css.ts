import { css } from 'lit';
import { focusOutline } from '../../../shared/components/styles/lit/a11y.css.js';

export const graphBranchSheetPaneStyles = css`
	:host {
		display: block;
	}

	/* Metadata strip — mirrors gl-details-wip-header's branch/issues rows and the shared
	   --gl-metadata-bar-* treatment so the sheet chrome reads as the same piece. */
	.metadata {
		background-color: var(--gl-metadata-bar-bg);
		border-bottom: var(--gl-border-width) solid var(--gl-metadata-bar-border);
	}

	/* The single strip row — issues (chips + associate) left, actions (PR chip + worktree ops)
	   right-anchored in .branch-ops. Identity chrome lives in the sheet header. */
	.strip-row {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		min-height: var(--gl-metadata-bar-min-height, 3.2rem);
		padding: 0.2rem var(--gl-space-12);
		font-size: var(--gl-font-sm);
		--gl-chip-overflow-gap: 0.4rem;
		--commit-stats-pill-line-height: 2rem;
		--gl-pill-line-height: 2rem;
		--gl-pill-min-height: 2rem;
		--gl-pill-padding: 0 0.6rem;
		--gl-pill-font-size: 1.1rem;
		--gl-pill-border-radius: var(--gl-radius-sm);
	}

	.branch-ops {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-6);
		align-items: center;
		min-height: 2.4rem;
		margin-left: auto;
	}

	.pull-request {
		flex: 0 1 auto;
		min-width: 0;
	}

	/* Reserved footprint mirrored from the WIP header so a landing PR chip doesn't pop the row. */
	.pull-request--loading {
		display: inline-flex;
		min-width: 3.9rem;
		min-height: 2.4rem;
	}

	.issues-chips {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* Tag tip-commit line — inline in the tag strip's single row, same tinted treatment the
	   issues row uses. */
	.tip-line {
		display: inline-flex;
		flex: 1 1 auto;
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--65);
	}

	.tip-line__sha {
		flex: none;
		font-family: var(--vscode-editor-font-family, monospace);
	}

	.tip-line__message {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.associate-issue {
		flex-shrink: 0;
		color: var(--color-foreground--65);
	}

	/* Hub — mirrors gl-details-wip-empty-pane's section/next-step layout. */
	.hub {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-16);
		padding: var(--gl-space-10) var(--gl-space-12) var(--gl-space-16);
	}

	.section {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-6);
	}

	.section__heading {
		margin: 0;
		font-size: var(--gl-font-sm);
		font-weight: 500;
		color: var(--color-foreground--65);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.next-step {
		display: flex;
		gap: var(--gl-space-8);
		align-items: center;
		padding: var(--gl-space-4) var(--gl-space-6);
		border-radius: var(--gl-radius-sm);
	}

	.next-step:hover {
		background: var(--vscode-list-hoverBackground);
	}

	.next-step__icon {
		flex-shrink: 0;
		color: var(--color-foreground--65);
	}

	.next-step__label {
		flex: 1;
		min-width: 0;
	}

	.next-step__action {
		flex-shrink: 0;
	}

	/* Relationship cards — Upstream and Merge Target get identical card treatment, side by side once
	   each has room, stacked below that. Sits between the strip and the Next-steps section. */
	.relationship-cards {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
		gap: 0.8rem;
	}

	.relationship-card {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.8rem 1rem;
		background: var(--gl-metadata-bar-bg);
		border: var(--gl-border-width) solid var(--gl-metadata-bar-border);
		border-radius: var(--gl-radius-sm);
	}

	.relationship-card__head {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		min-width: 0;
	}

	/* "Merges into ‹target›" — the merge-target card's directional predicate (the sheet header
	   names the subject branch directly above). */
	.relationship-card__connector {
		flex-shrink: 0;
		color: var(--color-foreground--50);
	}

	/* Edit token — the counterpart name IS the edit affordance (dashed underline + trailing icon
	   that fades in on hover/focus), shared by the Upstream card's bare name and the Merge Target
	   card's sentence target. */
	.relationship-card__token {
		display: inline-flex;
		flex: 0 1 auto;
		gap: var(--gl-space-2);
		align-items: center;
		min-width: 0;
		max-width: 100%;
		padding: 0;
		color: inherit;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
		background: none;
		border: none;
		border-bottom: 0.1rem dashed var(--color-foreground--50);
		--relationship-card-token-icon-opacity: 0.6;
	}

	.relationship-card__token:hover,
	.relationship-card__token:focus-visible {
		border-bottom-color: var(--color-foreground);
		--relationship-card-token-icon-opacity: 1;
	}

	.relationship-card__token:focus-visible {
		${focusOutline}
	}

	.relationship-card__token--muted {
		font-weight: normal;
		color: var(--color-foreground--65);
	}

	.relationship-card__token-text {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Icon fade rides an inherited custom property flipped on the anchor — the equivalent
	   descendant selector was observed not applying to the code-icon host live. */
	.relationship-card__token-icon {
		flex-shrink: 0;
		opacity: var(--relationship-card-token-icon-opacity);
		transition: opacity var(--gl-duration-x-fast) var(--gl-ease-in-out);
	}

	.relationship-card__pill {
		flex-shrink: 0;
	}

	/* Leading kind marker — a dim icon (globe = upstream, gl-merge-target = merge target) in place
	   of the louder uppercase badges; its tooltip carries the words. The gl-tooltip wrapper is
	   display: contents, so the icon itself is the flex item. */
	.relationship-card__kind-icon {
		flex: none;
		color: var(--color-foreground--50);
	}

	.relationship-card__kind-icon--warn {
		color: var(
			--vscode-gitlens-decorations\.statusMergingOrRebasingConflictForegroundColor,
			var(--color-foreground--50)
		);
	}

	/* Foot — status sentence + that relationship's actions on the same row, wrapping when narrow. */
	.relationship-card__foot {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem 1rem;
		align-items: center;
	}

	.relationship-card__status {
		flex: 1 1 auto;
		min-width: 0;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--65);
	}

	.relationship-card__actions {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-6);
		align-items: center;
		margin-left: auto;
	}

	/* Fetch trails the state action, dimmed until hovered/focused so it doesn't compete with it. */
	.relationship-card__fetch {
		opacity: 0.7;
		transition: opacity var(--gl-duration-x-fast) var(--gl-ease-in-out);
	}

	.relationship-card__fetch:hover,
	.relationship-card__fetch:focus-within {
		opacity: 1;
	}

	.relationship-card__shimmer-line {
		height: 1.2rem;
		background: var(--color-foreground);
		border-radius: var(--gl-radius-sm);
		opacity: 0.15;
		animation: relationship-card-pulse 1.5s var(--gl-ease-in-out) infinite;
	}

	.relationship-card__shimmer-line--head {
		width: 40%;
	}

	.relationship-card__shimmer-line--status {
		width: 70%;
		height: 1rem;
	}

	@keyframes relationship-card-pulse {
		0%,
		100% {
			opacity: 0.15;
		}

		50% {
			opacity: 0.25;
		}
	}

	/* Identity-only fallback for tag/remote refs (P1) until they get their own tailoring. */
	.identity {
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-8);
		padding: var(--gl-space-12);
	}

	.identity__name {
		display: flex;
		gap: var(--gl-space-6);
		align-items: center;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.identity__tip {
		display: flex;
		gap: var(--gl-space-4);
		align-items: center;
		color: var(--color-foreground--65);
		font-size: var(--gl-font-sm);
	}
`;
