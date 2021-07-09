'use strict';
import { Commands } from '../commands';
import { Container } from '../container';
import { WelcomeState } from './protocol';
import { WebviewBase } from './webviewBase';

export class WelcomeWebview extends WebviewBase {
	constructor() {
		super(Commands.ShowWelcomePage);
	}

	get filename(): string {
		return 'welcome.html';
	}

	get id(): string {
		return 'gitlens.welcome';
	}

	get title(): string {
		return 'Welcome to GitLens';
	}

	override renderEndOfBody() {
		const bootstrap: WelcomeState = {
			config: Container.config,
		};
		return `<script type="text/javascript" nonce="#{cspNonce}">window.bootstrap = ${JSON.stringify(
			bootstrap,
		)};</script>`;
	}
}
