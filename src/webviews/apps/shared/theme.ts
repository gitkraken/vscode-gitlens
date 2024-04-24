/*global window document MutationObserver*/
import { getCssVariable } from '../../../system/color';
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

	const backgroundColor = getCssVariable('--vscode-editor-background', computedStyle);

	let foregroundColor = getCssVariable('--vscode-editor-foreground', computedStyle);
	if (!foregroundColor) {
		foregroundColor = getCssVariable('--vscode-foreground', computedStyle);
	}

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
