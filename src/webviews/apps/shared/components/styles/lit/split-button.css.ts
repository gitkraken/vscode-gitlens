import { css } from 'lit';

/**
 * Shared "split button" styles: `<span class="split-btn">` wrapping a main `gl-button` and a
 * chevron `gl-button.split-btn__menu` (nested inside `gl-menu-popover`, and sometimes also
 * `gl-popover-confirm`). One control, two hit targets: outside radii live on the container's
 * ends, the seam is a hairline of the button's own foreground so it tracks any theme. Host-level
 * radius/border overrides work because author styles on the host element beat shadow :host rules.
 *
 * The seam color is parameterized via `--gl-split-btn-seam` because some consumers pair two
 * `appearance="secondary"` buttons (seam should derive from `--vscode-button-secondaryForeground`)
 * while others pair primary buttons (seam derives from `--vscode-button-foreground`, the default
 * here).
 */
export const splitButtonStyles = css`
	.split-btn {
		display: inline-flex;
		flex: none;
		align-items: stretch;
	}

	/* The popover wrappers sit between the container and the menu half — stretch through them so
	   both halves share one height. */
	.split-btn gl-menu-popover,
	.split-btn gl-popover-confirm {
		display: inline-flex;
		align-items: stretch;
	}

	/* Each half is an inline-block gl-button sitting on a line box inside gl-popover's anchor <div>,
	   so its baseline alignment leaves a descender gap beneath it. The wrappers stretch to the tallest
	   half INCLUDING that gap, and the menu half's height:100% then fills it — a chevron taller than
	   the main button by a few px. Top-aligning both halves drops the gap so the wrappers' height is
	   exactly the buttons'. */
	.split-btn__main,
	.split-btn__menu {
		vertical-align: top;
	}

	.split-btn__main {
		border-start-end-radius: 0;
		border-end-end-radius: 0;
	}

	.split-btn__menu {
		/* gl-popover wraps its anchor slot in a plain <div slot="anchor"> inside its shadow DOM,
		   which breaks the align-items:stretch chain, so height:100% alone can leave the icon-only
		   chevron ~1px shorter than the text button. min-height mirrors gl-button's own text-button
		   metrics (line-height * 1em + 2x padding + 2x border) so the chevron matches even when the
		   stretch chain is broken; height:100% is kept too since it helps when stretch does work. */
		height: 100%;
		min-height: calc(
			var(--button-line-height, 1.35) * 1em + 2 * var(--button-padding, 0.4rem) + 2 * var(--gl-border-width)
		);
		border-left: var(--gl-border-width) solid
			var(--gl-split-btn-seam, color-mix(in srgb, transparent 72%, var(--vscode-button-foreground)));
		border-start-start-radius: 0;
		border-end-start-radius: 0;
		--button-padding-inline: 0.5rem;
	}
`;
