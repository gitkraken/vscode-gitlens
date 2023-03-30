import type { ViewColumn } from 'vscode';
import { workspace } from 'vscode';
import { configuration } from '../../system/configuration';
import { DidOpenAnchorNotificationType } from '../protocol';
import type { WebviewProvider } from '../webviewController';
import { WebviewProviderWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

export class SettingsWebviewProvider extends WebviewProviderWithConfigBase<State> implements WebviewProvider<State> {
	private _pendingJumpToAnchor: string | undefined;

	onShowing?(
		loading: boolean,
		_options: { column?: ViewColumn; preserveFocus?: boolean },
		...args: unknown[]
	): boolean | Promise<boolean> {
		const anchor = args[0];
		if (anchor && typeof anchor === 'string') {
			if (!loading && this.host.isReady && this.host.visible) {
				queueMicrotask(
					() =>
						void this.host.notify(DidOpenAnchorNotificationType, {
							anchor: anchor,
							scrollBehavior: 'smooth',
						}),
				);
				return true;
			}

			this._pendingJumpToAnchor = anchor;
		}

		return true;
	}

	includeBootstrap(): State {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		return {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.getAll(true),
			customSettings: this.getCustomSettings(),
			scope: 'user',
			scopes: scopes,
		};
	}

	onReady() {
		if (this._pendingJumpToAnchor != null) {
			const anchor = this._pendingJumpToAnchor;
			this._pendingJumpToAnchor = undefined;

			void this.host.notify(DidOpenAnchorNotificationType, { anchor: anchor, scrollBehavior: 'auto' });
		}
	}
}
