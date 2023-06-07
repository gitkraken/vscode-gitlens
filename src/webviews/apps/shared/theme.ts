/*global window document MutationObserver*/
import { darken, lighten, opacity } from '../../../system/color';
import type { Disposable, Event } from './events';
import { Emitter } from './events';

export interface ThemeChangeEvent {
	colors: {
		background: string;
		foreground: string;
	};
	computedStyle: CSSStyleDeclaration;

	isLightTheme: boolean;
	isHighContrastTheme: boolean;

	isInitializing: boolean;
}

const _onDidChangeTheme = new Emitter<ThemeChangeEvent>();
export const onDidChangeTheme: Event<ThemeChangeEvent> = _onDidChangeTheme.event;

export function computeThemeColors(mutations?: MutationRecord[]): ThemeChangeEvent {
	const body = document.body;
	const computedStyle = window.getComputedStyle(body);

	const isLightTheme =
		body.classList.contains('vscode-light') || body.classList.contains('vscode-high-contrast-light');
	const isHighContrastTheme =
		body.classList.contains('vscode-high-contrast') || body.classList.contains('vscode-high-contrast-light');

	const bodyStyle = body.style;

	const backgroundColor = computedStyle.getPropertyValue('--vscode-editor-background').trim();

	let foregroundColor = computedStyle.getPropertyValue('--vscode-editor-foreground').trim();
	if (!foregroundColor) {
		foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim();
	}

	let color = computedStyle.getPropertyValue('--color-background').trim();
	bodyStyle.setProperty('--color-background--lighten-05', lighten(color, 5));
	bodyStyle.setProperty('--color-background--darken-05', darken(color, 5));
	bodyStyle.setProperty('--color-background--lighten-075', lighten(color, 7.5));
	bodyStyle.setProperty('--color-background--darken-075', darken(color, 7.5));
	bodyStyle.setProperty('--color-background--lighten-10', lighten(color, 10));
	bodyStyle.setProperty('--color-background--darken-10', darken(color, 10));
	bodyStyle.setProperty('--color-background--lighten-15', lighten(color, 15));
	bodyStyle.setProperty('--color-background--darken-15', darken(color, 15));
	bodyStyle.setProperty('--color-background--lighten-30', lighten(color, 30));
	bodyStyle.setProperty('--color-background--darken-30', darken(color, 30));
	bodyStyle.setProperty('--color-background--lighten-50', lighten(color, 50));
	bodyStyle.setProperty('--color-background--darken-50', darken(color, 50));

	color = computedStyle.getPropertyValue('--color-button-background').trim();
	bodyStyle.setProperty('--color-button-background--darken-30', darken(color, 30));

	color = computedStyle.getPropertyValue('--color-highlight').trim();
	bodyStyle.setProperty('--color-highlight--75', opacity(color, 75));
	bodyStyle.setProperty('--color-highlight--50', opacity(color, 50));
	bodyStyle.setProperty('--color-highlight--25', opacity(color, 25));

	color = computedStyle.getPropertyValue('--color-button-secondary-background').trim();
	bodyStyle.setProperty('--color-button-secondary-background--darken-30', darken(color, 30));

	color = computedStyle.getPropertyValue('--color-foreground').trim();
	bodyStyle.setProperty('--color-foreground--85', opacity(color, 85));
	bodyStyle.setProperty('--color-foreground--75', opacity(color, 75));
	bodyStyle.setProperty('--color-foreground--65', opacity(color, 65));
	bodyStyle.setProperty('--color-foreground--50', opacity(color, 50));

	color = computedStyle.getPropertyValue('--color-link-foreground').trim();
	bodyStyle.setProperty('--color-link-foreground--darken-20', darken(color, 20));
	bodyStyle.setProperty('--color-link-foreground--lighten-20', lighten(color, 20));

	color = computedStyle.getPropertyValue('--color-alert-infoBackground').trim();
	bodyStyle.setProperty('--color-alert-infoHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = computedStyle.getPropertyValue('--color-alert-warningBackground').trim();
	bodyStyle.setProperty('--color-alert-warningHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = computedStyle.getPropertyValue('--color-alert-errorBackground').trim();
	bodyStyle.setProperty('--color-alert-errorHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = isLightTheme ? darken(backgroundColor, 5) : lighten(backgroundColor, 5);
	bodyStyle.setProperty('--color-alert-neutralBackground', color);
	bodyStyle.setProperty('--color-alert-neutralHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	return {
		colors: {
			background: backgroundColor,
			foreground: foregroundColor,
		},
		computedStyle: computedStyle,
		isLightTheme: isLightTheme,
		isHighContrastTheme: isHighContrastTheme,
		isInitializing: mutations == null,
	};
}

export function watchThemeColors(): Disposable {
	const observer = new MutationObserver((mutations?: MutationRecord[]) => {
		_onDidChangeTheme.fire(computeThemeColors(mutations));
	});
	observer.observe(document.body, { attributeFilter: ['class'] });
	return { dispose: () => observer.disconnect() };
}
