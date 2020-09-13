'use strict';
import { commands, Disposable, workspace } from 'vscode';
import { Commands } from '../commands';
import { configuration } from '../configuration';
import {
	IpcMessage,
	onIpcCommand,
	ReadyCommandType,
	SettingsDidRequestJumpToNotificationType,
	SettingsState,
} from './protocol';
import { WebviewBase } from './webviewBase';

const anchorRegex = /.*?#(.*)/;

export class SettingsWebview extends WebviewBase {
	private _pendingJumpToAnchor: string | undefined;

	constructor() {
		super(Commands.ShowSettingsPage);

		this.disposable = Disposable.from(
			this.disposable,
			...[
				Commands.ShowSettingsPageAndJumpToBranchesView,
				Commands.ShowSettingsPageAndJumpToCommitsView,
				Commands.ShowSettingsPageAndJumpToCompareView,
				Commands.ShowSettingsPageAndJumpToContributorsView,
				Commands.ShowSettingsPageAndJumpToFileHistoryView,
				Commands.ShowSettingsPageAndJumpToLineHistoryView,
				Commands.ShowSettingsPageAndJumpToRemotesView,
				Commands.ShowSettingsPageAndJumpToRepositoriesView,
				Commands.ShowSettingsPageAndJumpToSearchCommitsView,
				Commands.ShowSettingsPageAndJumpToStashesView,
				Commands.ShowSettingsPageAndJumpToTagsView,
			].map(c => {
				// The show and jump commands are structured to have a # separating the base command from the anchor
				let anchor: string | undefined;
				const match = anchorRegex.exec(c);
				if (match != null) {
					[, anchor] = match;
				}

				return commands.registerCommand(c, () => this.onShowCommand(anchor), this);
			}),
		);
	}

	protected onShowCommand(anchor?: string) {
		if (anchor) {
			this._pendingJumpToAnchor = anchor;
		}
		super.onShowCommand();
	}

	protected onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case ReadyCommandType.method:
				onIpcCommand(ReadyCommandType, e, _params => {
					if (this._pendingJumpToAnchor !== undefined) {
						void this.notify(SettingsDidRequestJumpToNotificationType, {
							anchor: this._pendingJumpToAnchor,
						});
						this._pendingJumpToAnchor = undefined;
					}
				});

				break;

			default:
				super.onMessageReceived(e);

				break;
		}
	}

	get filename(): string {
		return 'settings.html';
	}

	get id(): string {
		return 'gitlens.settings';
	}

	get title(): string {
		return 'GitLens Settings';
	}

	renderEndOfBody() {
		const scopes: ['user' | 'workspace', string][] = [['user', 'User']];
		if (workspace.workspaceFolders?.length) {
			scopes.push(['workspace', 'Workspace']);
		}

		const bootstrap: SettingsState = {
			// Make sure to get the raw config, not from the container which has the modes mixed in
			config: configuration.get(),
			scope: 'user',
			scopes: scopes,
		};
		return `<script type="text/javascript" nonce="Z2l0bGVucy1ib290c3RyYXA=">window.bootstrap = ${JSON.stringify(
			bootstrap,
		)};</script>`;
	}
}
