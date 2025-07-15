import type { WebviewTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import type { State } from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.composer'>,
	) {}

	dispose(): void {}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	includeBootstrap(): State {
		return {
			...this.host.baseWebviewState,
		};
	}

	onShowing(): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		return [true, undefined];
	}
}
