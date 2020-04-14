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

	renderEndOfBody() {
		const bootstrap: WelcomeState = {
			config: Container.config,
		};
		return `<script type="text/javascript" nonce="Z2l0bGVucy1ib290c3RyYXA=">window.bootstrap = ${JSON.stringify(
			bootstrap,
		)};</script>`;
	}
}
