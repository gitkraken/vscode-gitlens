import { workspace } from 'vscode';
import { Commands, ContextKeys } from '../../constants';
import type { Container } from '../../container';
import { registerCommand } from '../../system/command';
import { configuration } from '../../system/configuration';
import { DidOpenAnchorNotificationType } from '../protocol';
import { WebviewWithConfigBase } from '../webviewWithConfigBase';
import type { State } from './protocol';

const anchorRegex = /.*?#(.*)/;

export class SettingsWebview extends WebviewWithConfigBase<State> {
	private _pendingJumpToAnchor: string | undefined;

	constructor(container: Container) {
		super(
			container,
			'gitlens.settings',
			'settings.html',
			'images/gitlens-icon.png',
			'GitLens Settings',
			`${ContextKeys.WebviewPrefix}settings`,
			'settingsWebview',
			Commands.ShowSettingsPage,
		);

		this.disposables.push(
			...[
				Commands.ShowSettingsPageAndJumpToBranchesView,
				Commands.ShowSettingsPageAndJumpToCommitsView,
				Commands.ShowSettingsPageAndJumpToContributorsView,
				Commands.ShowSettingsPageAndJumpToFileHistoryView,
				Commands.ShowSettingsPageAndJumpToLineHistoryView,
				Commands.ShowSettingsPageAndJumpToRemotesView,
				Commands.ShowSettingsPageAndJumpToRepositoriesView,
				Commands.ShowSettingsPageAndJumpToSearchAndCompareView,
				Commands.ShowSettingsPageAndJumpToStashesView,
				Commands.ShowSettingsPageAndJumpToTagsView,
				Commands.ShowSettingsPageAndJumpToWorkTreesView,
				Commands.ShowSettingsPageAndJumpToViews,
				Commands.ShowSettingsPageAndJumpToCommitGraph,
				Commands.ShowSettingsPageAndJumpToAutolinks,
			].map(c => {
				// The show and jump commands are structured to have a # separating the base command from the anchor
				let anchor: string | undefined;
				const match = anchorRegex.exec(c);
				if (match != null) {
					[, anchor] = match;
				}

				return registerCommand(c, (...args: any[]) => this.onShowAnchorCommand(anchor, ...args), this);
			}),
		);
	}

	protected override onReady() {
		if (this._pendingJumpToAnchor != null) {
			const anchor = this._pendingJumpToAnchor;
			this._pendingJumpToAnchor = undefined;

			void this.notify(DidOpenAnchorNotificationType, { anchor: anchor, scrollBehavior: 'auto' });
		}
	}

	private onShowAnchorCommand(anchor?: string, ...args: any[]) {
		if (anchor) {
			if (this.isReady && this.visible) {
				queueMicrotask(
					() => void this.notify(DidOpenAnchorNotificationType, { anchor: anchor, scrollBehavior: 'smooth' }),
				);
				return;
			}

			this._pendingJumpToAnchor = anchor;
		}

		this.onShowCommand(...args);
	}

	protected override includeBootstrap(): State {
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
}
