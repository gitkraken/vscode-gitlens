'use strict';
import * as paths from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { BuiltInCommands } from '../../constants';
import { FileNode } from './folderNode';
import { GitFile, GitMergeStatus, GitRebaseStatus, StatusFileFormatter } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { MergeConflictCurrentChangesNode } from './mergeConflictCurrentChangesNode';
import { MergeConflictIncomingChangesNode } from './mergeConflictIncomingChangesNode';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class MergeConflictFileNode extends ViewNode<ViewsWithCommits> implements FileNode {
	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly status: GitMergeStatus | GitRebaseStatus,
		public readonly file: GitFile,
	) {
		super(GitUri.fromFile(file, status.repoPath, status.HEAD.ref), view, parent);
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
