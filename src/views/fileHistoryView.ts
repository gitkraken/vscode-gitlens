import { commands, ConfigurationChangeEvent, Disposable } from 'vscode';
import { configuration, FileHistoryViewConfig } from '../configuration';
import { Commands, ContextKeys } from '../constants';
import { Container } from '../container';
import { setContext } from '../context';
import { GitUri } from '../git/gitUri';
import { executeCommand } from '../system/command';
import { FileHistoryTrackerNode, LineHistoryTrackerNode } from './nodes';
import { ViewBase } from './viewBase';

const pinnedSuffix = ' (pinned)';

export class FileHistoryView extends ViewBase<FileHistoryTrackerNode | LineHistoryTrackerNode, FileHistoryViewConfig> {
	protected readonly configKey = 'fileHistory';

	private _followCursor: boolean = false;
	private _followEditor: boolean = true;

	constructor(container: Container) {
		super('gitlens.views.fileHistory', 'File History', container);

		void setContext(ContextKeys.ViewsFileHistoryCursorFollowing, this._followCursor);
		void setContext(ContextKeys.ViewsFileHistoryEditorFollowing, this._followEditor);
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	getRoot(): LineHistoryTrackerNode | FileHistoryTrackerNode {
		return this._followCursor ? new LineHistoryTrackerNode(this) : new FileHistoryTrackerNode(this);
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			commands.registerCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.selection),
				this,
			),
			commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			commands.registerCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this),
			commands.registerCommand(
				this.getQualifiedCommand('setCursorFollowingOn'),
				() => this.setCursorFollowing(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setCursorFollowingOff'),
				() => this.setCursorFollowing(false),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setEditorFollowingOn'),
				() => this.setEditorFollowing(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setEditorFollowingOff'),
				() => this.setEditorFollowing(false),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setRenameFollowingOn'),
				() => this.setRenameFollowing(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setRenameFollowingOff'),
				() => this.setRenameFollowing(false),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAllBranchesOn'),
				() => this.setShowAllBranches(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAllBranchesOff'),
				() => this.setShowAllBranches(false),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAvatarsOn'),
				() => this.setShowAvatars(true),
				this,
			),
			commands.registerCommand(
				this.getQualifiedCommand('setShowAvatarsOff'),
				() => this.setShowAvatars(false),
				this,
			),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat') &&
			!configuration.changed(e, 'advanced.fileHistoryFollowsRenames') &&
			!configuration.changed(e, 'advanced.fileHistoryStopsAtFirstParent') &&
			!configuration.changed(e, 'advanced.fileHistoryShowAllBranches')
		) {
			return false;
		}

		return true;
	}

	async showHistoryForUri(uri: GitUri) {
		this.setCursorFollowing(false);

		const root = this.ensureRoot(true);

		if (root instanceof FileHistoryTrackerNode) {
			await root.showHistoryForUri(uri);

			this.setEditorFollowing(false);
		}

		return this.show();
	}

	private changeBase() {
		void this.root?.changeBase();
	}

	private setCursorFollowing(enabled: boolean) {
		const uri = !this._followEditor && this.root?.hasUri ? this.root.uri : undefined;

		this._followCursor = enabled;
		void setContext(ContextKeys.ViewsFileHistoryCursorFollowing, enabled);

		this.title = this._followCursor ? 'Line History' : 'File History';

		const root = this.ensureRoot(true);
		if (uri != null) {
			root.setUri(uri);
		}
		root.setEditorFollowing(this._followEditor);
		void root.ensureSubscription();
		void this.refresh(true);
	}

	private setEditorFollowing(enabled: boolean) {
		const root = this.ensureRoot();
		if (!root.hasUri) return;

		this._followEditor = enabled;
		void setContext(ContextKeys.ViewsFileHistoryEditorFollowing, enabled);

		root.setEditorFollowing(enabled);

		if (this.description?.endsWith(pinnedSuffix)) {
			if (enabled) {
				this.description = this.description.substr(0, this.description.length - pinnedSuffix.length);
			}
		} else if (!enabled && this.description != null) {
			this.description += pinnedSuffix;
		}

		if (enabled) {
			void root.ensureSubscription();
			void this.refresh(true);
		}
	}

	private setRenameFollowing(enabled: boolean) {
		return configuration.updateEffective('advanced.fileHistoryFollowsRenames', enabled);
	}

	private setShowAllBranches(enabled: boolean) {
		return configuration.updateEffective('advanced.fileHistoryShowAllBranches', enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
