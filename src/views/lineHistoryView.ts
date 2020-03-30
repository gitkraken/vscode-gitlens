'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, LineHistoryViewConfig, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { LineHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

export class LineHistoryView extends ViewBase<LineHistoryTrackerNode> {
	constructor() {
		super('gitlens.views.lineHistory', 'Line History');
	}

	getRoot() {
		return new LineHistoryTrackerNode(this);
	}

	protected get location(): string {
		return this.config.location;
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

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'views', 'lineHistory') &&
			!configuration.changed(e, 'views', 'commitFileDescriptionFormat') &&
			!configuration.changed(e, 'views', 'commitFileFormat') &&
			!configuration.changed(e, 'views', 'commitDescriptionFormat') &&
			!configuration.changed(e, 'views', 'commitFormat') &&
			!configuration.changed(e, 'views', 'defaultItemLimit') &&
			!configuration.changed(e, 'views', 'pageItemLimit') &&
			!configuration.changed(e, 'views', 'showRelativeDateMarkers') &&
			!configuration.changed(e, 'views', 'statusFileDescriptionFormat') &&
			!configuration.changed(e, 'views', 'statusFileFormat') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'advanced', 'fileHistoryFollowsRenames')
		) {
			return;
		}

		if (configuration.changed(e, 'views', 'lineHistory', 'enabled')) {
			setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, true);
		}

		if (configuration.changed(e, 'views', 'lineHistory', 'location')) {
			this.initialize(this.config.location);
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
	}

	get config(): ViewsConfig & LineHistoryViewConfig {
		return { ...Container.config.views, ...Container.config.views.lineHistory };
	}

	private changeBase() {
		if (this._root !== undefined) {
			void this._root.changeBase();
		}
	}

	private setEditorFollowing(enabled: boolean) {
		setCommandContext(CommandContext.ViewsLineHistoryEditorFollowing, enabled);
		if (this._root !== undefined) {
			this._root.setEditorFollowing(enabled);
		}
	}

	private setRenameFollowing(enabled: boolean) {
		return configuration.updateEffective('advanced', 'fileHistoryFollowsRenames', enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', 'lineHistory', 'avatars', enabled);
	}
}
