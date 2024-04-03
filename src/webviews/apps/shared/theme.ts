/*global window document MutationObserver*/
import { Color, darken, getCssVariable, lighten, opacity } from '../../../system/color';
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

	let color = getCssVariable('--color-background', computedStyle);
	rootStyle.setProperty('--color-background--lighten-05', lighten(color, 5));
	rootStyle.setProperty('--color-background--darken-05', darken(color, 5));
	rootStyle.setProperty('--color-background--lighten-075', lighten(color, 7.5));
	rootStyle.setProperty('--color-background--darken-075', darken(color, 7.5));
	rootStyle.setProperty('--color-background--lighten-10', lighten(color, 10));
	rootStyle.setProperty('--color-background--darken-10', darken(color, 10));
	rootStyle.setProperty('--color-background--lighten-15', lighten(color, 15));
	rootStyle.setProperty('--color-background--darken-15', darken(color, 15));
	rootStyle.setProperty('--color-background--lighten-30', lighten(color, 30));
	rootStyle.setProperty('--color-background--darken-30', darken(color, 30));
	rootStyle.setProperty('--color-background--lighten-50', lighten(color, 50));
	rootStyle.setProperty('--color-background--darken-50', darken(color, 50));

	color = getCssVariable('--color-button-background', computedStyle);
	rootStyle.setProperty('--color-button-background--darken-30', darken(color, 30));

	color = getCssVariable('--color-highlight', computedStyle);
	rootStyle.setProperty('--color-highlight--75', opacity(color, 75));
	rootStyle.setProperty('--color-highlight--50', opacity(color, 50));
	rootStyle.setProperty('--color-highlight--25', opacity(color, 25));

	color = getCssVariable('--color-button-secondary-background', computedStyle);
	rootStyle.setProperty('--color-button-secondary-background--darken-30', darken(color, 30));

	color = getCssVariable('--color-foreground', computedStyle);
	rootStyle.setProperty('--color-foreground--85', opacity(color, 85));
	rootStyle.setProperty('--color-foreground--75', opacity(color, 75));
	rootStyle.setProperty('--color-foreground--65', opacity(color, 65));
	rootStyle.setProperty('--color-foreground--50', opacity(color, 50));

	color = getCssVariable('--color-link-foreground', computedStyle);
	rootStyle.setProperty('--color-link-foreground--darken-20', darken(color, 20));
	rootStyle.setProperty('--color-link-foreground--lighten-20', lighten(color, 20));

	color = getCssVariable('--color-alert-infoBackground', computedStyle);
	rootStyle.setProperty('--color-alert-infoHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));

	const backgroundColorObj = Color.from(backgroundColor);
	const foregroundColorObj = Color.from(foregroundColor);

	const backgroundLuminance = backgroundColorObj.getRelativeLuminance();
	const foregroundLuminance = foregroundColorObj.getRelativeLuminance();

	const themeLuminance = (luminance: number) => {
		let min;
		let max;
		if (foregroundLuminance > backgroundLuminance) {
			max = foregroundLuminance;
			min = backgroundLuminance;
		} else {
			min = foregroundLuminance;
			max = backgroundLuminance;
		}
		const percent = luminance / 1;
		return percent * (max - min) + min;
	};

	const primaryColor = Color.fromCssVariable('--vscode-button-background', computedStyle);
	rootStyle.setProperty(
		'--sl-color-primary-50',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.95 : 0.05)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-100',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.9 : 0.1)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-200',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.8 : 0.2)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-300',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.7 : 0.3)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-400',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.6 : 0.4)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-500',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.5 : 0.5)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-600',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.4 : 0.6)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-700',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.3 : 0.7)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-800',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.2 : 0.8)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-900',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.1 : 0.9)).toString(),
	);
	rootStyle.setProperty(
		'--sl-color-primary-950',
		primaryColor.luminance(themeLuminance(isLightTheme ? 0.05 : 0.95)).toString(),
	);

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
