import { Disposable } from 'vscode';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { State, UpdateConfigurationParams } from './protocol';
import { UpdateConfigurationCommandType } from './protocol';

export class WelcomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from();
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): State {
		return {
			timestamp: Date.now(),
			version: this.container.version,
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: {
				codeLens: configuration.get('codeLens.enabled'),
				currentLine: configuration.get('currentLine.enabled'),
			},
		};
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				onIpc(UpdateConfigurationCommandType, e, params => this.updateConfiguration(params));
				break;
		}
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
		void configuration.updateEffective(`${params.type}.enabled`, params.value);
	}
}
