/*global window document MutationObserver*/
import chroma from 'chroma-js';
import { darken, lighten, opacity } from './colors';
import type { Event } from './events';
import { Emitter } from './events';

const _onDidChangeTheme = new Emitter<void>();
export const onDidChangeTheme: Event<void> = _onDidChangeTheme.event;

export function initializeAndWatchThemeColors() {
	const onColorThemeChanged = (mutations?: MutationRecord[]) => {
		const body = document.body;
		const computedStyle = window.getComputedStyle(body);

		const isLightTheme =
			body.classList.contains('vscode-light') || body.classList.contains('vscode-high-contrast-light');
		// const isHighContrastTheme = body.classList.contains('vscode-high-contrast');

		const bodyStyle = body.style;

		bodyStyle.setProperty('--font-family', computedStyle.getPropertyValue('--vscode-font-family').trim());
		bodyStyle.setProperty('--font-size', computedStyle.getPropertyValue('--vscode-font-size').trim());
		bodyStyle.setProperty('--font-weight', computedStyle.getPropertyValue('--vscode-font-weight').trim());

		bodyStyle.setProperty(
			'--editor-font-family',
			computedStyle.getPropertyValue('--vscode-editor-font-family').trim(),
		);
		bodyStyle.setProperty('--editor-font-size', computedStyle.getPropertyValue('--vscode-editor-font-size').trim());
		bodyStyle.setProperty(
			'--editor-font-weight',
			computedStyle.getPropertyValue('--vscode-editor-font-weight').trim(),
		);

		const backgroundColor = computedStyle.getPropertyValue('--vscode-editor-background').trim();
		const backgroundChroma = chroma(backgroundColor);
		const backgroundLuminance = backgroundChroma.luminance();

		let foregroundColor = computedStyle.getPropertyValue('--vscode-editor-foreground').trim();
		if (!foregroundColor) {
			foregroundColor = computedStyle.getPropertyValue('--vscode-foreground').trim();
		}
		const foregroundChroma = chroma(foregroundColor);
		const foregroundLuminance = foregroundChroma.luminance();

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

		let color = backgroundColor;
		bodyStyle.setProperty('--color-background', color);
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

		color = computedStyle.getPropertyValue('--vscode-button-background').trim();
		bodyStyle.setProperty('--color-button-background', color);
		bodyStyle.setProperty('--color-button-background--darken-30', darken(color, 30));
		bodyStyle.setProperty('--color-highlight', color);
		bodyStyle.setProperty('--color-highlight--75', opacity(color, 75));
		bodyStyle.setProperty('--color-highlight--50', opacity(color, 50));
		bodyStyle.setProperty('--color-highlight--25', opacity(color, 25));

		color = computedStyle.getPropertyValue('--vscode-button-secondaryBackground').trim();
		bodyStyle.setProperty('--color-button-secondary-background', color);
		bodyStyle.setProperty('--color-button-secondary-background--darken-30', darken(color, 30));

		color = computedStyle.getPropertyValue('--vscode-button-foreground').trim();
		bodyStyle.setProperty('--color-button-foreground', color);

		bodyStyle.setProperty('--color-foreground', foregroundColor);
		bodyStyle.setProperty('--color-foreground--85', opacity(foregroundColor, 85));
		bodyStyle.setProperty('--color-foreground--75', opacity(foregroundColor, 75));
		bodyStyle.setProperty('--color-foreground--65', opacity(foregroundColor, 65));
		bodyStyle.setProperty('--color-foreground--50', opacity(foregroundColor, 50));

		color = computedStyle.getPropertyValue('--vscode-focusBorder').trim();
		bodyStyle.setProperty('--color-focus-border', color);

		color = computedStyle.getPropertyValue('--vscode-textLink-foreground').trim();
		bodyStyle.setProperty('--color-link-foreground', color);
		bodyStyle.setProperty('--color-link-foreground--darken-20', darken(color, 20));
		bodyStyle.setProperty('--color-link-foreground--lighten-20', lighten(color, 20));

		color = computedStyle.getPropertyValue('--vscode-sideBar-background').trim();
		bodyStyle.setProperty('--color-view-background', color || backgroundColor);

		color = computedStyle.getPropertyValue('--vscode-sideBar-foreground').trim();
		bodyStyle.setProperty('--color-view-foreground', color || foregroundColor);

		bodyStyle.setProperty(
			'--color-view-header-foreground',
			computedStyle.getPropertyValue('--vscode-sideBarSectionHeader-foreground').trim() ||
				color ||
				foregroundColor,
		);

		color = computedStyle.getPropertyValue('--vscode-editorHoverWidget-background').trim();
		bodyStyle.setProperty('--color-hover-background', color);
		color = computedStyle.getPropertyValue('--vscode-editorHoverWidget-border').trim();
		bodyStyle.setProperty('--color-hover-border', color);
		color = computedStyle.getPropertyValue('--vscode-editorHoverWidget-foreground').trim();
		bodyStyle.setProperty('--color-hover-foreground', color);
		color = computedStyle.getPropertyValue('--vscode-editorHoverWidget-statusBarBackground').trim();
		bodyStyle.setProperty('--color-hover-statusBarBackground', color);

		// graph-specific colors
		bodyStyle.setProperty('--graph-theme-opacity-factor', isLightTheme ? '0.5' : '1');

		bodyStyle.setProperty(
			'--color-graph-actionbar-background',
			isLightTheme ? darken(backgroundColor, 5) : lighten(backgroundColor, 5),
		);
		bodyStyle.setProperty(
			'--color-graph-actionbar-selectedBackground',
			isLightTheme ? darken(backgroundColor, 10) : lighten(backgroundColor, 10),
		);

		bodyStyle.setProperty(
			'--color-graph-background',
			isLightTheme ? darken(backgroundColor, 5) : lighten(backgroundColor, 5),
		);
		bodyStyle.setProperty(
			'--color-graph-background2',
			isLightTheme ? darken(backgroundColor, 10) : lighten(backgroundColor, 10),
		);
		color = computedStyle.getPropertyValue('--vscode-list-focusOutline').trim();
		bodyStyle.setProperty('--color-graph-contrast-border', color);
		color = computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground').trim();
		bodyStyle.setProperty('--color-graph-selected-row', color);
		color = computedStyle.getPropertyValue('--vscode-list-hoverBackground').trim();
		bodyStyle.setProperty('--color-graph-hover-row', color);
		color = computedStyle.getPropertyValue('--vscode-list-activeSelectionForeground').trim();
		bodyStyle.setProperty('--color-graph-text-selected-row', color);
		bodyStyle.setProperty('--color-graph-text-dimmed-selected', opacity(color, 50));
		bodyStyle.setProperty('--color-graph-text-dimmed', opacity(foregroundColor, 20));
		color = computedStyle.getPropertyValue('--vscode-list-hoverForeground').trim();
		bodyStyle.setProperty('--color-graph-text-hovered', color);
		bodyStyle.setProperty('--color-graph-text-selected', foregroundColor);
		bodyStyle.setProperty('--color-graph-text-normal', opacity(foregroundColor, 85));
		bodyStyle.setProperty('--color-graph-text-secondary', opacity(foregroundColor, 65));
		bodyStyle.setProperty('--color-graph-text-disabled', opacity(foregroundColor, 50));

		// activity bar
		const resultColor = chroma('#ffff00');
		const headColor = chroma('#00ff00');
		const branchColor = chroma('#ff7f50');
		const tagColor = chroma('#15a0bf');
		color = computedStyle.getPropertyValue('--vscode-progressBar-background').trim();
		const activityColor = chroma(color);
		// bodyStyle.setProperty('--color-graph-activitybar-line0', color);
		bodyStyle.setProperty('--color-graph-activitybar-line0', activityColor.luminance(themeLuminance(0.5)).hex());

		bodyStyle.setProperty(
			'--color-graph-activitybar-focusLine',
			backgroundChroma.luminance(themeLuminance(isLightTheme ? 0.6 : 0.2)).hex(),
		);

		color = computedStyle.getPropertyValue('--vscode-scrollbarSlider-background').trim();
		bodyStyle.setProperty(
			'--color-graph-activitybar-visibleAreaBackground',
			chroma(color)
				.luminance(themeLuminance(isLightTheme ? 0.6 : 0.3))
				.hex(),
		);

		color = computedStyle.getPropertyValue('--vscode-scrollbarSlider-hoverBackground').trim();
		bodyStyle.setProperty(
			'--color-graph-activitybar-visibleAreaHoverBackground',
			chroma(color)
				.luminance(themeLuminance(isLightTheme ? 0.5 : 0.32))
				.hex(),
		);

		color = chroma(computedStyle.getPropertyValue('--vscode-list-activeSelectionBackground').trim())
			.luminance(themeLuminance(isLightTheme ? 0.45 : 0.32))
			.hex();
		// color = computedStyle.getPropertyValue('--vscode-editorCursor-foreground').trim();
		bodyStyle.setProperty('--color-graph-activitybar-selectedMarker', color);
		bodyStyle.setProperty('--color-graph-activitybar-highlightedMarker', opacity(color, 60));

		bodyStyle.setProperty(
			'--color-graph-activitybar-resultMarker',
			resultColor.luminance(themeLuminance(0.6)).hex(),
		);

		const pillLabel = foregroundChroma.luminance(themeLuminance(isLightTheme ? 0 : 1)).hex();
		const headBackground = headColor.luminance(themeLuminance(isLightTheme ? 0.9 : 0.2)).hex();
		const headBorder = headColor.luminance(themeLuminance(isLightTheme ? 0.2 : 0.4)).hex();
		const headMarker = headColor.luminance(themeLuminance(0.5)).hex();

		bodyStyle.setProperty('--color-graph-activitybar-headBackground', headBackground);
		bodyStyle.setProperty('--color-graph-activitybar-headBorder', headBorder);
		bodyStyle.setProperty('--color-graph-activitybar-headForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-activitybar-headMarker', opacity(headMarker, 80));

		bodyStyle.setProperty('--color-graph-activitybar-upstreamBackground', headBackground);
		bodyStyle.setProperty('--color-graph-activitybar-upstreamBorder', headBorder);
		bodyStyle.setProperty('--color-graph-activitybar-upstreamForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-activitybar-upstreamMarker', opacity(headMarker, 60));

		const branchBackground = branchColor.luminance(themeLuminance(isLightTheme ? 0.8 : 0.3)).hex();
		const branchBorder = branchColor.luminance(themeLuminance(isLightTheme ? 0.2 : 0.4)).hex();
		const branchMarker = branchColor.luminance(themeLuminance(0.6)).hex();

		bodyStyle.setProperty('--color-graph-activitybar-branchBackground', branchBackground);
		bodyStyle.setProperty('--color-graph-activitybar-branchBorder', branchBorder);
		bodyStyle.setProperty('--color-graph-activitybar-branchForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-activitybar-branchMarker', opacity(branchMarker, 70));

		bodyStyle.setProperty('--color-graph-activitybar-remoteBackground', opacity(branchBackground, 80));
		bodyStyle.setProperty('--color-graph-activitybar-remoteBorder', opacity(branchBorder, 80));
		bodyStyle.setProperty('--color-graph-activitybar-remoteForeground', pillLabel);
		bodyStyle.setProperty('--color-graph-activitybar-remoteMarker', opacity(branchMarker, 30));

		bodyStyle.setProperty(
			'--color-graph-activitybar-tagBackground',
			tagColor.luminance(themeLuminance(isLightTheme ? 0.8 : 0.2)).hex(),
		);
		bodyStyle.setProperty(
			'--color-graph-activitybar-tagBorder',
			tagColor.luminance(themeLuminance(isLightTheme ? 0.2 : 0.4)).hex(),
		);
		bodyStyle.setProperty('--color-graph-activitybar-tagForeground', pillLabel);
		bodyStyle.setProperty(
			'--color-graph-activitybar-tagMarker',
			opacity(tagColor.luminance(themeLuminance(0.5)).hex(), 60),
		);

		// alert colors
		color = computedStyle.getPropertyValue('--vscode-inputValidation-infoBackground').trim();
		bodyStyle.setProperty('--color-alert-infoHoverBackground', isLightTheme ? darken(color, 5) : lighten(color, 5));
		bodyStyle.setProperty('--color-alert-infoBackground', color);
		color = computedStyle.getPropertyValue('--vscode-inputValidation-warningBackground').trim();
		bodyStyle.setProperty(
			'--color-alert-warningHoverBackground',
			isLightTheme ? darken(color, 5) : lighten(color, 5),
		);
		bodyStyle.setProperty('--color-alert-warningBackground', color);
		color = computedStyle.getPropertyValue('--vscode-inputValidation-errorBackground').trim();
		bodyStyle.setProperty(
			'--color-alert-errorHoverBackground',
			isLightTheme ? darken(color, 5) : lighten(color, 5),
		);
		bodyStyle.setProperty('--color-alert-errorBackground', color);
		color = isLightTheme ? darken(backgroundColor, 5) : lighten(backgroundColor, 5);
		bodyStyle.setProperty(
			'--color-alert-neutralHoverBackground',
			isLightTheme ? darken(color, 5) : lighten(color, 5),
		);
		bodyStyle.setProperty('--color-alert-neutralBackground', color);
		bodyStyle.setProperty('--color-alert-infoBorder', 'var(--vscode-inputValidation-infoBorder)');
		bodyStyle.setProperty('--color-alert-warningBorder', 'var(--vscode-inputValidation-warningBorder)');
		bodyStyle.setProperty('--color-alert-errorBorder', 'var(--vscode-inputValidation-errorBorder)');
		bodyStyle.setProperty('--color-alert-neutralBorder', 'var(--vscode-input-foreground)');
		bodyStyle.setProperty('--color-alert-foreground', 'var(--vscode-input-foreground)');

		if (mutations != null) {
			_onDidChangeTheme.fire();
		}
	};

	onColorThemeChanged();

	const observer = new MutationObserver(onColorThemeChanged);
	observer.observe(document.body, { attributeFilter: ['class'] });
	return observer;
}
