'use strict';
import * as paths from 'path';
import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { Container } from '../../container';
import { GitFile, GitLogCommit, StatusFileFormatter } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { Strings } from '../../system';
import { View } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { ResourceType, ViewNode } from './viewNode';

export class StatusFileNode extends ViewNode {
	public readonly commits: GitLogCommit[];
	public readonly file: GitFile;
	public readonly repoPath: string;

	private readonly _hasStagedChanges: boolean;
	private readonly _hasUnstagedChanges: boolean;

	constructor(view: View, parent: ViewNode, repoPath: string, file: GitFile, commits: GitLogCommit[]) {
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

		super(GitUri.fromFile(file, repoPath, ref), view, parent);

		this.repoPath = repoPath;
		this.file = file;
		this.commits = commits;

		this._hasStagedChanges = hasStagedChanges;
		this._hasUnstagedChanges = hasUnstagedChanges;
	}

	toClipboard(): string {
		return this.fileName;
	}

	get fileName(): string {
		return this.file.fileName;
	}

	getChildren(): ViewNode[] {
		return this.commits.map(c => new CommitFileNode(this.view, this, this.file, c, { displayAsCommit: true }));
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.description = this.description;

		if ((this._hasStagedChanges || this._hasUnstagedChanges) && this.commits.length === 1) {
			item.contextValue = ResourceType.File;
			if (this._hasStagedChanges) {
				item.contextValue += '+staged';
				item.tooltip = StatusFileFormatter.fromTemplate(
					// eslint-disable-next-line no-template-curly-in-string
					'${file}\n${directory}/\n\n${status}${ (originalPath)} in Index (staged)',
					this.file,
				);
			} else {
				item.contextValue += '+unstaged';
				item.tooltip = StatusFileFormatter.fromTemplate(
					// eslint-disable-next-line no-template-curly-in-string
					'${file}\n${directory}/\n\n${status}${ (originalPath)} in Working Tree',
					this.file,
				);
			}

			// Use the file icon and decorations
			item.resourceUri = GitUri.resolveToUri(this.file.fileName, this.repoPath);
			item.iconPath = ThemeIcon.File;

			item.command = this.getCommand();
		} else {
			item.collapsibleState = TreeItemCollapsibleState.Collapsed;
			if (this._hasStagedChanges || this._hasUnstagedChanges) {
				item.contextValue = ResourceType.File;
				if (this._hasStagedChanges && this._hasUnstagedChanges) {
					item.contextValue += '+staged+unstaged';
				} else if (this._hasStagedChanges) {
					item.contextValue += '+staged';
				} else {
					item.contextValue += '+unstaged';
				}

				// Use the file icon and decorations
				item.resourceUri = GitUri.resolveToUri(this.file.fileName, this.repoPath);
				item.iconPath = ThemeIcon.File;
			} else {
				item.contextValue = ResourceType.StatusFileCommits;

				const icon = GitFile.getStatusIcon(this.file.status);
				item.iconPath = {
					dark: Container.context.asAbsolutePath(paths.join('images', 'dark', icon)),
					light: Container.context.asAbsolutePath(paths.join('images', 'light', icon)),
				};
			}

			item.tooltip = StatusFileFormatter.fromTemplate(
				`\${file}\n\${directory}/\n\n\${status}\${ (originalPath)} in ${this.getChangedIn()}`,
				this.file,
			);
		}

		// Only cache the label/description for a single refresh
		this._label = undefined;
		this._description = undefined;

		return item;
	}

	private _description: string | undefined;
	get description() {
		if (this._description === undefined) {
			this._description = StatusFileFormatter.fromTemplate(
				this.view.config.statusFileDescriptionFormat,
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
		if (this._folderName === undefined) {
			this._folderName = paths.dirname(this.uri.relativePath);
		}
		return this._folderName;
	}

	private _label: string | undefined;
	get label() {
		if (this._label === undefined) {
			this._label = StatusFileFormatter.fromTemplate(
				this.view.config.statusFileFormat,
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
			changedIn.push(Strings.pluralize('commit', commits));
		}

		if (changedIn.length > 2) {
			changedIn[changedIn.length - 1] = `and ${changedIn[changedIn.length - 1]}`;
		}
		return changedIn.join(changedIn.length > 2 ? ', ' : ' and ');
	}

	getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Compare File with Previous Revision',
			command: Commands.DiffWithPrevious,
			arguments: [GitUri.fromFile(this.file, this.repoPath), commandArgs],
		};
	}
}
