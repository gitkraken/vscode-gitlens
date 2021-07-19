'use strict';
import * as paths from 'path';
import {
	Command,
	MarkdownString,
	Selection,
	ThemeColor,
	ThemeIcon,
	TreeItem,
	TreeItemCollapsibleState,
	Uri,
} from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { Colors, GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
	CommitFormatter,
	GitBranch,
	GitFile,
	GitLogCommit,
	GitRevisionReference,
	StatusFileFormatter,
} from '../../git/git';
import { GitUri } from '../../git/gitUri';
import { FileHistoryView } from '../fileHistoryView';
import { LineHistoryView } from '../lineHistoryView';
import { ViewsWithCommits } from '../viewBase';
import { MergeConflictCurrentChangesNode } from './mergeConflictCurrentChangesNode';
import { MergeConflictIncomingChangesNode } from './mergeConflictIncomingChangesNode';
import { ContextValues, ViewNode, ViewRefFileNode } from './viewNode';

export class FileRevisionAsCommitNode extends ViewRefFileNode<ViewsWithCommits | FileHistoryView | LineHistoryView> {
	constructor(
		view: ViewsWithCommits | FileHistoryView | LineHistoryView,
		parent: ViewNode,
		public readonly file: GitFile,
		public commit: GitLogCommit,
		private readonly _options: {
			branch?: GitBranch;
			getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined;
			selection?: Selection;
			unpublished?: boolean;
		} = {},
	) {
		super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent);
	}

	override toClipboard(): string {
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

	get isTip(): boolean {
		return (this._options.branch?.current && this._options.branch.sha === this.commit.ref) ?? false;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (!this.commit.hasConflicts) return [];

		const [mergeStatus, rebaseStatus] = await Promise.all([
			Container.git.getMergeStatus(this.commit.repoPath),
			Container.git.getRebaseStatus(this.commit.repoPath),
		]);
		if (mergeStatus == null && rebaseStatus == null) return [];

		return [
			new MergeConflictCurrentChangesNode(this.view, this, (mergeStatus ?? rebaseStatus)!, this.file),
			new MergeConflictIncomingChangesNode(this.view, this, (mergeStatus ?? rebaseStatus)!, this.file),
		];
	}

	async getTreeItem(): Promise<TreeItem> {
		if (!this.commit.isFile) {
			// Try to get the commit directly from the multi-file commit
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
				getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
				messageTruncateAtNewLine: true,
			}),
			this.commit.hasConflicts ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None,
		);

		item.contextValue = this.contextValue;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: Container.config.defaultDateFormat,
			getBranchAndTagTips: (sha: string) => this._options.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		item.resourceUri = Uri.parse(`gitlens-view://commit-file/status/${this.file.status}`);

		if (!this.commit.isUncommitted && this.view.config.avatars) {
			item.iconPath = this._options.unpublished
				? new ThemeIcon('arrow-up', new ThemeColor(Colors.UnpublishedCommitIconColor))
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
				this.isTip ? '+HEAD' : ''
			}${this._options.unpublished ? '+unpublished' : ''}`;
		}

		return this.commit.hasConflicts
			? `${ContextValues.File}+conflicted`
			: this.commit.isUncommittedStaged
			? `${ContextValues.File}+staged`
			: `${ContextValues.File}+unstaged`;
	}

	override getCommand(): Command | undefined {
		let line;
		if (this.commit.line !== undefined) {
			line = this.commit.line.to.line - 1;
		} else {
			line = this._options.selection !== undefined ? this._options.selection.active.line : 0;
		}

		if (this.commit.hasConflicts) {
			return {
				title: 'Open Changes',
				command: Commands.DiffWith,
				arguments: [
					{
						lhs: {
							sha: 'MERGE_HEAD',
							uri: GitUri.fromFile(this.file, this.repoPath, undefined, true),
						},
						rhs: {
							sha: 'HEAD',
							uri: GitUri.fromFile(this.file, this.repoPath),
						},
						repoPath: this.repoPath,
						line: 0,
						showOptions: {
							preserveFocus: false,
							preview: false,
						},
					},
				],
			};
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

	override async resolveTreeItem(item: TreeItem): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip();
		}
		return item;
	}

	async getConflictBaseUri(): Promise<Uri | undefined> {
		if (!this.commit.hasConflicts) return undefined;

		const mergeBase = await Container.git.getMergeBase(this.repoPath, 'MERGE_HEAD', 'HEAD');
		return GitUri.fromFile(this.file, this.repoPath, mergeBase ?? 'HEAD');
	}

	private async getTooltip() {
		const remotes = await Container.git.getRemotes(this.commit.repoPath);
		const remote = await Container.git.getRichRemoteProvider(remotes);

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			[autolinkedIssuesOrPullRequests, pr] = await Promise.all([
				Container.autolinks.getIssueOrPullRequestLinks(this.commit.message, remote),
				Container.git.getPullRequestForCommit(this.commit.ref, remote.provider),
			]);
		}

		const status = StatusFileFormatter.fromTemplate(`\${status}\${ (originalPath)}`, this.file);
		const tooltip = await CommitFormatter.fromTemplateAsync(
			`\${'$(git-commit) 'id}\${' via 'pullRequest} \u2022 ${status}\${ \u2022 changesDetail}\${'&nbsp;&nbsp;&nbsp;'tips}\n\n\${avatar} &nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\${\n\n---\n\nfootnotes}`,
			this.commit,
			{
				autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
				dateFormat: Container.config.defaultDateFormat,
				getBranchAndTagTips: this._options.getBranchAndTagTips,
				markdown: true,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: pr,
				remotes: remotes,
				unpublished: this._options.unpublished,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.isTrusted = true;

		return markdown;
	}
}
