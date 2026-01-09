import './composer.scss';
import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../plus/composer/protocol.js';
import { GlAppHost } from '../../shared/appHost.js';
import type { LoggerContext } from '../../shared/contexts/logger.js';
import type { HostIpc } from '../../shared/ipc.js';
import { ComposerStateProvider } from './stateProvider.js';
import './components/app.js';

@customElement('gl-composer-apphost')
export class ComposerAppHost extends GlAppHost<State> {
	protected override createStateProvider(
		bootstrap: string,
		ipc: HostIpc,
		logger: LoggerContext,
	): ComposerStateProvider {
		return new ComposerStateProvider(this, bootstrap, ipc, logger);
	}

	override render() {
		return html`<gl-composer-app></gl-composer-app>`;
	}
}
