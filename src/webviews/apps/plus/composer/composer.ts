import { html } from 'lit';
import { customElement } from 'lit/decorators.js';
import type { State } from '../../../plus/composer/protocol';
import { GlAppHost } from '../../shared/appHost';
import type { HostIpc } from '../../shared/ipc';
import './components/app';
import './composer.scss';
import { ComposerStateProvider } from './stateProvider';

@customElement('gl-composer-apphost')
export class ComposerAppHost extends GlAppHost<State> {
	protected override createStateProvider(state: State, ipc: HostIpc): ComposerStateProvider {
		return new ComposerStateProvider(this, state, ipc);
	}

	override render() {
		return html`<gl-composer-app></gl-composer-app>`;
	}
}
