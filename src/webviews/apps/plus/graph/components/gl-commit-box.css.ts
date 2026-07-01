import { css } from 'lit';

export const commitBoxStyles = css`
	@property --gl-textarea-thumb-color {
		syntax: '<color>';
		inherits: true;
		initial-value: transparent;
	}

	@keyframes gl-input-ring-trace {
		to {
			stroke-dashoffset: -100;
		}
	}

	:host {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--gl-space-4);
		padding: var(--gl-space-6) var(--gl-space-12) var(--gl-space-8);
		border-top: var(--gl-border-width) solid var(--vscode-sideBarSectionHeader-border);
		--gl-input-working-border-color: var(--gl-agent-working-color);
	}

	.options {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.options-group {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}

	.signing-indicator {
		display: inline-flex;
		color: var(--vscode-descriptionForeground);
	}

	.signing-indicator:focus-visible {
		outline: 0.1rem solid var(--vscode-focusBorder);
		outline-offset: 0.2rem;
	}

	.compose-icon {
		color: var(--gl-agent-working-color);
	}

	.amend-checkbox {
		min-width: 0;
		margin-block: 0;
		overflow: hidden;
		font-size: var(--gl-font-base);
	}

	.amend-checkbox::part(label) {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Shift the content when the scrollbar appears, without JS observer.
	   We use a pseudo-element trick or has() pseudo-class to detect scrollbar but unfortunately
	   there's no pure CSS way to detect a scrollbar reliably cross-browser.
	   However, we can just give enough padding to the textarea so the scrollbar doesn't overlap text,
	   and keep the buttons fixed. */
	.message {
		position: relative;
		display: flex;
		flex-direction: column;
		--gl-textarea-thumb-color: transparent;

		transition: --gl-textarea-thumb-color 1s linear;
	}

	:host(:hover) .message,
	:host(:focus-within) .message {
		--gl-textarea-thumb-color: var(--vscode-scrollbarSlider-background);

		transition: none;
	}

	/* Animated "AI working" border ring — SVG <rect> with stroke-dasharray + pathLength
	   gives uniform-speed perimeter motion regardless of the input's aspect ratio
	   (a conic-gradient on a wide rect visibly compresses on long edges). */
	.working-ring {
		position: absolute;
		inset: -1px;
		z-index: 2;
		display: block;
		width: calc(100% + 2px);
		height: calc(100% + 2px);
		overflow: visible;
		pointer-events: none;
		opacity: 0;
		transition: opacity 0.35s ease;
	}

	:host([generating]) .working-ring {
		opacity: 1;
	}

	.working-ring rect {
		x: 1px;
		y: 1px;
		width: calc(100% - 2px);
		height: calc(100% - 2px);
		rx: 0.5rem;
		ry: 0.5rem;
		fill: none;
		stroke-width: 1.5;
	}

	.working-ring-base {
		stroke: color-mix(in srgb, var(--gl-input-working-border-color) 14%, transparent);
	}

	.working-ring-highlight {
		filter: drop-shadow(0 0 2px var(--gl-input-working-border-color));
		stroke: var(--gl-input-working-border-color);
		stroke-linecap: round;
		stroke-dasharray: 18 82;
	}

	:host([generating]) .working-ring-highlight {
		animation: gl-input-ring-trace 2s linear infinite;
	}

	@media (prefers-reduced-motion: reduce) {
		:host([generating]) .working-ring-highlight {
			animation: none;
		}
	}

	.textarea {
		box-sizing: border-box;
		width: 100%;
		max-width: none;
		min-height: 6rem;
		max-height: 12rem;
		padding: 0.6rem 3rem 0.6rem 0.8rem;
		margin: 0;
		scrollbar-gutter: stable;
		font-family: inherit;
		font-size: var(--gl-font-base);
		line-height: 1.6;
		color: var(--vscode-input-foreground);
		resize: none;
		background: var(--vscode-input-background);
		border: var(--gl-border-width) solid var(--vscode-input-border, transparent);
		border-radius: var(--gl-input-border-radius);
		transition: padding-right var(--gl-duration-medium) ease;
		field-sizing: content;
	}

	.message:has(.textarea:not(:placeholder-shown)) .textarea {
		padding-right: 3.8rem;
	}

	.textarea:focus {
		outline: none;
		border-color: var(--vscode-focusBorder);
	}

	.textarea.has-error {
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
	}

	.textarea.has-error:focus {
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
	}

	.textarea:disabled {
		cursor: default;
		opacity: 0.6;
	}

	.textarea::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}

	.textarea::-webkit-scrollbar-corner {
		background-color: transparent;
	}

	/* Override the shared scrollableBase mixin's border-color: inherit so the thumb's
	   color comes from the animatable custom property on .message instead of the textarea's
	   own (always-visible) input border. */
	.textarea::-webkit-scrollbar-thumb {
		border-color: var(--gl-textarea-thumb-color);
	}

	.controls {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
		display: flex;
		flex-direction: column;
		gap: var(--gl-space-2);
		align-items: center;
		pointer-events: none;
		transition: right var(--gl-duration-medium) ease;
	}

	/* Mirror of the top controls, pinned to the bottom corner. Row layout so the char-count
	   tucks to the left of the co-author button, which stays pinned to the corner. */
	.controls-bottom {
		top: auto;
		bottom: 0.4rem;
		flex-direction: row;
		gap: var(--gl-space-4);
	}

	/* Shift left when a scrollbar is rendered (using scroll-timeline state detection via CSS if available)
	   For now, we use :not(:placeholder-shown) as a heuristic (if there is content, there might be a scrollbar).
	   Targets both the top and bottom controls (both carry the .controls class). */
	.message:has(.textarea:not(:placeholder-shown)) .controls {
		right: 1.2rem;
	}

	.char-count {
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground, var(--color-foreground--65));
		pointer-events: none;
	}

	.sparkle,
	.add-coauthors {
		pointer-events: auto;
	}

	.commit-btn-wrapper {
		display: block;
	}

	.commit-btn {
		flex: 1;
		min-width: 0;
	}

	.commit-btn[variant='warning'] {
		--button-background: var(--vscode-inputValidation-warningBorder, #b89500);
		--button-foreground: #000;
		--button-hover-background: color-mix(in srgb, #fff 10%, var(--vscode-inputValidation-warningBorder, #b89500));
	}
`;
