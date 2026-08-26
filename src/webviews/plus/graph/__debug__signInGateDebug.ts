import type { QuickPickItem } from 'vscode';
import { window } from 'vscode';
import { wait } from '@gitlens/utils/promise.js';
import type { Container } from '../../../container.js';
import { registerCommand } from '../../../system/-webview/command.js';
import { loadChunk } from '../../../system/-webview/loadChunk.js';
import type { WebviewPanelsProxy } from '../../webviewsController.js';
import type { GraphWebviewShowingArgs } from './registration.js';

type Variant = 'default' | 'intro-video';
type VariantPickItem = QuickPickItem & { variant: Variant | undefined };

/** Stamped after each awaited rebuild, so a back-to-back dispatch can wait out the controller's
 *  refresh coalesce window instead of being silently dropped */
let lastRefreshCompletedAt = 0;

/** Registers the debug-only sign-in gate simulator command. Unlike the real flag — whose value is
 *  latched on the first gated render and applies only after a window reload — picking a variant
 *  here refreshes every graph surface immediately while signed out, the only state the gate
 *  renders in. */
export function registerSignInGateDebug<T>(
	container: Container,
	panels: WebviewPanelsProxy<'gitlens.graph', GraphWebviewShowingArgs, T>,
): void {
	container.context.subscriptions.push(
		// The optional payload drives the simulation programmatically (e.g. automated live
		// exercises), mirroring `gitlens.plus.simulate.subscription`; a payload without `variant`
		// ends the simulation, no payload shows the picker
		registerCommand(
			'gitlens.graph.simulate.signInGateVariant',
			async (args?: { variant?: string }) => {
				let variant: Variant | undefined;
				if (args != null) {
					// Validate the wire payload — a near-miss literal (e.g. 'introVideo') or a positional
					// string (instead of `{ variant }`) would otherwise silently render the wrong arm, or
					// end the simulation, while the command reports success
					const value = typeof args === 'object' ? args.variant : String(args);
					if (value === 'default' || value === 'intro-video') {
						variant = value;
					} else if (value != null) {
						void window.showErrorMessage(`Unknown sign-in gate variant "${value}"`);
						return false;
					}
				} else {
					const pick = await window.showQuickPick<VariantPickItem>(
						[
							{ label: 'Default Gate', description: 'Pro strip + Learn More', variant: 'default' },
							{ label: 'Intro Video Gate', description: 'Video thumbnail', variant: 'intro-video' },
							{
								label: 'End Simulation',
								description: 'Re-resolves the real flag on the next gate render',
								variant: undefined,
							},
						],
						{ title: 'Simulate Sign-in Gate Variant', placeHolder: 'Choose the gate variant to render' },
					);
					if (pick == null) return;

					variant = pick.variant;
				}

				const { setSignInGateVariantOverride } = await loadChunk(
					() => import(/* webpackChunkName: "webview-graph" */ './graphWebview.js'),
				);
				setSignInGateVariantOverride(variant);

				// The gate renders only while signed out — skip tearing down (and rebuilding) every open
				// graph when it can't be observed; the latch still applies to the next gated render
				const subscription = await container.subscription.getSubscription();
				if (subscription.account == null) {
					// Wait out the controller's refresh coalesce window (`refreshCoalesceMs`, ~1s after the
					// previous rebuild) — a back-to-back dispatch would otherwise be dropped silently while
					// the command still reports success
					const sinceLast = Date.now() - lastRefreshCompletedAt;
					if (sinceLast < 1100) {
						await wait(1100 - sinceLast);
					}

					const refreshes = [container.views.graph.refresh(true)];
					for (const instance of panels.instances) {
						refreshes.push(instance.refresh(true));
					}

					// Awaited so the html swap has landed on every gated surface before reporting success —
					// the reloaded page still boots after this, so a caller must await the DOM (not this
					// command) to observe the new arm rendered
					await Promise.all(refreshes);
					lastRefreshCompletedAt = Date.now();
				}

				void window.showInformationMessage(
					variant == null
						? 'Sign-in gate simulation ended — the next gate render resolves the real flag'
						: `Sign-in gate simulating "${variant}" — the gate renders only while signed out`,
				);

				return true;
			},
			undefined,
			{ returnResult: true },
		),
	);
}
