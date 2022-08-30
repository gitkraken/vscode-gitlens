import { configuration } from '../../configuration';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { WebviewWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

export class WelcomeWebview extends WebviewWithConfigBase<State> {
	constructor(container: Container) {
		super(
			container,
			'gitlens.welcome',
			'welcome.html',
			'images/gitlens-icon.png',
			'Welcome to GitLens',
			'welcomeWebview',
			Commands.ShowWelcomePage,
		);
	}

	protected override includeBootstrap(): State {
		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
		};
	}
}
