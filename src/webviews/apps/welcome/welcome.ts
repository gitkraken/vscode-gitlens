/*global*/
import './welcome.scss';
import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { State } from '../../welcome/protocol.js';
import { GlAppHost } from '../shared/appHost.js';
import { scrollableBase } from '../shared/components/styles/lit/base.css.js';
import type { LoggerContext } from '../shared/contexts/logger.js';
import type { HostIpc } from '../shared/ipc.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import { WelcomeStateProvider } from './stateProvider.js';
import { welcomeBaseStyles } from './welcome.css.js';
import '../home/components/welcome-page.js';

@customElement('gl-welcome-app')
export class GlWelcomeApp extends GlAppHost<State> {
	static override styles = [scrollableBase, welcomeBaseStyles];

	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): WelcomeStateProvider {
		return new WelcomeStateProvider(this, bootstrap, ipc, logger);
	}

	@property({ type: String })
	webroot?: string;

	@state()
	private isLightTheme = false;

	protected override onThemeUpdated(e: ThemeChangeEvent): void {
		this.isLightTheme = e.isLightTheme;
	}

	override render(): unknown {
		return html`
			<div class="welcome scrollable">
				<gl-welcome-page .webroot=${this.webroot} .isLightTheme=${this.isLightTheme}></gl-welcome-page>
			</div>
		`;
	}
}
