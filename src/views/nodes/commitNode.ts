import { Command, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { Colors, Commands } from '../../constants';
import { CommitFormatter } from '../../git/formatters';
import { GitBranch, GitCommit, GitRevisionReference } from '../../git/models';
import { makeHierarchical } from '../../system/array';
import { joinPaths, normalizePath } from '../../system/path';
import { sortCompare } from '../../system/string';
import { FileHistoryView } from '../fileHistoryView';
import { TagsView } from '../tagsView';
import { ViewsWithCommits } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { FileNode, FolderNode } from './folderNode';
import { PullRequestNode } from './pullRequestNode';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';

export class CommitNode extends ViewRefNode<ViewsWithCommits | FileHistoryView, GitRevisionReference> {
	constructor(
		view: ViewsWithCommits | FileHistoryView,
		parent: ViewNode,
		public readonly commit: GitCommit,
		private readonly unpublished?: boolean,
		public readonly branch?: GitBranch,
		private readonly getBranchAndTagTips?: (sha: string, options?: { compact?: boolean }) => string | undefined,
		private readonly _options: { expand?: boolean } = {},
	) {
		super(commit.getGitUri(), view, parent);
	}

	override toClipboard(): string {
		return `${this.commit.shortSha}: ${this.commit.summary}`;
	}

	get isTip(): boolean {
		return (this.branch?.current && this.branch.sha === this.commit.ref) ?? false;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		const commit = this.commit;

		const commits = await commit.getCommitsForFiles();
		let children: (PullRequestNode | FileNode)[] = commits.map(
			c => new CommitFileNode(this.view, this, c.file!, c),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children as FileNode[],
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			(children as FileNode[]).sort((a, b) => sortCompare(a.label!, b.label!));
		}

		if (!(this.view instanceof TagsView) && !(this.view instanceof FileHistoryView)) {
			if (this.view.config.pullRequests.enabled && this.view.config.pullRequests.showForCommits) {
				const pr = await commit.getAssociatedPullRequest();
				if (pr != null) {
					children.splice(0, 0, new PullRequestNode(this.view, this, pr, commit));
				}
			}
		}

		return children;
	}

	async getTreeItem(): Promise<TreeItem> {
		const label = CommitFormatter.fromTemplate(this.view.config.formats.commits.label, this.commit, {
			dateFormat: this.view.container.config.defaultDateFormat,
			getBranchAndTagTips: (sha: string) => this.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});

		const item = new TreeItem(
			label,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);

		item.contextValue = `${ContextValues.Commit}${this.branch?.current ? '+current' : ''}${
			this.isTip ? '+HEAD' : ''
		}${this.unpublished ? '+unpublished' : ''}`;

		item.description = CommitFormatter.fromTemplate(this.view.config.formats.commits.description, this.commit, {
			dateFormat: this.view.container.config.defaultDateFormat,
			getBranchAndTagTips: (sha: string) => this.getBranchAndTagTips?.(sha, { compact: true }),
			messageTruncateAtNewLine: true,
		});
		item.iconPath = this.unpublished
			? new ThemeIcon('arrow-up', new ThemeColor(Colors.UnpublishedCommitIconColor))
			: this.view.config.avatars
			? await this.commit.getAvatarUri({ defaultStyle: this.view.container.config.defaultGravatarsStyle })
			: new ThemeIcon('git-commit');
		// item.tooltip = this.tooltip;

		return item;
	}

	override getCommand(): Command | undefined {
		const commandArgs: DiffWithPreviousCommandArgs = {
			commit: this.commit,
			uri: this.uri,
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

	override async resolveTreeItem(item: TreeItem): Promise<TreeItem> {
		if (item.tooltip == null) {
			item.tooltip = await this.getTooltip();
		}
		return item;
	}

	private async getTooltip() {
		const remotes = await this.view.container.git.getRemotesWithProviders(this.commit.repoPath);
		const remote = await this.view.container.git.getRichRemoteProvider(remotes);

		if (this.commit.message == null) {
			await this.commit.ensureFullDetails();
		}

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			[autolinkedIssuesOrPullRequests, pr] = await Promise.all([
				this.view.container.autolinks.getIssueOrPullRequestLinks(
					this.commit.message ?? this.commit.summary,
					remote,
				),
				this.view.container.git.getPullRequestForCommit(this.commit.ref, remote.provider),
			]);
		}

		const tooltip = await CommitFormatter.fromTemplateAsync(
			`\${link}\${' via 'pullRequest}\${'&nbsp;&nbsp;\u2022&nbsp;&nbsp;'changesDetail}\${'&nbsp;&nbsp;&nbsp;&nbsp;'tips}\n\n\${avatar} &nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\${\n\n---\n\nfootnotes}`,
			this.commit,
			{
				autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
				dateFormat: this.view.container.config.defaultDateFormat,
				getBranchAndTagTips: this.getBranchAndTagTips,
				markdown: true,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: pr,
				remotes: remotes,
				unpublished: this.unpublished,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
