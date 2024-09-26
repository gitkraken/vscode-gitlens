import { css } from 'lit';

export const radioStyles = css`
	:host {
		--checkbox-radius: 50%;
		--checkbox-foreground: var(--vscode-radio-inactiveForeground);
		--checkbox-background: var(--vscode-radio-inactiveBackground);
		--checkbox-border: var(--vscode-radio-inactiveBorder);
		--checkbox-checked-foreground: var(--vscode-radio-activeForeground);
		--checkbox-checked-background: var(--vscode-radio-activeBackground);
		--checkbox-checked-border: var(--vscode-radio-activeBorder);
		--checkbox-hover-background: var(--vscode-radio-inactiveHoverBackground);
	}
`;
