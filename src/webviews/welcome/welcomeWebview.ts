import { Disposable, env } from 'vscode';
import { SubscriptionState } from '../../constants.subscription.js';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { registerCommand } from '../../system/-webview/command.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { State } from './protocol.js';
import { DidChangeSubscription } from './protocol.js';
import type { WelcomeWebviewShowingArgs } from './registration.js';

export class WelcomeWebviewProvider implements WebviewProvider<State, State, WelcomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _etagSubscription?: number;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.welcome'>,
	) {
		this._disposable = Disposable.from(this.container.subscription.onDidChange(this.onSubscriptionChanged, this));
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
		_loading: boolean,
		_options?: WebviewShowOptions,
		..._args: WebviewShowingArgs<WelcomeWebviewShowingArgs, State>
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
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

	private async getState(): Promise<State> {
		const subscription = await this.container.subscription.getSubscription();
		const plusState = subscription?.state ?? SubscriptionState.Community;

		return {
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			hostAppName: env.appName,
			plusState: plusState,
		};
	}
}
