'use strict';
import { Command, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithCommandArgs } from '../../commands';
import { BuiltInCommands, GlyphChars } from '../../constants';
import { Container } from '../../container';
import { FileHistoryView } from '../fileHistoryView';
import { CommitFormatter, GitFile, GitMergeStatus, GitRebaseStatus, GitReference } from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { LineHistoryView } from '../lineHistoryView';
import { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

export class MergeConflictCurrentChangesNode extends ViewNode<ViewsWithCommits | FileHistoryView | LineHistoryView> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		parent: ViewNode,
		private readonly status: GitMergeStatus | GitRebaseStatus,
		private readonly file: GitFile,
	) {
		super(GitUri.fromFile(file, status.repoPath, 'HEAD'), view, parent);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const commit = await Container.git.getCommit(this.status.repoPath, 'HEAD');

		const item = new TreeItem('Current changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeConflictCurrentChanges;
		item.description = `${GitReference.toString(this.status.current, { expand: false, icon: false })}${
			commit != null ? ` (${GitReference.toString(commit, { expand: false, icon: false })})` : ' (HEAD)'
		}`;
		item.iconPath = this.view.config.avatars
			? (await commit?.getAvatarUri({ defaultStyle: Container.config.defaultGravatarsStyle })) ??
			  new ThemeIcon('diff')
			: new ThemeIcon('diff');
		item.tooltip = new MarkdownString(
			`Current changes to $(file)${GlyphChars.Space}${this.file.fileName} on ${GitReference.toString(
				this.status.current,
			)}${
				commit != null
					? `\n\n${await CommitFormatter.fromTemplateAsync(
							`$(git-commit)&nbsp;\${id} ${GlyphChars.Dash} \${avatar}&nbsp;__\${author}__, \${ago}\${' via 'pullRequest} &nbsp; _(\${date})_ \n\n\${message}`,
							commit,
							{
								avatarSize: 16,
								dateFormat: Container.config.defaultDateFormat,
								markdown: true,
								// messageAutolinks: true,
								messageIndent: 4,
							},
					  )}`
					: ''
			}`,
			true,
		);
		item.command = this.getCommand();

		return item;
	}

	getCommand(): Command | undefined {
		if (this.status.mergeBase == null) {
			return {
				title: 'Open Revision',
				command: BuiltInCommands.Open,
				arguments: [GitUri.toRevisionUri('HEAD', this.file.fileName, this.status.repoPath)],
			};
		}

		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.fileName} (merge-base)`,
			},
			rhs: {
				sha: 'HEAD',
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.fileName} (${GitReference.toString(this.status.current, {
					expand: false,
					icon: false,
				})})`,
			},
			repoPath: this.status.repoPath,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: 'Open Changes',
			command: Commands.DiffWith,
			arguments: [commandArgs],
		};
	}
}
