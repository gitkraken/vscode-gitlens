import type { Disposable } from 'vscode';
import { Commands, ContextKeys } from '../../../constants';
import type { Container } from '../../../container';
import { setContext } from '../../../context';
import { registerCommand } from '../../../system/command';
import { WebviewBase } from '../../../webviews/webviewBase';
import type { State } from './protocol';

export class WorkspacesWebview extends WebviewBase<State> {
	constructor(container: Container) {
		super(
			container,
			'gitlens.workspaces',
			'workspaces.html',
			'images/gitlens-icon.png',
			'Workspaces',
			`${ContextKeys.WebviewPrefix}workspaces`,
			'workspacesWebview',
			Commands.ShowWorkspacesPage,
		);
	}

	protected override registerCommands(): Disposable[] {
		return [registerCommand(Commands.RefreshWorkspaces, () => this.refresh(true))];
	}

	protected override onFocusChanged(focused: boolean): void {
		if (focused) {
			// If we are becoming focused, delay it a bit to give the UI time to update
			setTimeout(() => void setContext(ContextKeys.WorkspacesFocused, focused), 0);

			return;
		}

		void setContext(ContextKeys.WorkspacesFocused, focused);
	}

	private async getWorkspaces() {
		try {
			const rsp = await this.container.workspaces.getWorkspacesWithPullRequests();
			console.log(rsp);
		} catch (ex) {
			console.log(ex);
		}

		return {};
	}

	private async getState(): Promise<State> {
		return Promise.resolve({
			workspaces: this.getWorkspaces(),
		});
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}
}
