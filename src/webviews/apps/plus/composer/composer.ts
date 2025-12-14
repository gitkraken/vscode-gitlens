import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../plus/composer/protocol';
import { GlAppHost } from '../../shared/appHost';
import type { LoggerContext } from '../../shared/contexts/logger';
import type { HostIpc } from '../../shared/ipc';
import { ComposerStateProvider } from './stateProvider';
import './components/app';
import './composer.scss';

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
