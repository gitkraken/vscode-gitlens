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
	}

	:host(:not([open])) {
		display: none;
	}

	/* Single row now that the load state folded inline — no column stack, and the vertical padding is
	   pulled in tight so the box hugs the text instead of floating in it. */
	.find {
		--gl-elevation: var(--gl-shadow-popover);
		--gl-elevation-border-color: var(--vscode-widget-border);

		display: flex;
		padding: var(--gl-space-2) var(--gl-space-4);
		color: var(--vscode-quickInput-foreground);
		background-color: var(--vscode-quickInput-background);
		border-radius: var(--gl-radius-sm);
		${elevatedSurface}
	}

	/* Ring the box, not the bare input — the input has no border of its own now. */
	.find:focus-within {
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
		/* Monospace: what you type is a ref name, and it sits beside the elided hit name, which relies
		   on characters being a faithful stand-in for width. */
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-sm);
		line-height: 1.6rem;
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

	/* The ref the graph landed on, separated from the buffer by a hairline. Pre-elided in JS (see
	   elideRefName) rather than by CSS ellipsis, so the identifying TAIL of a long branch name
	   survives instead of being the half that gets eaten. */
	.find__hit {
		flex: none;
		max-width: 24rem;
		padding-left: var(--gl-space-6);
		overflow: hidden;
		font-family: var(--vscode-editor-font-family);
		font-size: var(--gl-font-sm);
		line-height: 1.6rem;
		color: var(--color-foreground--65);
		white-space: nowrap;
		border-left: 1px solid var(--vscode-widget-border);
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
