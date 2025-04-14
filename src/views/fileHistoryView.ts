import type { ConfigurationChangeEvent, Disposable } from 'vscode';
import type { FileHistoryViewConfig } from '../config';
import type { Container } from '../container';
import type { GitUri } from '../git/gitUri';
import { executeCommand } from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { setContext } from '../system/-webview/context';
import { FileHistoryTrackerNode } from './nodes/fileHistoryTrackerNode';
import { LineHistoryTrackerNode } from './nodes/lineHistoryTrackerNode';
import { ViewBase } from './viewBase';
import type { CopyNodeCommandArgs } from './viewCommands';
import { registerViewCommand } from './viewCommands';

const pinnedSuffix = ' (pinned)';

export class FileHistoryView extends ViewBase<
	'fileHistory',
	FileHistoryTrackerNode | LineHistoryTrackerNode,
	FileHistoryViewConfig
> {
	protected readonly configKey = 'fileHistory';

	private _followCursor: boolean = false;
	private _followEditor: boolean = true;

	constructor(container: Container, grouped?: boolean) {
		super(container, 'fileHistory', 'File History', 'fileHistoryView', grouped);

		void setContext('gitlens:views:fileHistory:cursorFollowing', this._followCursor);
		void setContext('gitlens:views:fileHistory:editorFollowing', this._followEditor);
	}

	override get canSelectMany(): boolean {
		return configuration.get('views.multiselect');
	}

	protected override get showCollapseAll(): boolean {
		return false;
	}

	getRoot(): LineHistoryTrackerNode | FileHistoryTrackerNode {
		return this._followCursor ? new LineHistoryTrackerNode(this) : new FileHistoryTrackerNode(this);
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand<CopyNodeCommandArgs>('gitlens.views.copy', this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(this.getQualifiedCommand('changeBase'), () => this.changeBase(), this),
			registerViewCommand(
				this.getQualifiedCommand('setCursorFollowingOn'),
				() => this.setCursorFollowing(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setCursorFollowingOff'),
				() => this.setCursorFollowing(false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setEditorFollowingOn'),
				() => this.setEditorFollowing(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setEditorFollowingOff'),
				() => this.setEditorFollowing(false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setRenameFollowingOn'),
				() => this.setRenameFollowing(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setRenameFollowingOff'),
				() => this.setRenameFollowing(false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowAllBranchesOn'),
				() => this.setShowAllBranches(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowAllBranchesOff'),
				() => this.setShowAllBranches(false),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOn'),
				() => this.setShowMergeCommits(true),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setShowMergeCommitsOff'),
				() => this.setShowMergeCommits(false),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent): boolean {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat') &&
			!configuration.changed(e, 'advanced.fileHistoryFollowsRenames') &&
			!configuration.changed(e, 'advanced.fileHistoryShowAllBranches') &&
			!configuration.changed(e, 'advanced.fileHistoryShowMergeCommits')
		) {
			return false;
		}

		return true;
	}

	async showHistoryForUri(uri: GitUri): Promise<void> {
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
		void setContext('gitlens:views:fileHistory:cursorFollowing', enabled);

		if (this.grouped) {
			this.groupedLabel = (this._followCursor ? 'Line History' : 'File History').toLocaleLowerCase();
			this.description = this.groupedLabel;
		} else {
			this.title = this._followCursor ? 'Line History' : 'File History';
		}

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
		void setContext('gitlens:views:fileHistory:editorFollowing', enabled);

		root.setEditorFollowing(enabled);

		if (this.description?.endsWith(pinnedSuffix)) {
			if (enabled) {
				this.description = this.description.substring(0, this.description.length - pinnedSuffix.length);
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

	private setShowMergeCommits(enabled: boolean) {
		return configuration.updateEffective('advanced.fileHistoryShowMergeCommits', enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
