import type { Disposable } from 'vscode';
import { env } from 'vscode';
import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { State } from './protocol.js';
import type { WelcomeWebviewShowingArgs } from './registration.js';

export class WelcomeWebviewProvider implements WebviewProvider<State, State, WelcomeWebviewShowingArgs> {
	private readonly _disposable: Disposable | undefined;

	constructor(
		_container: Container,
		private readonly host: WebviewHost<'gitlens.views.welcome'>,
	) {}

	dispose(): void {
		this._disposable?.dispose();
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

	private getState(): Promise<State> {
		return Promise.resolve({
			...this.host.baseWebviewState,
			webroot: this.host.getWebRoot(),
			hostAppName: env.appName,
		});
	}
}
