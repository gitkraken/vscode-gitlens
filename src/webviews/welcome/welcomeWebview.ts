import type { Disposable } from 'vscode';
import { env } from 'vscode';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { FeatureFlagKey } from '../../featureFlags/featureFlagService.js';
import { needsCursorMcpCleanupNotice } from '../../plus/gk/utils/-webview/mcp.utils.js';
import { registerCommand } from '../../system/-webview/command.js';
import { getContext } from '../../system/-webview/context.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createSharedServices } from '../rpc/services/common.js';
import { proxyServices } from '../rpc/services/proxy.js';
import { WalkthroughService } from '../rpc/walkthroughService.js';
import { WelcomeService } from '../rpc/welcomeService.js';
import type { WelcomeServices } from '../rpc/welcomeService.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { State, WalkthroughMode } from './protocol.js';
import type { WelcomeWebviewShowingArgs } from './registration.js';

export class WelcomeWebviewProvider implements WebviewProvider<State, State, WelcomeWebviewShowingArgs> {
	private _mode: WalkthroughMode = 'main';
	private _telemetryContext: Record<`context.${string}`, string | number | boolean | undefined> | undefined;

	/** Created with (and cached by) `getRpcServices` so `onShowing` can fire its events. */
	private _welcome: WelcomeService | undefined;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.welcome'>,
	) {}

	dispose(): void {}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<WelcomeWebviewShowingArgs, State>
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
		const modeArg = args[0];
		const mode: WalkthroughMode = modeArg != null && 'mode' in modeArg ? (modeArg.mode ?? 'main') : 'main';
		this._mode = mode;

		if (mode === 'graph') {
			void this.container.usage.track('action:gitlens.graph.walkthrough.started:happened');
		}

		if (!loading && this._welcome != null) {
			// If already loaded, switch the webview's mode and focus the walkthrough
			this._welcome.fireDidSwitchWalkthroughMode(mode);
			this._welcome.fireDidFocusWalkthrough();
		}
		return [true, undefined];
	}

	includeBootstrap(): State {
		// The webview fetches all live data via RPC — bootstrap only provides static metadata
		// (`mode` is per-show, set above before this runs on first load)
		return {
			...this.host.baseWebviewState,
			hostAppName: env.appName,
			welcomeTitle: this.getWelcomeTitleVariant() ?? 'Get Started with GitLens',
			mode: this._mode,
			mcpNeedsInstall: this.getMcpNeedsInstall(),
			mcpShowCleanupNotice: this.getMcpShowCleanupNotice(),
		};
	}

	registerCommands(): Disposable[] {
		if (this.host.is('view')) {
			return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
		}
		return [];
	}

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): WelcomeServices {
		const shared = createSharedServices(this.container, this.host, buffer, tracker, context => {
			this._telemetryContext = context;
		});

		this._welcome ??= new WelcomeService(buffer, tracker);

		return proxyServices({
			...shared,

			walkthrough: new WalkthroughService(this.container, buffer, tracker),

			welcome: this._welcome,
		} satisfies WelcomeServices);
	}

	private getMcpCanAutoRegister(): boolean {
		return this.container.gkMcp?.isRegistrationAllowed ?? false;
	}

	private isCliInstalled(): boolean {
		return getContext('gitlens:gk:cli:installed', false);
	}

	private getMcpNeedsInstall(): boolean {
		return !this.getMcpCanAutoRegister() || !this.isCliInstalled();
	}

	private getMcpShowCleanupNotice(): boolean {
		return needsCursorMcpCleanupNotice(this.container);
	}

	private getWelcomeTitleVariant(): string | undefined {
		const showVariant = this.container.featureFlags.getFlag(FeatureFlagKey.WelcomeTitleVariant, false);
		return showVariant ? 'Welcome' : undefined;
	}
}
