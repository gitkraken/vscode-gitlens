import type { Command, Uri } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFile } from '../../git/models/file';
import type { GitMergeStatus } from '../../git/models/merge';
import type { GitRebaseStatus } from '../../git/models/rebase';
import { createCoreCommand } from '../../system/vscode/command';
import { relativeDir } from '../../system/vscode/path';
import type { ViewsWithCommits } from '../viewBase';
import { getFileTooltipMarkdown, ViewFileNode } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import type { FileNode } from './folderNode';
import { MergeConflictCurrentChangesNode } from './mergeConflictCurrentChangesNode';
import { MergeConflictIncomingChangesNode } from './mergeConflictIncomingChangesNode';

export class MergeConflictFileNode extends ViewFileNode<'conflict-file', ViewsWithCommits> implements FileNode {
	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		file: GitFile,
		public readonly status: GitMergeStatus | GitRebaseStatus,
	) {
		super('conflict-file', GitUri.fromFile(file, status.repoPath, status.HEAD.ref), view, parent, file);
	}

	override toClipboard(): string {
		return this.fileName;
	}

	get baseUri(): Uri {
		return GitUri.fromFile(this.file, this.status.repoPath, this.status.mergeBase ?? 'HEAD');
	}

	get fileName(): string {
		return this.file.path;
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

		item.tooltip = getFileTooltipMarkdown(this.file, 'in ```Index```');

		// Use the file icon and decorations
		item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);
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
			this._folderName = relativeDir(this.uri.relativePath);
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

	override getCommand(): Command {
		return createCoreCommand(
			'vscode.open',
			'Open File',
			this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath),
			{
				preserveFocus: true,
				preview: true,
			},
		);
	}
}
