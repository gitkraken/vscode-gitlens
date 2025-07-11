import { customElement } from 'lit/decorators.js';
import type { State } from '../../../plus/composer/protocol';
import type { StateProvider } from '../../shared/appHost';
import { GlAppHost } from '../../shared/appHost';
import type { HostIpc } from '../../shared/ipc';
import './components/app';
import './composer.scss';

@customElement('gl-composer-apphost')
export class ComposerAppHost extends GlAppHost<State> {
	protected override createStateProvider(state: State, _ipc: HostIpc): StateProvider<State> {
		return {
			state: state,
			dispose: () => {},
		};
	}
}
