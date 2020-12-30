'use strict';
import * as paths from 'path';
import { Command, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { BranchNode } from './branchNode';
import { Commands, DiffWithCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { BuiltInCommands } from '../../constants';
import { FileNode, FolderNode } from './folderNode';
import { GitBranch, GitFile, GitMergeStatus, StatusFileFormatter } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Arrays, Strings } from '../../system';
import { View, ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class MergeStatusNode extends ViewNode<ViewsWithCommits> {
	static key = ':merge';
	static getId(repoPath: string, name: string): string {
		return `${BranchNode.getId(repoPath, name, true)}${this.key}`;
	}

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly status: GitMergeStatus,
	) {
		super(GitUri.fromRepoPath(status.repoPath), view, parent);
	}

	get id(): string {
		return MergeStatusNode.getId(this.status.repoPath, this.status.into);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		let children: FileNode[] = this.status.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, this.status, f),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = Arrays.makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) =>
				a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' }),
			);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`Resolve conflicts before merging ${this.status.incoming ? `${this.status.incoming} ` : ''}into ${
				this.status.into
			}`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Merge;
		item.description = Strings.pluralize('conflict', this.status.conflicts.length);
		item.iconPath = new ThemeIcon('warning', new ThemeColor('list.warningForeground'));
		item.tooltip = new MarkdownString(
			`Merging ${this.status.incoming ? `$(git-branch) ${this.status.incoming} ` : ''} into $(git-branch) ${
				this.status.into
			}\n\n${Strings.pluralize('conflicted file', this.status.conflicts.length)}
			`,
			true,
		);

		return item;
	}
}

export class MergeConflictFileNode extends ViewNode implements FileNode {
	constructor(view: View, parent: ViewNode, private readonly status: GitMergeStatus, public readonly file: GitFile) {
		super(GitUri.fromFile(file, status.repoPath, 'MERGE_HEAD'), view, parent);
	}

	toClipboard(): string {
		return this.fileName;
	}

	get baseUri(): Uri {
		return GitUri.fromFile(this.file, this.status.repoPath, this.status.mergeBase ?? 'HEAD');
	}

	get fileName(): string {
		return this.file.fileName;
	}

	get repoPath(): string {
		return this.status.repoPath;
	}

	getChildren(): ViewNode[] {
		return [
			new MergeConflictCurrentChangesNode(this.view, this, this.status, this.file),
			new MergeConflictIncomingChangesNode(this.view, this, this.status, this.file),
		];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.Collapsed);
		item.description = this.description;
		item.contextValue = `${ContextValues.File}+conflicted`;
		item.tooltip = StatusFileFormatter.fromTemplate(
			// eslint-disable-next-line no-template-curly-in-string
			'${file}\n${directory}/\n\n${status}${ (originalPath)} in Index (staged)',
			this.file,
		);
		// Use the file icon and decorations
		item.resourceUri = GitUri.resolveToUri(this.file.fileName, this.repoPath);
		item.iconPath = ThemeIcon.File;
		item.command = this.getCommand();

		// Only cache the label/description for a single refresh
		this._label = undefined;
		this._description = undefined;

		return item;
	}

	private _description: string | undefined;
	get description() {
		if (this._description == null) {
			this._description = StatusFileFormatter.fromTemplate(
				this.view.config.formats.files.description,
				this.file,
				{
					relativePath: this.relativePath,
				},
			);
		}
		return this._description;
	}

	private _folderName: string | undefined;
	get folderName() {
		if (this._folderName == null) {
			this._folderName = paths.dirname(this.uri.relativePath);
		}
		return this._folderName;
	}

	private _label: string | undefined;
	get label() {
		if (this._label == null) {
			this._label = StatusFileFormatter.fromTemplate(this.view.config.formats.files.label, this.file, {
				relativePath: this.relativePath,
			});
		}
		return this._label;
	}

	get priority(): number {
		return 0;
	}

	private _relativePath: string | undefined;
	get relativePath(): string | undefined {
		return this._relativePath;
	}
	set relativePath(value: string | undefined) {
		this._relativePath = value;
		this._label = undefined;
		this._description = undefined;
	}

	getCommand(): Command | undefined {
		return {
			title: 'Open File',
			command: BuiltInCommands.Open,
			arguments: [
				GitUri.resolveToUri(this.file.fileName, this.repoPath),
				{
					preserveFocus: true,
					preview: true,
				},
			],
		};
	}
}

export class MergeConflictCurrentChangesNode extends ViewNode {
	constructor(view: View, parent: ViewNode, private readonly status: GitMergeStatus, private readonly file: GitFile) {
		super(GitUri.fromFile(file, status.repoPath, 'HEAD'), view, parent);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Current changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeCurrentChanges;
		item.description = this.status.into;
		item.iconPath = new ThemeIcon('diff');
		item.tooltip = new MarkdownString(
			`Current changes to $(file) ${this.file.fileName} on $(git-branch) ${this.status.into}`,
			true,
		);
		item.command = this.getCommand();

		return item;
	}

	getCommand(): Command | undefined {
		if (this.status.mergeBase == null) {
			return {
				title: 'Open Revision',
				command: BuiltInCommands.Open,
				arguments: [GitUri.toRevisionUri('HEAD', this.file.fileName, this.status.repoPath)],
			};
		}

		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.fileName} (merge-base)`,
			},
			rhs: {
				sha: 'HEAD',
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.fileName} (${this.status.into})`,
			},
			repoPath: this.status.repoPath,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes',
			command: Commands.DiffWith,
			arguments: [commandArgs],
		};
	}
}

export class MergeConflictIncomingChangesNode extends ViewNode {
	constructor(view: View, parent: ViewNode, private readonly status: GitMergeStatus, private readonly file: GitFile) {
		super(GitUri.fromFile(file, status.repoPath, 'MERGE_HEAD'), view, parent);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Incoming changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeIncomingChanges;
		item.description = this.status.incoming;
		item.iconPath = new ThemeIcon('diff');
		item.tooltip = new MarkdownString(
			`Incoming changes to $(file) ${this.file.fileName}${
				this.status.incoming ? ` from $(git-branch) ${this.status.incoming}` : ''
			}`,
			true,
		);
		item.command = this.getCommand();

		return item;
	}

	getCommand(): Command | undefined {
		if (this.status.mergeBase == null) {
			return {
				title: 'Open Revision',
				command: BuiltInCommands.Open,
				arguments: [GitUri.toRevisionUri('MERGE_HEAD', this.file.fileName, this.status.repoPath)],
			};
		}

		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.fileName} (merge-base)`,
			},
			rhs: {
				sha: 'MERGE_HEAD',
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.fileName} (${this.status.incoming ? this.status.incoming : 'incoming'})`,
			},
			repoPath: this.status.repoPath,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes',
			command: Commands.DiffWith,
			arguments: [commandArgs],
		};
	}
}
