import { configuration } from '../../system/configuration';
import { WebviewProviderWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

export class WelcomeWebviewProvider extends WebviewProviderWithConfigBase<State> {
	includeBootstrap(): State {
		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
		};
	}
}
