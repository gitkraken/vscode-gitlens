import type { Command } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import { GlCommand } from '../../constants.commands';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFile } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import { dirname, joinPaths } from '../../system/path';
import type { ViewsWithCommits } from '../viewBase';
import { getFileTooltipMarkdown, ViewFileNode } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import type { FileNode } from './folderNode';

export class UncommittedFileNode extends ViewFileNode<'uncommitted-file', ViewsWithCommits> implements FileNode {
	constructor(view: ViewsWithCommits, parent: ViewNode, repoPath: string, file: GitFile) {
		super('uncommitted-file', GitUri.fromFile(file, repoPath), view, parent, file);
	}

	override toClipboard(): string {
		return this.path;
	}

	get path(): string {
		return this.file.path;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.File;
		item.description = this.description;
		// Use the file icon and decorations
		item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);

		const icon = getGitFileStatusIcon(this.file.status);
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
			light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
		};

		item.tooltip = getFileTooltipMarkdown(this.file);
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
				{ ...this.file },
				{ relativePath: this.relativePath },
			);
		}
		return this._description;
	}

	private _folderName: string | undefined;
	get folderName() {
		if (this._folderName == null) {
			this._folderName = dirname(this.uri.relativePath);
		}
		return this._folderName;
	}

	private _label: string | undefined;
	get label() {
		if (this._label == null) {
			this._label = StatusFileFormatter.fromTemplate(
				`\${file}`,
				{ ...this.file },
				{ relativePath: this.relativePath },
			);
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

	override getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			uri: GitUri.fromFile(this.file, this.repoPath),
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes with Previous Revision',
			command: GlCommand.DiffWithPrevious,
			arguments: [undefined, commandArgs],
		};
	}
}
