'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, FileHistoryViewConfig } from '../configuration';
import { CommandContext, setCommandContext } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { FileHistoryTrackerNode, LineHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

export class FileHistoryView extends ViewBase<FileHistoryTrackerNode | LineHistoryTrackerNode, FileHistoryViewConfig> {
	protected readonly configKey = 'fileHistory';

	constructor() {
		super('gitlens.views.fileHistory', 'File History');
	}

	getRoot(): LineHistoryTrackerNode | FileHistoryTrackerNode {
		return this._followCursor ? new LineHistoryTrackerNode(this) : new FileHistoryTrackerNode(this);
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
			this.getQualifiedCommand('setCursorFollowingOn'),
			() => this.setCursorFollowing(true),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setCursorFollowingOff'),
			() => this.setCursorFollowing(false),
			this,
		);
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
		commands.registerCommand(
			this.getQualifiedCommand('setShowAllBranchesOn'),
			() => this.setShowAllBranches(true),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setShowAllBranchesOff'),
			() => this.setShowAllBranches(false),
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
			!configuration.changed(e, 'advanced', 'fileHistoryFollowsRenames') &&
			!configuration.changed(e, 'advanced', 'fileHistoryShowAllBranches')
		) {
			return false;
		}

		return true;
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views', this.configKey, 'enabled')) {
			void setCommandContext(CommandContext.ViewsFileHistoryEditorFollowing, this._followEditor);
			void setCommandContext(CommandContext.ViewsFileHistoryCursorFollowing, this._followCursor);
		}

		if (configuration.changed(e, 'views', this.configKey, 'location')) {
			this.initialize(this.config.location);
		}

		if (!configuration.initializing(e) && this._root != null) {
			void this.refresh(true);
		}
	}

	async showHistoryForUri(uri: GitUri, baseRef?: string) {
		this.setCursorFollowing(false);
		this.setEditorFollowing(false);

		const root = this.ensureRoot(true);
		if (root instanceof FileHistoryTrackerNode) {
			await root.showHistoryForUri(uri, baseRef);
		}
		return this.show();
	}

	private changeBase() {
		void this._root?.changeBase();
	}

	private _followCursor: boolean = false;
	private setCursorFollowing(enabled: boolean) {
		this._followCursor = enabled;
		void setCommandContext(CommandContext.ViewsFileHistoryCursorFollowing, enabled);

		this.title = this._followCursor ? 'Line History' : 'File History';
		this.titleContext = this._followCursor ? this.titleContext : undefined;

		const root = this.ensureRoot(true);
		root.setEditorFollowing(this._followEditor);
		void root.ensureSubscription();
		void this.refresh(true);
	}

	private _followEditor: boolean = true;
	private setEditorFollowing(enabled: boolean) {
		this._followEditor = enabled;
		void setCommandContext(CommandContext.ViewsFileHistoryEditorFollowing, enabled);
		this._root?.setEditorFollowing(enabled);
		this.description = enabled ? '' : ' (pinned)';
	}

	private setRenameFollowing(enabled: boolean) {
		return configuration.updateEffective('advanced', 'fileHistoryFollowsRenames', enabled);
	}

	private setShowAllBranches(enabled: boolean) {
		return configuration.updateEffective('advanced', 'fileHistoryShowAllBranches', enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
