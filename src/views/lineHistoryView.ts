'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, LineHistoryViewConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { LineHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

const pinnedSuffix = ' (pinned)';

export class LineHistoryView extends ViewBase<LineHistoryTrackerNode, LineHistoryViewConfig> {
	protected readonly configKey = 'lineHistory';
	protected readonly showCollapseAll = false;

	constructor() {
		super('gitlens.views.lineHistory', 'Line History');
	}

	getRoot() {
		return new LineHistoryTrackerNode(this);
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this);
		commands.registerCommand(
			this.getQualifiedCommand('setEditorFollowingOn'),
			() => this.setEditorFollowing(true),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setEditorFollowingOff'),
			() => this.setEditorFollowing(false),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setRenameFollowingOn'),
			() => this.setRenameFollowing(true),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setRenameFollowingOff'),
			() => this.setRenameFollowing(false),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this);
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'advanced', 'fileHistoryFollowsRenames')
		) {
			return false;
		}

		return true;
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views', this.configKey, 'enabled')) {
			void setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, true);
		}

		super.onConfigurationChanged(e);
	}

	private changeBase() {
		void this.root?.changeBase();
	}

	private setEditorFollowing(enabled: boolean) {
		void setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, enabled);
		this.root?.setEditorFollowing(enabled);

		if (this.titleDescription?.endsWith(pinnedSuffix)) {
			if (enabled) {
				this.titleDescription = this.titleDescription.substr(
					0,
					this.titleDescription.length - pinnedSuffix.length,
				);
			}
		} else if (!enabled) {
			this.titleDescription += pinnedSuffix;
		}
	}

	private setRenameFollowing(enabled: boolean) {
		return configuration.updateEffective('advanced', 'fileHistoryFollowsRenames', enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
