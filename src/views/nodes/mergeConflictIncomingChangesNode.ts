import type { Command } from 'vscode';
import { MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as nls from 'vscode-nls';
import type { DiffWithCommandArgs } from '../../commands';
import { configuration } from '../../configuration';
import { Commands, CoreCommands, GlyphChars } from '../../constants';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitFile } from '../../git/models/file';
import type { GitMergeStatus } from '../../git/models/merge';
import type { GitRebaseStatus } from '../../git/models/rebase';
import { GitReference } from '../../git/models/reference';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import type { ViewsWithCommits } from '../viewBase';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
export class MergeConflictIncomingChangesNode extends ViewNode<ViewsWithCommits | FileHistoryView | LineHistoryView> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		parent: ViewNode,
		private readonly status: GitMergeStatus | GitRebaseStatus,
		private readonly file: GitFile,
	) {
		super(GitUri.fromFile(file, status.repoPath, status.HEAD.ref), view, parent);
	}

	getChildren(): ViewNode[] {
		return [];
	}

	async getTreeItem(): Promise<TreeItem> {
		const commit = await this.view.container.git.getCommit(
			this.status.repoPath,
			this.status.type === 'rebase' ? this.status.steps.current.commit.ref : this.status.HEAD.ref,
		);

		const item = new TreeItem(localize('incomingChanges', 'Incoming changes'), TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.MergeConflictIncomingChanges;
		item.description = `${GitReference.toString(this.status.incoming, { expand: false, icon: false })}${
			this.status.type === 'rebase'
				? ` (${GitReference.toString(this.status.steps.current.commit, { expand: false, icon: false })})`
				: ` (${GitReference.toString(this.status.HEAD, { expand: false, icon: false })})`
		}`;
		item.iconPath = this.view.config.avatars
			? (await commit?.getAvatarUri({ defaultStyle: configuration.get('defaultGravatarsStyle') })) ??
			  new ThemeIcon('diff')
			: new ThemeIcon('diff');

		const markdown = new MarkdownString(
			this.status.incoming != null
				? localize(
						'incomingChangesToFileFromRef',
						'Incoming changes to {0} from {1}',
						`$(file)${GlyphChars.Space}${this.file.path}`,
						`${GitReference.toString(this.status.incoming)}${
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
								: this.status.type === 'rebase'
								? `\n\n${GitReference.toString(this.status.steps.current.commit, {
										capitalize: true,
										label: false,
								  })}`
								: `\n\n${GitReference.toString(this.status.HEAD, { capitalize: true, label: false })}`
						}`,
				  )
				: localize(
						'incomingChangesToFile',
						'Incoming changes to {0}',
						`$(file)${GlyphChars.Space}${this.file.path}`,
				  ),
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
				title: localize('openRevision', 'Open Revision'),
				command: CoreCommands.Open,
				arguments: [
					this.view.container.git.getRevisionUri(this.status.HEAD.ref, this.file.path, this.status.repoPath),
				],
			};
		}

		const commandArgs: DiffWithCommandArgs = {
			lhs: {
				sha: this.status.mergeBase,
				uri: GitUri.fromFile(this.file, this.status.repoPath, undefined, true),
				title: `${this.file.path} ${localize('mergeBase', '(merge-base)')}`,
			},
			rhs: {
				sha: this.status.HEAD.ref,
				uri: GitUri.fromFile(this.file, this.status.repoPath),
				title: `${this.file.path} (${
					this.status.incoming != null
						? GitReference.toString(this.status.incoming, { expand: false, icon: false })
						: localize('incoming', 'incoming')
				})`,
			},
			repoPath: this.status.repoPath,
			line: 0,
			showOptions: {
				preserveFocus: true,
				preview: true,
			},
		};
		return {
			title: localize('openChanges', 'Open Changes'),
			command: Commands.DiffWith,
			arguments: [commandArgs],
		};
	}
}
