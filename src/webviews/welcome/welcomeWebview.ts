import { configuration } from '../../system/configuration';
import type { WebviewProvider } from '../webviewController';
import { WebviewProviderWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

export class WelcomeWebviewProvider extends WebviewProviderWithConfigBase<State> implements WebviewProvider<State> {
	includeBootstrap(): State {
		return {
			timestamp: Date.now(),
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
		};
	}
}
