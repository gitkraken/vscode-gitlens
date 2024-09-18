import type { Command } from 'vscode';
import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../../commands/diffWithPrevious';
import { Commands } from '../../constants.commands';
import { StatusFileFormatter } from '../../git/formatters/statusFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import { getGitFileStatusIcon } from '../../git/models/file';
import { joinPaths } from '../../system/path';
import { pluralize } from '../../system/string';
import { relativeDir } from '../../system/vscode/path';
import type { ViewsWithCommits } from '../viewBase';
import { ViewFileNode } from './abstract/viewFileNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { FileRevisionAsCommitNode } from './fileRevisionAsCommitNode';
import type { FileNode } from './folderNode';

export class StatusFileNode extends ViewFileNode<'status-file', ViewsWithCommits> implements FileNode {
	public readonly commits: GitCommit[];

	private readonly _hasStagedChanges: boolean;
	private readonly _hasUnstagedChanges: boolean;
	private readonly _type: 'ahead' | 'behind' | 'working';

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		file: GitFile,
		repoPath: string,
		commits: GitCommit[],
		type: 'ahead' | 'behind' | 'working',
	) {
		let hasStagedChanges = false;
		let hasUnstagedChanges = false;
		let ref = undefined;
		for (const c of commits) {
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

		this.commits = commits;

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
		return this.commits.map(c => new FileRevisionAsCommitNode(this.view, this, this.file, c));
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.description = this.description;

		if ((this._hasStagedChanges || this._hasUnstagedChanges) && this.commits.length === 1) {
			item.contextValue = ContextValues.File;
			if (this._hasStagedChanges) {
				item.contextValue += '+staged';
				item.tooltip = StatusFileFormatter.fromTemplate(
					`\${file}\n\${directory}/\n\n\${status}\${ (originalPath)} in Index (staged)`,
					this.file,
				);
			} else {
				item.contextValue += '+unstaged';
				item.tooltip = StatusFileFormatter.fromTemplate(
					`\${file}\n\${directory}/\n\n\${status}\${ (originalPath)} in Working Tree`,
					this.file,
				);
			}

			// Use the file icon and decorations
			item.resourceUri = this.view.container.git.getAbsoluteUri(this.file.path, this.repoPath);
			item.iconPath = ThemeIcon.File;

			item.command = this.getCommand();
		} else {
			item.collapsibleState = TreeItemCollapsibleState.Collapsed;
			if (this._hasStagedChanges || this._hasUnstagedChanges) {
				item.contextValue = ContextValues.File;
				if (this._hasStagedChanges && this._hasUnstagedChanges) {
					item.contextValue += '+staged+unstaged';
				} else if (this._hasStagedChanges) {
					item.contextValue += '+staged';
				} else {
					item.contextValue += '+unstaged';
				}

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

			item.tooltip = StatusFileFormatter.fromTemplate(
				`\${file}\n\${directory}/\n\n\${status}\${ (originalPath)} in ${this.getChangedIn()}`,
				this.file,
			);

			item.command = this.getCommand();
		}

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
		return this.commits[0];
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

	private getChangedIn(): string {
		const changedIn = [];

		let commits = 0;

		if (this._hasUnstagedChanges) {
			commits++;
			changedIn.push('Working Tree');
		}

		if (this._hasStagedChanges) {
			commits++;
			changedIn.push('Index (staged)');
		}

		if (this.commits.length > commits) {
			commits = this.commits.length - commits;
		}

		if (commits > 0) {
			changedIn.push(pluralize('commit', commits));
		}

		if (changedIn.length > 2) {
			changedIn[changedIn.length - 1] = `and ${changedIn[changedIn.length - 1]}`;
		}
		return changedIn.join(changedIn.length > 2 ? ', ' : ' and ');
	}

	override getCommand(): Command | undefined {
		if ((this._hasStagedChanges || this._hasUnstagedChanges) && this.commits.length === 1) {
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
				command: Commands.DiffWithPrevious,
				arguments: [undefined, commandArgs],
			};
		}

		let commandArgs: DiffWithCommandArgs;
		switch (this._type) {
			case 'ahead':
			case 'behind': {
				const lhs = this.commits[this.commits.length - 1];
				const rhs = this.commits[0];

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
				const commit = this.commits[this.commits.length - 1];
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
			command: Commands.DiffWith,
			arguments: [commandArgs],
		};
	}
}
