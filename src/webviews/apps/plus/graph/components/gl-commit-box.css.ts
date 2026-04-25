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
		scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
		margin: 0;
		max-width: none;
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

	/* Character count sits flush below the AI sparkle button so the two badges share the
	   same right edge, reading as a vertical pairing. Brighter than disabled-foreground so
	   the count is legible at a glance — falls back to the warning/error tints once the
	   subject line nears the recommended length. */
	.char-count {
		position: absolute;
		top: 2.8rem;
		right: 0.4rem;
		min-width: 2.4rem;
		text-align: center;
		font-size: var(--gl-font-sm);
		color: var(--color-foreground--85);
		pointer-events: none;
	}

	.char-count--warn {
		color: var(--vscode-editorWarning-foreground);
	}

	.char-count--over {
		color: var(--vscode-editorError-foreground);
	}

	.sparkle {
		position: absolute;
		top: 0.4rem;
		right: 0.4rem;
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
