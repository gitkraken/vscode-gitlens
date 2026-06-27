import type { WebviewTelemetryContext } from '../../constants.telemetry.js';
import type { WebviewHost, WebviewProvider } from '../webviewProvider.js';
import type { State } from './protocol.js';

/** Host provider for the dev-only styleguide. Static — no IPC, no bootstrap data beyond the base. */
export class StyleguideWebviewProvider implements WebviewProvider<State, State> {
	constructor(private readonly host: WebviewHost<'gitlens.styleguide'>) {}

	dispose(): void {}

	getTelemetryContext(): WebviewTelemetryContext {
		return { ...this.host.getTelemetryContext() };
	}

	includeBootstrap(): State {
		return this.host.baseWebviewState;
	}
}
