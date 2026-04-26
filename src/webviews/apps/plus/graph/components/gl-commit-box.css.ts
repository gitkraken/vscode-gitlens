import { css } from 'lit';

export const commitBoxStyles = css`
	:host {
		display: flex;
		flex-direction: column;
		flex: none;
		padding: 0.6rem 1.2rem 0.8rem;
		gap: 0.4rem;
		border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
	}

	.options {
		display: flex;
		align-items: center;
		justify-content: space-between;
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
	}

	.textarea {
		width: 100%;
		box-sizing: border-box;
		min-height: 6rem;
		max-height: 12rem;
		resize: none;
		background: var(--vscode-input-background);
		border: 1px solid var(--vscode-input-border);
		border-radius: 0.4rem;
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

	.textarea::placeholder {
		color: var(--vscode-input-placeholderForeground);
	}

	.textarea::-webkit-scrollbar-corner {
		background-color: transparent;
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

	.commit-btn {
		flex: 1;
		min-width: 0;
	}

	.error {
		font-size: var(--gl-font-base);
		color: var(--vscode-editorError-foreground);
	}
`;
