import { css } from 'lit';
import { elevatedSurface } from '../../../shared/components/styles/lit/elevation.css.js';

export const graphRefFindStyles = css`
	:host {
		/* Pinned to the graph viewport's top-right, VS Code tree-find style. The viewport is
		   position: relative and doesn't scroll (the virtualizer does), so this stays put while rows
		   move underneath it. */
		position: absolute;
		top: var(--gl-space-4);
		right: var(--gl-space-12);
		z-index: var(--gl-z-popover);
		display: block;
		/* Ideal width, capped by what's actually available. Sized rather than content-driven on purpose:
		   the landed ref changes on every keystroke, and a widget that resized to each match would jitter
		   under the cursor while you type. The name elides inside this box instead (see .find__hit). */
		inline-size: 34rem;
		max-inline-size: calc(100% - var(--gl-space-12) * 2);
	}

	:host(:not([open])) {
		display: none;
	}

	/* Two stacked rows: the field (plus close) on top, the landed ref beneath it. Below rather than
	   beside, so a long branch name gets the widget's full width instead of competing with the input for
	   it. The vertical padding stays tight so the box hugs its content. */
	.find {
		--gl-elevation: var(--gl-shadow-popover);
		/* editorWidget, not quickInput: this floats ON the graph the way the editor's and the tree's
		   find widgets float on their content, where quickInput is the palette's higher tier — themes
		   that separate the two would otherwise render this a surface too high. */
		--gl-elevation-border-color: var(--vscode-editorWidget-border, var(--vscode-widget-border));

		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		padding: var(--gl-space-2) var(--gl-space-4);
		color: var(--vscode-editorWidget-foreground);
		background-color: var(--vscode-editorWidget-background);
		border-radius: var(--gl-radius-sm);
		${elevatedSurface}
	}

	/* The field is a real input surface sitting ON the widget, the way the editor find widget's box sits
	   on its own chrome — so the ring belongs to it, not to the whole widget (which also carries the hit
	   name and the close button). */
	.find__field {
		display: flex;
		flex: 1 1 auto;
		gap: var(--gl-space-4);
		align-items: center;
		min-width: 0;
		padding: var(--gl-space-2) var(--gl-space-4);
		color: var(--vscode-input-foreground);
		background-color: var(--vscode-input-background);
		/* Most themes leave input-border unset; those inputs are a bare fill, so transparent keeps the
		   box the same size either way rather than collapsing the padding. */
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: var(--gl-radius-sm);
	}

	.find__field:focus-within {
		outline: 1px solid var(--vscode-focusBorder);
		outline-offset: -1px;
	}

	/* One tight row: glyph, buffer, hit name, close. Everything is vertically centered off this flex
	   line rather than each child's own box, which is what kept the glyph riding high before. */
	.find__row {
		display: flex;
		flex: 1 1 auto;
		gap: var(--gl-space-6);
		align-items: center;
	}

	.find__icon {
		--code-icon-size: 1.3rem;

		flex: none;
		color: var(--color-foreground--65);
	}

	/* Match the glyph's footprint so the row reads as evenly weighted at both ends. */
	.find__close {
		--button-padding: 0.1rem;
		--button-line-height: 1.4rem;

		flex: none;
	}

	/* The buffer is the whole point: it exists so you can SEE and correct what you typed while the
	   graph does the answering. No match count or stepper buttons — that chrome reads as the editor
	   find widget, which is a different interaction. */
	.find__input {
		flex: 1 1 auto;
		width: 15rem;
		min-width: 0;
		padding: 0;
		/* The UI font, like VS Code's own find input and the graph's search box — this is widget chrome, and
		   an editor face here reads as out of place against it. The monospace on .find__hit below is a
		   different matter: its elision is a CHARACTER budget, which only tracks width in a fixed-advance
		   face. Nothing about the two has to agree now that the hit sits on its own line. */
		font-family: inherit;
		font-size: var(--gl-font-base);
		line-height: 1.8rem;
		color: var(--vscode-input-foreground);
		background: none;
		border: none;
	}

	.find__input::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}

	.find__input:focus {
		outline: none;
	}

	/* Nothing matched: tint the text rather than adding a "No results" label, so the widget never
	   grows chrome for a transient state you fix by typing another character. */
	.find__input--empty {
		color: var(--vscode-errorForeground);
	}

	/* The ref the graph landed on, on its own line beneath the field — the field's border separates the
	   two, so this carries no hairline of its own. Indented to the field's text so the name lines up with
	   what you typed rather than with the box edge. Pre-elided in JS (see elideRefName) rather than by CSS
	   ellipsis, so the identifying TAIL of a long branch name survives instead of being the half that gets
	   eaten — the budget is wider here than it was beside the input, which is the point of the move. */
	/* The landed ref and the step hint share the line: the name takes the room and truncates, the hint
	   holds its width at the end. min-width: 0 on the name (and on a tooltip wrapping it) is what lets it
	   shrink instead of shoving the hint out of the box. */
	.find__result {
		display: flex;
		gap: var(--gl-space-6);
		align-items: baseline;
		min-width: 0;
	}

	.find__result > gl-tooltip,
	.find__result > .find__hit {
		flex: 1 1 auto;
		min-width: 0;
	}

	/* gl-tooltip is display: contents by default, which drops its box entirely — the flex sizing above
	   would then apply to nothing and its shadow wrapper (min-width: auto) would become the flex item,
	   so the name could no longer shrink and pushed the step hint out of the widget on a narrow pane.
	   Giving it a real box is what makes the rule above (and .find__hit's ellipsis backstop) reachable. */
	.find__result > gl-tooltip {
		display: flex;
		overflow: hidden;
	}

	/* Text, never buttons — a stepper control here would read as the editor's find widget, which is a
	   different interaction. Dimmer than the name it sits beside: it's an affordance, not an answer. */
	.find__nav {
		flex: none;
		margin-inline-start: auto;
		font-size: var(--gl-font-sm);
		line-height: 1.6rem;
		color: var(--color-foreground--50);
		white-space: nowrap;
	}

	.find__hit {
		display: block;
		padding-inline-start: var(--gl-space-4);
		overflow: hidden;
		/* Backstop only. The JS budget is sized for the widget's ideal width, so on a pane narrow enough to
		   clamp it the name can still overrun — an ellipsis at least says so, where a bare clip looks like
		   the ref is simply named that. */
		text-overflow: ellipsis;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-sm);
		line-height: 1.6rem;
		color: var(--color-foreground--65);
		white-space: nowrap;
	}

	/* Not paged in yet: dimmed, with the fetch glyph. The graph can't move to this ref, so this line is
	   the only thing saying it exists and that Enter will fetch it. */
	.find__hit--unloaded {
		display: inline-flex;
		gap: var(--gl-space-4);
		align-items: center;
		color: var(--color-foreground--50);
	}

	.find__hit-icon {
		--code-icon-size: 1.2rem;

		flex: none;
	}
`;
