import { Disposable, workspace } from 'vscode';
import type { Container } from '../../container';
import { configuration } from '../../system/configuration';
import type { IpcMessage } from '../protocol';
import { onIpc } from '../protocol';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { DidChangeRepositoriesParams, State, UpdateConfigurationParams } from './protocol';
import { DidChangeRepositoriesType, UpdateConfigurationCommandType } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class WelcomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container, private readonly host: WebviewController<State>) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.notifyDidChangeRepositories, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	includeBootstrap(): State {
		const { repoFeaturesBlocked } = this.getRepositoriesState();

		return {
			timestamp: Date.now(),
			version: this.container.version,
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: {
				codeLens: configuration.get('codeLens.enabled'),
				currentLine: configuration.get('currentLine.enabled'),
			},
			repoFeaturesBlocked: repoFeaturesBlocked,
		};
	}

	onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case UpdateConfigurationCommandType.method:
				onIpc(UpdateConfigurationCommandType, e, params => this.updateConfiguration(params));
				break;
		}
	}

	private getRepositoriesState(): DidChangeRepositoriesParams {
		// const count = this.container.git.repositoryCount;
		const openCount = this.container.git.openRepositoryCount;
		const hasUnsafe = this.container.git.hasUnsafeRepositories();
		const trusted = workspace.isTrusted;

		return {
			repoFeaturesBlocked: !trusted || openCount === 0 || hasUnsafe,
		};
	}

	private updateConfiguration(params: UpdateConfigurationParams) {
		void configuration.updateEffective(`${params.type}.enabled`, params.value);
	}

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositoriesType, this.getRepositoriesState());
	}
}
