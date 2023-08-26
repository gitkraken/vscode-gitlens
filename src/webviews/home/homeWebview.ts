import { Disposable, workspace } from 'vscode';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import type { WebviewController, WebviewProvider } from '../webviewController';
import type { DidChangeRepositoriesParams, State } from './protocol';
import { DidChangeRepositoriesType } from './protocol';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

export class HomeWebviewProvider implements WebviewProvider<State> {
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewController<State>,
	) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
				: emptyDisposable,
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	private onRepositoriesChanged() {
		this.notifyDidChangeRepositories();
	}

	registerCommands(): Disposable[] {
		return [registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this)];
	}

	includeBootstrap(): State {
		return this.getState();
	}

	onReloaded() {
		this.notifyDidChangeRepositories();
	}

	private getState(): State {
		return {
			webviewId: this.host.id,
			timestamp: Date.now(),
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
		};
	}

	private getRepositoriesState(): DidChangeRepositoriesParams {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositoriesType, this.getRepositoriesState());
	}
}
