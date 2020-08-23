'use strict';
import * as paths from 'path';
import { Command, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitFile, GitLogCommit, GitRevisionReference, StatusFileFormatter } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { View } from '../viewBase';
import { ContextValues, ViewNode, ViewRefFileNode } from './viewNode';

export class CommitFileNode extends ViewRefFileNode {
	constructor(
		view: View,
		parent: ViewNode,
		public readonly file: GitFile,
		public commit: GitLogCommit,
		private readonly _options: { displayAsCommit?: boolean; inFileHistory?: boolean; selection?: Selection } = {},
	) {
		super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent);
	}

	toClipboard(): string {
		return this._options.displayAsCommit ? this.commit.sha : this.fileName;
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
			if (commit === undefined) {
				const log = await Container.git.getLogForFile(this.repoPath, this.file.fileName, {
					limit: 2,
					ref: this.commit.sha,
				});
				if (log !== undefined) {
					this.commit = log.commits.get(this.commit.sha) ?? this.commit;
				}
			} else {
				this.commit = commit;
			}
		}

		const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
		item.contextValue = this.contextValye;
		item.description = this.description;
		item.tooltip = this.tooltip;

		if (this._options.displayAsCommit && this.view.config.avatars) {
			item.iconPath = this.commit.getAvatarUri(Container.config.defaultGravatarsStyle);
		} else {
			const icon = GitFile.getStatusIcon(this.file.status);
			item.iconPath = {
				dark: Container.context.asAbsolutePath(paths.join('images', 'dark', icon)),
				light: Container.context.asAbsolutePath(paths.join('images', 'light', icon)),
			};
		}

		item.command = this.getCommand();

		// Only cache the label/description/tooltip for a single refresh
		this._label = undefined;
		this._description = undefined;
		this._tooltip = undefined;

		return item;
	}

	protected get contextValye(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.inFileHistory ? '+history' : ''}`;
		}

		return this.commit.isUncommittedStaged ? `${ContextValues.File}+staged` : `${ContextValues.File}+unstaged`;
	}

	private _description: string | undefined;
	get description() {
		if (this._description === undefined) {
			this._description = this._options.displayAsCommit
				? CommitFormatter.fromTemplate(this.getCommitDescriptionTemplate(), this.commit, {
						truncateMessageAtNewLine: true,
						dateFormat: Container.config.defaultDateFormat,
				  })
				: StatusFileFormatter.fromTemplate(this.getCommitFileDescriptionTemplate(), this.file, {
						relativePath: this.relativePath,
				  });
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
			this._label = this._options.displayAsCommit
				? CommitFormatter.fromTemplate(this.getCommitTemplate(), this.commit, {
						truncateMessageAtNewLine: true,
						dateFormat: Container.config.defaultDateFormat,
				  })
				: StatusFileFormatter.fromTemplate(this.getCommitFileTemplate(), this.file, {
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
		this._tooltip = undefined;
	}

	private _tooltip: string | undefined;
	get tooltip() {
		if (this._tooltip === undefined) {
			if (this._options.displayAsCommit) {
				// eslint-disable-next-line no-template-curly-in-string
				const status = StatusFileFormatter.fromTemplate('${status}${ (originalPath)}', this.file); // lgtm [js/template-syntax-in-string-literal]
				this._tooltip = CommitFormatter.fromTemplate(
					this.commit.isUncommitted
						? `\${author} ${GlyphChars.Dash} \${id}\n${status}\n\${ago} (\${date})`
						: `\${author} ${
								GlyphChars.Dash
						  } \${id}\n${status}\n\${ago} (\${date})\n\n\${message}${this.commit.getFormattedDiffStatus({
								expand: true,
								prefix: '\n\n',
								separator: '\n',
						  })}`,
					this.commit,
					{
						dateFormat: Container.config.defaultDateFormat,
					},
				);
			} else {
				this._tooltip = StatusFileFormatter.fromTemplate(
					// eslint-disable-next-line no-template-curly-in-string
					'${file}\n${directory}/\n\n${status}${ (originalPath)}',
					this.file,
				);
			}
		}
		return this._tooltip;
	}

	protected getCommitTemplate() {
		return this.view.config.commitFormat;
	}

	protected getCommitDescriptionTemplate() {
		return this.view.config.commitDescriptionFormat;
	}

	protected getCommitFileTemplate() {
		return this.view.config.commitFileFormat;
	}

	protected getCommitFileDescriptionTemplate() {
		return this.view.config.commitFileDescriptionFormat;
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
