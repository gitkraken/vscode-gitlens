import { css } from 'lit';

export const radioStyles = css`
	:host {
		--checkbox-radius: 50%;
		--checkbox-foreground: var(--vscode-radio-inactiveForeground);
		--checkbox-background: var(--vscode-radio-inactiveBackground);
		/* High contrast keeps contrastBorder: the circle is the whole control, and inactiveBorder is a 20-40% tint */
		--checkbox-border: var(--gl-color-border-contrast, var(--vscode-radio-inactiveBorder));
		--checkbox-checked-foreground: var(--vscode-radio-activeForeground);
		--checkbox-checked-background: var(--vscode-radio-activeBackground);
		--checkbox-checked-border: var(--vscode-radio-activeBorder);
		--checkbox-hover-background: var(--vscode-radio-inactiveHoverBackground);
	}

	/* When the label is visually hidden, drop the spacing between the control and the empty slot */
	:host([sr-only-label]) label {
		gap: 0;
	}

	:host([sr-only-label]) .label-text {
		margin-inline-end: 0;
	}
`;
