import type { Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import { GlCommand } from '../../constants.commands';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFileWithCommit } from '../../git/models/file';
import { getGitFileStatusIcon, isGitFileChange } from '../../git/models/file';
import { shortenRevision } from '../../git/models/revision.utils';
import { joinPaths } from '../../system/path';
import { relativeDir } from '../../system/vscode/path';
import type { ViewsWithCommits } from '../viewBase';
import { getFileTooltip, ViewFileNode } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode';
import type { FileNode } from './folderNode';

export class StatusFileNode extends ViewFileNode<'status-file', ViewsWithCommits> implements FileNode {
	private readonly _files: GitFileWithCommit[];
	private readonly _hasStagedChanges: boolean;
	private readonly _hasUnstagedChanges: boolean;
	private readonly _type: 'ahead' | 'behind' | 'working';

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		repoPath: string,
		files: GitFileWithCommit[],
		type: 'ahead' | 'behind' | 'working',
	) {
		let file;
		for (const f of files.reverse()) {
			if (file == null) {
				file = f;
			} else if (file.status === 'M' || f.status !== 'M') {
				file = f;
			}
		}
		file ??= files[files.length - 1];

		let hasStagedChanges = false;
		let hasUnstagedChanges = false;
		let ref;
		for (const { commit: c } of files) {
			if (c.isUncommitted) {
				if (c.isUncommittedStaged) {
					hasStagedChanges = true;
					if (!hasUnstagedChanges) {
						ref = c.sha;
					}

					break;
				} else {
					ref = undefined;
					hasUnstagedChanges = true;
				}
			} else if (hasUnstagedChanges) {
				break;
			} else {
				ref = c.sha;
				break;
			}
		}

		super('status-file', GitUri.fromFile(file, repoPath, ref), view, parent, file);

		this._files = files;
		this._type = type;
		this._hasStagedChanges = hasStagedChanges;
		this._hasUnstagedChanges = hasUnstagedChanges;
	}

	override toClipboard(): string {
		return this.fileName;
	}

	get fileName(): string {
		return this.file.path;
	}

	getChildren(): ViewNode[] {
		return this._files.map(f => new FileRevisionAsCommitNode(this.view, this, f, f.commit));
	}

	getTreeItem(): TreeItem {
		const isSingleChange = this._files.length === 1;
		const item = new TreeItem(
			this.label,
			isSingleChange ? TreeItemCollapsibleState.None : TreeItemCollapsibleState.Collapsed,
		);
		item.description = this.description;
		item.command = this.getCommand();

		function getStatusSuffix(f: GitFileWithCommit) {
			return isSingleChange
				? ''
				: `in \`\`\`${f.commit.isUncommitted ? '' : '$(git-commit) '}${shortenRevision(f.commit.sha)}\`\`\``;
		}

		let tooltip = this._files
			.map(
				f =>
					`${getFileTooltip(f, getStatusSuffix(f))}${
						isGitFileChange(f) && f.stats != null ? '\n\n' : '\\\n'
					}`,
			)
			.join('')
			.trim();
		if (tooltip.endsWith('\\')) {
			tooltip = tooltip.slice(0, -1);
		}
		item.tooltip = new MarkdownString(tooltip, true);

		if (this._hasStagedChanges || this._hasUnstagedChanges) {
			item.contextValue = ContextValues.File;
			item.contextValue += this._hasStagedChanges ? '+staged' : '';
			item.contextValue += this._hasUnstagedChanges ? '+unstaged' : '';

			// Use the file icon and decorations
			item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);
			item.iconPath = ThemeIcon.File;
		} else {
			item.contextValue = ContextValues.StatusFileCommits;

			const icon = getGitFileStatusIcon(this.file.status);
			item.iconPath = {
				dark: this.view.container.context.asAbsolutePath(joinPaths('images', 'dark', icon)),
				light: this.view.container.context.asAbsolutePath(joinPaths('images', 'light', icon)),
			};
		}
		// }

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
				{
					...this.file,
					commit: this.commit,
				},
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
			this._label = StatusFileFormatter.fromTemplate(
				this.view.config.formats.files.label,
				{
					...this.file,
					commit: this.commit,
				},
				{
					relativePath: this.relativePath,
				},
			);
		}
		return this._label;
	}

	get commit() {
		return this._files[0]?.commit;
	}

	get priority(): number {
		if (this._hasStagedChanges && !this._hasUnstagedChanges) return -3;
		if (this._hasStagedChanges) return -2;
		if (this._hasUnstagedChanges) return -1;
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
		if ((this._hasStagedChanges || this._hasUnstagedChanges) && this._files.length === 1) {
			const commandArgs: DiffWithPreviousCommandArgs = {
				commit: this.commit,
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

		let commandArgs: DiffWithCommandArgs;
		switch (this._type) {
			case 'ahead':
			case 'behind': {
				const lhs = this._files[this._files.length - 1].commit;
				const rhs = this._files[0].commit;

				commandArgs = {
					lhs: {
						sha: `${lhs.sha}^`,
						uri: GitUri.fromFile(
							lhs.files?.find(f => f.path === this.file.path) ?? this.file.path,
							this.repoPath,
							`${lhs.sha}^`,
							true,
						),
					},
					rhs: {
						sha: rhs.sha,
						uri: GitUri.fromFile(
							rhs.files?.find(f => f.path === this.file.path) ?? this.file.path,
							this.repoPath,
							rhs.sha,
						),
					},
					repoPath: this.repoPath,
					line: 0,
					showOptions: {
						preserveFocus: true,
						preview: true,
					},
				};
				break;
			}
			default: {
				const commit = this._files[this._files.length - 1].commit;
				const file = commit.files?.find(f => f.path === this.file.path) ?? this.file;
				commandArgs = {
					lhs: {
						sha: `${commit.sha}^`,
						uri: GitUri.fromFile(file, this.repoPath, undefined, true),
					},
					rhs: {
						sha: '',
						uri: GitUri.fromFile(this.file, this.repoPath),
					},
					repoPath: this.repoPath,
					line: 0,
					showOptions: {
						preserveFocus: true,
						preview: true,
					},
				};
				break;
			}
		}

		return {
			title: 'Open Changes',
			command: GlCommand.DiffWith,
			arguments: [commandArgs],
		};
	}
}
