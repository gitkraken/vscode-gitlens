import type { QuickPickItem } from 'vscode';
import { l10n, window } from 'vscode';
import type { Container } from '../../container.js';
import { registerCommand } from '../../system/-webview/command.js';
import { setContext } from '../../system/-webview/context.js';

type ArmPickItem = QuickPickItem & { enabled: boolean | undefined };

/** Registers the debug-only welcome-in-editor simulator command. Flips the
 *  `gitlens:welcome:inEditor` context through GitLens' own wrapper — the same path the first-run
 *  latch uses — so the sidebar view's visibility and the `gitlens.showWelcomeView` reroute both
 *  follow. Never persists an arm or re-stamps telemetry; ending the simulation restores whatever
 *  arm was actually latched. */
export function registerWelcomeInEditorDebug(container: Container): void {
	container.context.subscriptions.push(
		// The optional payload drives the simulation programmatically (e.g. E2E tests), mirroring
		// `gitlens.plus.simulate.subscription`; a payload without `enabled` ends the simulation,
		// no payload shows the picker
		registerCommand('gitlens.welcome.simulate.inEditor', async (args?: { enabled?: boolean }) => {
			let enabled: boolean | undefined;
			if (args != null) {
				enabled = typeof args.enabled === 'boolean' ? args.enabled : undefined;
			} else {
				const pick = await window.showQuickPick<ArmPickItem>(
					[
						{
							label: l10n.t('Editor Arm'),
							description: l10n.t('Sidebar Welcome hidden; Welcome opens as an editor tab'),
							enabled: true,
						},
						{
							label: l10n.t('Control Arm'),
							description: l10n.t('Welcome shows as a sidebar view (current default)'),
							enabled: false,
						},
						{ label: l10n.t('End Simulation'), enabled: undefined },
					],
					{ placeHolder: l10n.t('Simulate the welcome-in-editor experiment arm') },
				);
				if (pick == null) return false;

				enabled = pick.enabled;
			}

			// Ending the simulation falls back to the latched arm (absent = control)
			enabled ??= container.storage.get('welcome:inEditorShown') === true;
			await setContext('gitlens:welcome:inEditor', enabled);
			return true;
		}),
	);
}
