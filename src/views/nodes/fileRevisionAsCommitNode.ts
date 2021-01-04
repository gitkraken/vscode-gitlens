'use strict';
import * as paths from 'path';
import { Command, Selection, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { FileHistoryView } from '../fileHistoryView';
import {
	CommitFormatter,
	GitBranch,
	GitFile,
	GitLogCommit,
	GitRevisionReference,
	StatusFileFormatter,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { LineHistoryView } from '../lineHistoryView';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode, ViewRefFileNode } from './viewNode';

export class FileRevisionAsCommitNode extends ViewRefFileNode<ViewsWithCommits | FileHistoryView | LineHistoryView> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
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
		let message = this.commit.message;
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${GlyphChars.Space}${GlyphChars.Ellipsis}`;
		}

		return `${this.commit.shortSha}: ${message}`;
	}

	get fileName(): string {
		return this.file.fileName;
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

		const item = new TreeItem(
			CommitFormatter.fromTemplate(this.view.config.formats.commits.label, this.commit, {
				dateFormat: Container.config.defaultDateFormat,
				messageTruncateAtNewLine: true,
			}),
			TreeItemCollapsibleState.None,
		);

		item.contextValue = this.contextValue;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			messageTruncateAtNewLine: true,
		});

		// eslint-disable-next-line no-template-curly-in-string
		const status = StatusFileFormatter.fromTemplate('${status}${ (originalPath)}', this.file); // lgtm [js/template-syntax-in-string-literal]
		item.tooltip = CommitFormatter.fromTemplate(
			this.commit.isUncommitted
				? `\${author} ${GlyphChars.Dash} \${id}\n${status}\n\${ago} (\${date})`
				: `\${author}\${ (email)} ${GlyphChars.Dash} \${id}${
						this._options.unpublished ? ' (unpublished)' : ''
				  }\n${status}\n\${ago} (\${date})\${\n\nmessage}${this.commit.getFormattedDiffStatus({
						expand: true,
						prefix: '\n\n',
						separator: '\n',
				  })}\${\n\n${GlyphChars.Dash.repeat(2)}\nfootnotes}`,
			this.commit,
			{
				dateFormat: Container.config.defaultDateFormat,
				// messageAutolinks: true,
				messageIndent: 4,
			},
		);

		if (!this.commit.isUncommitted && this.view.config.avatars) {
			item.iconPath = this._options.unpublished
				? new ThemeIcon('arrow-up', new ThemeColor('gitlens.viewCommitToPushIconColor'))
				: await this.commit.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle });
		}

		if (item.iconPath == null) {
			const icon = GitFile.getStatusIcon(this.file.status);
			item.iconPath = {
				dark: Container.context.asAbsolutePath(paths.join('images', 'dark', icon)),
				light: Container.context.asAbsolutePath(paths.join('images', 'light', icon)),
			};
		}

		item.command = this.getCommand();

		return item;
	}

	protected get contextValue(): string {
		if (!this.commit.isUncommitted) {
			return `${ContextValues.File}+committed${this._options.branch?.current ? '+current' : ''}${
				this._options.branch?.current && this._options.branch.sha === this.commit.ref ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.hasConflicts
			? `${ContextValues.File}+conflicted`
			: this.commit.isUncommittedStaged
			? `${ContextValues.File}+staged`
			: `${ContextValues.File}+unstaged`;
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
