'use strict';
import * as paths from 'path';
import { Command, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { Container } from '../../container';
import { GitBranch, GitFile, GitLogCommit, GitRevisionReference, StatusFileFormatter } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { View, ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode, ViewRefFileNode } from './viewNode';

export class CommitFileNode<TView extends View = ViewsWithCommits> extends ViewRefFileNode<TView> {
	constructor(
		view: TView,
		parent: ViewNode,
		public readonly file: GitFile,
		public commit: GitLogCommit,
		private readonly _options: {
			branch?: GitBranch;
			selection?: Selection;
			unpublished?: boolean;
		} = {},
	) {
		super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent);
	}

	toClipboard(): string {
		return this.fileName;
	}

	get fileName(): string {
		return this.file.fileName;
	}

	get priority(): number {
		return 0;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		if (!this.commit.isFile) {
			// See if we can get the commit directly from the multi-file commit
			const commit = this.commit.toFileCommit(this.file);
			if (commit == null) {
				const log = await Container.git.getLogForFile(this.repoPath, this.file.fileName, {
					limit: 2,
					ref: this.commit.sha,
				});
				if (log != null) {
					this.commit = log.commits.get(this.commit.sha) ?? this.commit;
				}
			} else {
				this.commit = commit;
			}
		}

		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = this.contextValue;
		item.description = this.description;
		item.tooltip = this.tooltip;

		const icon = GitFile.getStatusIcon(this.file.status);
		item.iconPath = {
			dark: Container.context.asAbsolutePath(paths.join('images', 'dark', icon)),
			light: Container.context.asAbsolutePath(paths.join('images', 'light', icon)),
		};

		item.command = this.getCommand();

		// Only cache the label for a single refresh (its only cached because it is used externally for sorting)
		this._label = undefined;

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.branch?.current ? '+current' : ''}${
				this._options.branch?.current && this._options.branch.sha === this.commit.ref ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.isUncommittedStaged ? `${ContextValues.File}+staged` : `${ContextValues.File}+unstaged`;
	}

	private get description() {
		return StatusFileFormatter.fromTemplate(this.view.config.formats.files.description, this.file, {
			relativePath: this.relativePath,
		});
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
			this._label = StatusFileFormatter.fromTemplate(this.view.config.formats.files.label, this.file, {
				relativePath: this.relativePath,
			});
		}
		return this._label;
	}

	private _relativePath: string | undefined;
	get relativePath(): string | undefined {
		return this._relativePath;
	}
	set relativePath(value: string | undefined) {
		this._relativePath = value;
		this._label = undefined;
	}

	private get tooltip() {
		return StatusFileFormatter.fromTemplate(
			// eslint-disable-next-line no-template-curly-in-string
			'${file}\n${directory}/\n\n${status}${ (originalPath)}',
			this.file,
		);
	}

	getCommand(): Command | undefined {
		let line;
		if (this.commit.line !== undefined) {
			line = this.commit.line.to.line - 1;
		} else {
			line = this._options.selection !== undefined ? this._options.selection.active.line : 0;
		}

		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: GitUri.fromFile(this.file, this.commit.repoPath),
			line: line,
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
}
