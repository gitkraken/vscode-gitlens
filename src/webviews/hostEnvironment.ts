import type { ConfigurationChangeEvent } from 'vscode';
import { configuration } from '../system/-webview/configuration.js';

/**
 * The host workbench state webviews mirror onto `<body>`, since VS Code only applies its Modern UI
 * classes (`.modern-ui`, `.modern-ui-compact`, `.modern-ui-uppercase-view-headers`) to its own
 * workbench container and gives webviews no signal. A complete snapshot, so it is safe to ride a
 * save-last buffered event.
 */
export interface WebviewHostEnvironment {
	/** `workbench.experimental.modernUI` is on — `data-modern-ui` */
	readonly modernUI: boolean;
	/** Modern UI is on and `window.density.layout` is `compact` — `data-modern-ui-compact` */
	readonly compact: boolean;
	/** Modern UI is on and `workbench.experimental.modernUIUppercaseViewHeaders` is on — `data-modern-ui-uppercase-view-headers` */
	readonly uppercaseViewHeaders: boolean;
}

/**
 * Reads the effective host environment, mirroring VS Code's `ModernUIContribution`: compact and
 * uppercase headers only apply while Modern UI is on. Anything other than a strict `true` /
 * `'compact'` (including the `undefined` older VS Code builds return) counts as off.
 */
export function getWebviewHostEnvironment(): WebviewHostEnvironment {
	const modernUI = configuration.getCore('workbench.experimental.modernUI') === true;
	return {
		modernUI: modernUI,
		compact: modernUI && configuration.getCore('window.density.layout') === 'compact',
		uppercaseViewHeaders:
			modernUI && configuration.getCore('workbench.experimental.modernUIUppercaseViewHeaders') === true,
	};
}

/** Whether a configuration change affects any setting {@link getWebviewHostEnvironment} reads. */
export function hostEnvironmentChanged(e: ConfigurationChangeEvent): boolean {
	return configuration.changedCore(e, [
		'workbench.experimental.modernUI',
		'window.density.layout',
		'workbench.experimental.modernUIUppercaseViewHeaders',
	]);
}

/**
 * Renders the host environment as the `<body>` presence attributes for first paint, space
 * separated (e.g. `data-modern-ui data-modern-ui-compact`), or an empty string when all are off.
 * The webview keeps them live via `RpcController`'s `onHostEnvironmentChanged` subscription.
 */
export function getWebviewHostEnvironmentAttributes(env: WebviewHostEnvironment): string {
	const attrs: string[] = [];
	if (env.modernUI) {
		attrs.push('data-modern-ui');
	}
	if (env.compact) {
		attrs.push('data-modern-ui-compact');
	}
	if (env.uppercaseViewHeaders) {
		attrs.push('data-modern-ui-uppercase-view-headers');
	}
	return attrs.join(' ');
}
