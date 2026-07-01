import { css } from 'lit';

export const detailsHeaderStyles = css`
	:host {
		display: contents;
		color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground));
	}

	.details-header {
		position: sticky;
		top: 0;
		z-index: var(--gl-z-sticky);
		display: flex;
		flex: none;
		flex-direction: column;
	}

	.details-header__row {
		display: flex;
		/* No row gap: the gap-centering math relies on the two spacers alone — a row gap would be
		   inserted around the spacers too, skewing the center and leaving phantom whitespace when a
		   spacer collapses. Separation is provided by the spacers' min-width + each cluster's own gap. */
		gap: 0;
		/* Center so the title text, the (taller, bordered) mode box, Compare, and the right-side
		   action chips share one vertical centerline — flex-start let the box's chips ride low. */
		align-items: center;
		padding: 0.7rem 1.2rem 0.5rem;
		container-name: gl-action-chip-host;
		container-type: inline-size;
	}

	.details-header__content {
		/* Natural width (was flex: 1) so the spacers can claim the free space and gap-center the
		   mode/Compare group between the title and the right-anchored actions. */
		flex: 0 1 auto;
		min-width: 0;

		/* The content box can shrink below its children's intrinsic width (min-width: 0), so clip
		   anything that would otherwise spill out and paint under the actions cluster. */
		overflow: hidden;
	}

	/* Gap-centering scaffold: two of these flank the center group so it sits in the middle of the
	   space between the title and the right anchor. They shrink symmetrically; the min-width keeps a
	   gutter so neighbors never touch once the spacers collapse at narrow widths. */
	.details-header__spacer {
		flex: 1 1 0;
		min-width: var(--gl-space-4);
	}

	/* The gap-centered group: AI mode toggles (in the accent box) + the Compare entry-point. The
	   larger gap sets Compare apart from the segmented mode box (it's a sibling, not a mode). */
	.details-header__center {
		display: flex;
		flex: 0 0 auto;
		gap: var(--gl-space-6);
		align-items: center;
	}

	/* Segmented accent box around the AI mode toggles — marks them as the panel's primary
	   "act on these changes" cluster. Uses --vscode-focusBorder (the theme's focus-blue) rather than
	   --color-highlight: the latter is --vscode-button-background, which many themes set to a DARK
	   navy — fine as a fill behind white text (its has-status use) but near-invisible as a border or
	   icon foreground on the dark panel. focusBorder is guaranteed legible against the background in
	   every theme. */
	.details-header__modes {
		display: flex;
		gap: 0;
		align-items: center;
		padding: 0.1rem var(--gl-space-2);
		background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 40%, transparent);
		border-radius: var(--gl-radius-sm);
	}

	/* Accent-tint the AI mode icons only (scoped to the box; Compare keeps its default icon color).
	   Labels stay foreground. gl-action-chip exposes its code-icon as part="icon". Exclude the
	   running-op (--has-status) state: those chips are filled with --mode-toggle-accent and rely on
	   their inherited --vscode-button-foreground to stay legible — tinting the icon part here would
	   override that inheritance and paint the glyph (incl. the loading/pass status overlay)
	   accent-on-fill, i.e. invisible. */
	.details-header__modes gl-action-chip:not(.mode-toggle--has-status)::part(icon) {
		color: var(--vscode-focusBorder);
	}

	/* Accent-tint the hover background of the AI mode chips only (scoped to inside the box, so the
	   adjacent Compare chip keeps the neutral toolbar hover). Skip --has-status chips — mode.css.ts
	   owns their (filled) hover state. */
	.details-header__modes gl-action-chip:not(.mode-toggle--has-status)::part(base):hover {
		background: color-mix(in srgb, var(--vscode-focusBorder) 25%, transparent);
	}

	.details-header__actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
		align-items: center;
	}

	/* The right-anchored actions cluster (nav+jump group, Refresh …). Making the slot itself the
	   flex container keeps its chips tightly spaced; separation from the centered mode group is
	   handled symmetrically by the flanking spacers, not a margin here — a leading margin would make
	   the right gutter wider than the left and skew the gap-centering. Collapsed out of flow until
	   the slot receives content (has-actions, via slotchange) so it never reserves space on the
	   right — e.g. the comparison panel, which slots no actions. flex-shrink:0 keeps the icon chips
	   from clipping when the row is tight. */
	.details-header__actions-secondary {
		display: none;
	}

	.details-header__actions-secondary.has-actions {
		display: flex;
		flex-shrink: 0;
		gap: var(--gl-space-2);
		align-items: center;
	}

	/* Mode-toggle label collapse, staggered right-to-left in display order: Compare yields
	   first, then Review, then Compose, then Resolve — the (conflict-only) Resolve chip leads
	   the cluster as the primary action, so it keeps its label longest.
	   The chip's slotted label is a normal child of <gl-action-chip> in this template,
	   so we target it via descendant selectors. Hiding the slotted span with display:none
	   cleanly removes the flex item and its surrounding gap inside the chip — yielding
	   a true icon-only state instead of clipped/ellipsed text. The active chip is exempt
	   so the selected mode keeps its label visible. Breakpoints leave room for the title
	   side's WIP stats pill, which takes priority over labels (see
	   gl-details-wip-header.css.ts); secondary actions never hide.
	   The Resolve chip makes the cluster ~one labeled chip wider, so each step fires one
	   band sooner when it's present (the :has()-scoped rules) — keeping the same number of
	   visible labels per band as the 3-chip cascade. */
	@container gl-action-chip-host (max-width: 560px) {
		.details-header__center:has(.mode-toggle--resolve) .mode-toggle--compare .mode-toggle__text {
			display: none;
		}
	}

	@container gl-action-chip-host (max-width: 500px) {
		.mode-toggle--compare .mode-toggle__text,
		.details-header__center:has(.mode-toggle--resolve)
			.mode-toggle--review:not(.mode-toggle--active)
			.mode-toggle__text {
			display: none;
		}
	}

	@container gl-action-chip-host (max-width: 440px) {
		.mode-toggle--review:not(.mode-toggle--active) .mode-toggle__text,
		.details-header__center:has(.mode-toggle--resolve)
			.mode-toggle--compose:not(.mode-toggle--active)
			.mode-toggle__text {
			display: none;
		}
	}

	@container gl-action-chip-host (max-width: 380px) {
		.mode-toggle--compose:not(.mode-toggle--active) .mode-toggle__text,
		.mode-toggle--resolve:not(.mode-toggle--active) .mode-toggle__text {
			display: none;
		}
	}
`;
