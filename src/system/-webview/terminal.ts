import type { Terminal, TerminalOptions } from 'vscode';
import { ConfigurationTarget, TerminalLocation, ViewColumn, window } from 'vscode';
import { Container } from '../../container.js';
import { configuration } from './configuration.js';

/** Creates a terminal honoring the `gitlens.openInTerminalLocation` setting. The returned terminal
 *  is never shown — callers keep control of focus by calling `show()` themselves. */
export function openTerminal(options: TerminalOptions): Terminal {
	const terminal = window.createTerminal({
		...options,
		location:
			configuration.get('openInTerminalLocation') === 'editor'
				? { viewColumn: ViewColumn.Active }
				: TerminalLocation.Panel,
	});
	void showTerminalLocationPrompt(Container.instance).catch();
	return terminal;
}

/** One-time notification letting users know terminals can open as editor tabs instead of in the
 *  terminal panel. Dismisses itself regardless of outcome, so it is only ever shown once. */
let showingLocationPrompt = false;

export async function showTerminalLocationPrompt(container: Container): Promise<void> {
	// Rapid invocations would each pass the dismissed-check and stack duplicate notifications.
	if (showingLocationPrompt) return;

	showingLocationPrompt = true;

	try {
		await showTerminalLocationPromptCore(container);
	} finally {
		showingLocationPrompt = false;
	}
}

async function showTerminalLocationPromptCore(container: Container): Promise<void> {
	if (container.onboarding.isDismissed('terminal:locationCallout')) return;

	// The user already chose a location themselves; stand the callout down without nagging.
	if (configuration.get('openInTerminalLocation') !== 'panel') {
		await container.onboarding.dismiss('terminal:locationCallout');
		return;
	}

	try {
		const result = await window.showInformationMessage(
			'Would you like GitLens terminals to open as editor tabs alongside your files?',
			{ title: 'Use Editor Tabs' },
		);

		if (result?.title === 'Use Editor Tabs') {
			await configuration.update('openInTerminalLocation', 'editor', ConfigurationTarget.Global);
		}
	} finally {
		await container.onboarding.dismiss('terminal:locationCallout');
	}
}
