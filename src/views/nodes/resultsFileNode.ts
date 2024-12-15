import type { Command } from 'vscode';
import { TreeItem, TreeItemCheckboxState, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import { GlCommand } from '../../constants.commands';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFile } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import type { GitRevisionReference } from '../../git/models/reference';
import { createReference } from '../../git/models/reference.utils';
import { joinPaths } from '../../system/path';
import { relativeDir } from '../../system/vscode/path';
import type { View } from '../viewBase';
import { getFileTooltipMarkdown } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues, getViewNodeId } from './abstract/viewNode';
import { ViewRefFileNode } from './abstract/viewRefNode';
import { getComparisonStoragePrefix } from './compareResultsNode';
import type { FileNode } from './folderNode';

type State = {
	checked: TreeItemCheckboxState;
};

export class ResultsFileNode extends ViewRefFileNode<'results-file', View, State> implements FileNode {
	constructor(
		view: View,
		parent: ViewNode,
		repoPath: string,
		file: GitFile,
		public readonly ref1: string,
		public readonly ref2: string,
		private readonly direction: 'ahead' | 'behind' | undefined,
	) {
		super('results-file', GitUri.fromFile(file, repoPath, ref1 || ref2), view, parent, file);

		this.updateContext({ file: file });
		if (this.context.storedComparisonId != null) {
			this._uniqueId = `${getComparisonStoragePrefix(this.context.storedComparisonId)}${this.direction}|${
				file.path
			}`;
		} else {
			this._uniqueId = getViewNodeId(this.type, this.context);
		}
	}

	override toClipboard(): string {
		return this.file.path;
	}

	get ref(): GitRevisionReference {
		return createReference(this.ref1 || this.ref2, this.uri.repoPath!);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.ResultsFile;
		item.description = this.description;
		item.tooltip = getFileTooltipMarkdown(this.file);

		const statusIcon = getGitFileStatusIcon(this.file.status);
		item.iconPath = {
			dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', statusIcon)),
			light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', statusIcon)),
		};

		item.command = this.getCommand();

		item.checkboxState = {
			state: this.getState('checked') ?? TreeItemCheckboxState.Unchecked,
			tooltip: 'Mark as Reviewed',
		};

		return item;
	}

	private _description: string | undefined;
	get description() {
		if (this._description === undefined) {
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
		if (this._folderName === undefined) {
			this._folderName = relativeDir(this.uri.relativePath);
		}
		return this._folderName;
	}

	private _label: string | undefined;
	get label() {
		if (this._label === undefined) {
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

	override getCommand(): Command | undefined {
		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.ref1,
				uri:
					(this.file.status === 'R' || this.file.status === 'C') && this.direction === 'behind'
						? GitUri.fromFile(this.file, this.uri.repoPath!, this.ref2, true)
						: this.uri,
			},
			rhs: {
				sha: this.ref2,
				uri:
					(this.file.status === 'R' || this.file.status === 'C') && this.direction !== 'behind'
						? GitUri.fromFile(this.file, this.uri.repoPath!, this.ref2, true)
						: this.uri,
			},
			repoPath: this.uri.repoPath!,

			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes',
			command: GlCommand.DiffWith,
			arguments: [commandArgs],
		};
	}
}
