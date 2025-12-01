import { Disposable } from 'vscode';
import type { WebviewTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { WebviewHost, WebviewProvider } from '../webviewProvider';
import type { State } from './protocol';
import type { WelcomeWebviewShowingArgs } from './registration';

export class WelcomeWebviewProvider implements WebviewProvider<State, State, WelcomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.welcome'>,
	) {
		this.host.title = 'Welcome to GitLens';
		this._disposable = Disposable.from();
	}

	dispose(): void {
		this._disposable.dispose();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	includeBootstrap(): State {
		return this.getState();
	}

	private getState(): State {
		return {
			webviewId: 'gitlens.welcome',
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
			version: this.container.version,
		};
	}
}
