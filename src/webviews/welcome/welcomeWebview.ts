import { Disposable, env } from 'vscode';
import { SubscriptionState } from '../../constants.subscription.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { Container } from '../../container.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { mcpExtensionRegistrationAllowed } from '../../plus/gk/utils/-webview/mcp.utils.js';
import { registerCommand } from '../../system/-webview/command.js';
import { getContext } from '../../system/-webview/context.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { State, WalkthroughProgress } from './protocol.js';
import { DidChangeSubscription, DidChangeWalkthroughProgress, DidFocusWalkthrough } from './protocol.js';
import type { WelcomeWebviewShowingArgs } from './registration.js';

export class WelcomeWebviewProvider implements WebviewProvider<State, State, WelcomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _etagSubscription?: number;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.welcome'>,
	) {
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.walkthrough.onDidChangeProgress(this.onWalkthroughProgressChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		..._args: WebviewShowingArgs<WelcomeWebviewShowingArgs, State>
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
		// If not loading (already loaded), notify the webview to reset and focus the walkthrough
		if (!loading) {
			void this.host.notify(DidFocusWalkthrough, undefined);
		}
		return [true, undefined];
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	registerCommands(): Disposable[] {
		if (this.host.is('view')) {
			return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
		}
		return [];
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent): void {
		if (e.etag === this._etagSubscription) return;

		this._etagSubscription = e.etag;
		this.notifyDidChangeSubscription(e.current.state);
	}

	private notifyDidChangeSubscription(plusState: SubscriptionState): void {
		void this.host.notify(DidChangeSubscription, { plusState: plusState });
	}

	private onWalkthroughProgressChanged(): void {
		const walkthroughProgress = this.getWalkthroughProgress();
		if (walkthroughProgress == null) return;

		void this.host.notify(DidChangeWalkthroughProgress, { walkthroughProgress: walkthroughProgress });
	}

	private getWalkthroughProgress(): WalkthroughProgress | undefined {
		const walkthroughState = this.container.walkthrough.getState();
		const state: Record<string, boolean> = Object.fromEntries(walkthroughState);

		return {
			allCount: this.container.walkthrough.walkthroughSize,
			doneCount: this.container.walkthrough.doneCount,
			progress: this.container.walkthrough.progress,
			state: state as Record<WalkthroughContextKeys, boolean>,
		};
	}

	private getMcpCanAutoRegister(): boolean {
		return mcpExtensionRegistrationAllowed(this.container);
	}

	private isCliInstalled(): boolean {
		return getContext('gitlens:gk:cli:installed', false);
	}

	private getMcpNeedsInstall(): boolean {
		return !this.getMcpCanAutoRegister() || !this.isCliInstalled();
	}

	private async getState(): Promise<State> {
		const subscription = await this.container.subscription.getSubscription();
		const plusState = subscription?.state ?? SubscriptionState.Community;

		return {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			hostAppName: env.appName,
			plusState: plusState,
			walkthroughProgress: this.getWalkthroughProgress(),
			mcpNeedsInstall: this.getMcpNeedsInstall(),
		};
	}
}
