import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, workspace } from 'vscode';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { State, UpdateConfigurationParams } from './protocol';
import { DidChangeNotificationType, UpdateConfigurationCommandType } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class WelcomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from(
			configuration.onDidChange(this.onConfigurationChanged, this),
			this.container.git.onDidChangeRepositories(this.notifyDidChange, this),
			!workspace.isTrusted ? workspace.onDidGrantWorkspaceTrust(this.notifyDidChange, this) : emptyDisposable,
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): State {
		return this.getState();
	}

	onReloaded() {
		this.notifyDidChange();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changed(e, 'codeLens.enabled') && !configuration.changed(e, 'currentLine.enabled')) return;

		this.notifyDidChange();
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				onIpc(UpdateConfigurationCommandType, e, params => this.updateConfiguration(params));
				break;
		}
	}
	private getState(): State {
		return {
			timestamp: Date.now(),
			version: this.container.version,
			// Make sure to get the raw config so to avoid having the mode mixed in
			config: {
				codeLens: configuration.get('codeLens.enabled', undefined, true, true),
				currentLine: configuration.get('currentLine.enabled', undefined, true, true),
			},
			repoFeaturesBlocked:
				!workspace.isTrusted ||
				this.container.git.openRepositoryCount === 0 ||
				this.container.git.hasUnsafeRepositories(),
		};
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
		void configuration.updateEffective(`${params.type}.enabled`, params.value);
	}

	private notifyDidChange() {
		void this.host.notify(DidChangeNotificationType, { state: this.getState() });
	}
}
