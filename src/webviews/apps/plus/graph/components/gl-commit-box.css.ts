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
		flex-direction: column;
		flex: none;
		padding: 0.6rem 1.2rem 0.8rem;
		gap: 0.4rem;
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
		--gl-input-working-border-color: var(--vscode-charts-purple, #7c3aed);
	}

	.options {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.compose-icon {
		color: var(--vscode-charts-purple, #7c3aed);
	}

	.amend-checkbox {
		margin-block: 0;
		font-size: var(--gl-font-base);
		min-width: 0;
		overflow: hidden;
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
		display: block;
		width: calc(100% + 2px);
		height: calc(100% + 2px);
		opacity: 0;
		pointer-events: none;
		overflow: visible;
		transition: opacity 0.35s ease;
		z-index: 2;
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
		stroke: var(--gl-input-working-border-color);
		stroke-dasharray: 18 82;
		stroke-linecap: round;
		filter: drop-shadow(0 0 2px var(--gl-input-working-border-color));
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
		width: 100%;
		box-sizing: border-box;
		min-height: 6rem;
		max-height: 12rem;
		resize: none;
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: var(--gl-input-border-radius);
		color: var(--vscode-input-foreground);
		font-family: inherit;
		font-size: var(--gl-font-base);
		line-height: 1.6;
		padding: 0.6rem 3rem 0.6rem 0.8rem;
		field-sizing: content;
		margin: 0;
		max-width: none;
		scrollbar-gutter: stable;
		transition: padding-right 0.2s ease;
	}

	.message:has(.textarea:not(:placeholder-shown)) .textarea {
		padding-right: 3.8rem;
	}

	.textarea:focus {
		border-color: var(--vscode-focusBorder);
		outline: none;
	}

	.textarea.has-error {
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
	}

	.textarea.has-error:focus {
		border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
	}

	.textarea:disabled {
		opacity: 0.6;
		cursor: default;
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
		align-items: center;
		gap: 0.4rem;
		transition: right 0.2s ease;
		pointer-events: none;
	}

	/* Shift left when a scrollbar is rendered (using scroll-timeline state detection via CSS if available)
	   For now, we use :not(:placeholder-shown) as a heuristic (if there is content, there might be a scrollbar). */
	.message:has(.textarea:not(:placeholder-shown)) .controls {
		right: 1.2rem;
	}

	.char-count {
		position: absolute;
		bottom: 0.4rem;
		right: 0.8rem;
		font-size: var(--gl-font-sm);
		color: var(--vscode-descriptionForeground, var(--color-foreground--65));
		pointer-events: none;
	}

	.message:has(.textarea:not(:placeholder-shown)) .char-count {
		right: 1.6rem;
	}

	.sparkle {
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
