'use strict';
/*global window document MutationObserver*/
import { darken, lighten, opacity } from './colors';

export function initializeAndWatchThemeColors() {
	const onColorThemeChanged = () => {
		const body = document.body;
		const computedStyle = window.getComputedStyle(body);

		const bodyStyle = body.style;

		const font = computedStyle.getPropertyValue('--vscode-font-family').trim();
		if (font) {
			bodyStyle.setProperty('--font-family', font);
			bodyStyle.setProperty('--font-size', computedStyle.getPropertyValue('--vscode-font-size').trim());
			bodyStyle.setProperty('--font-weight', computedStyle.getPropertyValue('--vscode-font-weight').trim());
		} else {
			bodyStyle.setProperty(
				'--font-family',
				computedStyle.getPropertyValue('--vscode-editor-font-family').trim()
			);
			bodyStyle.setProperty('--font-size', computedStyle.getPropertyValue('--vscode-editor-font-size').trim());
			bodyStyle.setProperty(
				'--font-weight',
				computedStyle.getPropertyValue('--vscode-editor-font-weight').trim()
			);
		}

		let color = computedStyle.getPropertyValue('--vscode-editor-background').trim();
		bodyStyle.setProperty('--color-background', color);
		bodyStyle.setProperty('--color-background--lighten-05', lighten(color, 5));
		bodyStyle.setProperty('--color-background--darken-05', darken(color, 5));
		bodyStyle.setProperty('--color-background--lighten-075', lighten(color, 7.5));
		bodyStyle.setProperty('--color-background--darken-075', darken(color, 7.5));
		bodyStyle.setProperty('--color-background--lighten-15', lighten(color, 15));
		bodyStyle.setProperty('--color-background--darken-15', darken(color, 15));
		bodyStyle.setProperty('--color-background--lighten-30', lighten(color, 30));
		bodyStyle.setProperty('--color-background--darken-30', darken(color, 30));
		bodyStyle.setProperty('--color-background--lighten-50', lighten(color, 50));
		bodyStyle.setProperty('--color-background--darken-50', darken(color, 50));

		color = computedStyle.getPropertyValue('--vscode-button-background').trim();
		bodyStyle.setProperty('--color-button-background', color);
		bodyStyle.setProperty('--color-button-background--darken-30', darken(color, 30));

		color = computedStyle.getPropertyValue('--vscode-button-foreground').trim();
		bodyStyle.setProperty('--color-button-foreground', color);

		color = computedStyle.getPropertyValue('--vscode-editor-foreground').trim();
		if (!color) {
			color = computedStyle.getPropertyValue('--vscode-foreground').trim();
		}
		bodyStyle.setProperty('--color-foreground', color);
		bodyStyle.setProperty('--color-foreground--85', opacity(color, 85));
		bodyStyle.setProperty('--color-foreground--75', opacity(color, 75));
		bodyStyle.setProperty('--color-foreground--50', opacity(color, 50));

		color = computedStyle.getPropertyValue('--vscode-focusBorder').trim();
		bodyStyle.setProperty('--color-focus-border', color);

		color = computedStyle.getPropertyValue('--vscode-textLink-foreground').trim();
		bodyStyle.setProperty('--color-link-foreground', color);
		bodyStyle.setProperty('--color-link-foreground--darken-20', darken(color, 20));
		bodyStyle.setProperty('--color-link-foreground--lighten-20', lighten(color, 20));
	};

	const observer = new MutationObserver(onColorThemeChanged);
	observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

	onColorThemeChanged();
	return observer;
}
