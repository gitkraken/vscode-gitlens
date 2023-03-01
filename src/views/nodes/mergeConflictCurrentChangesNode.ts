import type { Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithCommandArgs } from '../../commands';
import { Commands, CoreCommands, GlyphChars } from '../../constants';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFile } from '../../git/models/file';
import type { GitMergeStatus } from '../../git/models/merge';
import type { GitRebaseStatus } from '../../git/models/rebase';
import { getReferenceLabel } from '../../git/models/reference';
import { configuration } from '../../system/configuration';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import type { ViewsWithCommits } from '../viewBase';
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
		const commit = await this.view.container.git.getCommit(this.status.repoPath, 'HEAD');

		const item = new TreeItem('Current changes', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeConflictCurrentChanges;
		item.description = `${getReferenceLabel(this.status.current, { expand: false, icon: false })}${
			commit != null ? ` (${getReferenceLabel(commit, { expand: false, icon: false })})` : ' (HEAD)'
		}`;
		item.iconPath = this.view.config.avatars
			? (await commit?.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })) ??
			  new ThemeIcon('diff')
			: new ThemeIcon('diff');

		const markdown = new MarkdownString(
			`Current changes to $(file)${GlyphChars.Space}${this.file.path} on ${getReferenceLabel(
				this.status.current,
			)}${
				commit != null
					? `\n\n${await CommitFormatter.fromTemplateAsync(
							`\${avatar}&nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\n\n\${link}\${' via 'pullRequest}`,
							commit,
							{
								avatarSize: 16,
								dateFormat: configuration.get('defaultDateFormat'),
								// messageAutolinks: true,
								messageIndent: 4,
								outputFormat: 'markdown',
							},
					  )}`
					: ''
			}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;
		item.command = this.getCommand();

		return item;
	}

	override getCommand(): Command | undefined {
		if (this.status.mergeBase == null) {
			return {
				title: 'Open Revision',
				command: CoreCommands.Open,
				arguments: [this.view.container.git.getRevisionUri('HEAD', this.file.path, this.status.repoPath)],
			};
		}

		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.path} (merge-base)`,
			},
			rhs: {
				sha: 'HEAD',
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.path} (${getReferenceLabel(this.status.current, {
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
