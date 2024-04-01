/*global window document MutationObserver*/
import { darken, getCssVariable, lighten } from '../../../system/color';
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
	const root = document.documentElement;
	const computedStyle = window.getComputedStyle(root);

	const classList = document.body.classList;
	const isLightTheme = classList.contains('vscode-light') || classList.contains('vscode-high-contrast-light');
	const isHighContrastTheme =
		classList.contains('vscode-high-contrast') || classList.contains('vscode-high-contrast-light');

	const rootStyle = root.style;

	const backgroundColor = getCssVariable('--vscode-editor-background', computedStyle);

	let foregroundColor = getCssVariable('--vscode-editor-foreground', computedStyle);
	if (!foregroundColor) {
		foregroundColor = getCssVariable('--vscode-foreground', computedStyle);
	}

	let color = getCssVariable('--color-alert-infoBackground', computedStyle);
	rootStyle.setProperty('--color-alert-infoHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = getCssVariable('--color-alert-warningBackground', computedStyle);
	rootStyle.setProperty('--color-alert-warningHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = getCssVariable('--color-alert-errorBackground', computedStyle);
	rootStyle.setProperty('--color-alert-errorHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	color = isLightTheme ? darken(backgroundColor, 5) : lighten(backgroundColor, 5);
	rootStyle.setProperty('--color-alert-neutralBackground', color);
	rootStyle.setProperty('--color-alert-neutralHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

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
