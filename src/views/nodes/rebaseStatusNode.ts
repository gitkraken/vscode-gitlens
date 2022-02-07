import { Command, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { Commands, CoreCommands } from '../../constants';
import { CommitFormatter } from '../../git/formatters';
import { GitUri } from '../../git/gitUri';
import { GitBranch, GitCommit, GitRebaseStatus, GitReference, GitRevisionReference, GitStatus } from '../../git/models';
import { makeHierarchical } from '../../system/array';
import { executeCoreCommand } from '../../system/command';
import { joinPaths, normalizePath } from '../../system/path';
import { pluralize, sortCompare } from '../../system/string';
import { ViewsWithCommits } from '../viewBase';
import { BranchNode } from './branchNode';
import { CommitFileNode } from './commitFileNode';
import { FileNode, FolderNode } from './folderNode';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';

export class RebaseStatusNode extends ViewNode<ViewsWithCommits> {
	static key = ':rebase';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}`;
	}

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly rebaseStatus: GitRebaseStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super(GitUri.fromRepoPath(rebaseStatus.repoPath), view, parent);
	}

	override get id(): string {
		return RebaseStatusNode.getId(this.rebaseStatus.repoPath, this.rebaseStatus.incoming.name, this.root);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	async getChildren(): Promise<ViewNode[]> {
		let children: FileNode[] =
			this.status?.conflicts.map(f => new MergeConflictFileNode(this.view, this, this.rebaseStatus, f)) ?? [];

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => sortCompare(a.label!, b.label!));
		}

		const commit = await this.view.container.git.getCommit(
			this.rebaseStatus.repoPath,
			this.rebaseStatus.steps.current.commit.ref,
		);
		if (commit != null) {
			children.splice(0, 0, new RebaseCommitNode(this.view, this, commit) as any);
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			`${this.status?.hasConflicts ? 'Resolve conflicts to continue rebasing' : 'Rebasing'} ${
				this.rebaseStatus.incoming != null
					? `${GitReference.toString(this.rebaseStatus.incoming, { expand: false, icon: false })}`
					: ''
			} (${this.rebaseStatus.steps.current.number}/${this.rebaseStatus.steps.total})`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Rebase;
		item.description = this.status?.hasConflicts ? pluralize('conflict', this.status.conflicts.length) : undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground'))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground'));

		const markdown = new MarkdownString(
			`${`Rebasing ${
				this.rebaseStatus.incoming != null ? GitReference.toString(this.rebaseStatus.incoming) : ''
			}onto ${GitReference.toString(this.rebaseStatus.current)}`}\n\nStep ${
				this.rebaseStatus.steps.current.number
			} of ${this.rebaseStatus.steps.total}\\\nPaused at ${GitReference.toString(
				this.rebaseStatus.steps.current.commit,
				{ icon: true },
			)}${this.status?.hasConflicts ? `\n\n${pluralize('conflicted file', this.status.conflicts.length)}` : ''}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}

	async openEditor() {
		const rebaseTodoUri = Uri.joinPath(this.uri, '.git', 'rebase-merge', 'git-rebase-todo');
		await executeCoreCommand(CoreCommands.OpenWith, rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}
}

export class RebaseCommitNode extends ViewRefNode<ViewsWithCommits, GitRevisionReference> {
	constructor(view: ViewsWithCommits, parent: ViewNode, public readonly commit: GitCommit) {
		super(commit.getGitUri(), view, parent);
	}

	override toClipboard(): string {
		return `${this.commit.shortSha}: ${this.commit.summary}`;
	}

	get ref(): GitRevisionReference {
		return this.commit;
	}

	async getChildren(): Promise<ViewNode[]> {
		const commit = this.commit;

		const commits = await commit.getCommitsForFiles();
		let children: FileNode[] = commits.map(c => new CommitFileNode(this.view, this, c.file!, c));

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => sortCompare(a.label!, b.label!));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(`Paused at commit ${this.commit.shortSha}`, TreeItemCollapsibleState.Collapsed);

		// item.contextValue = ContextValues.RebaseCommit;

		item.description = CommitFormatter.fromTemplate(`\${message}`, this.commit, {
			messageTruncateAtNewLine: true,
		});
		item.iconPath = new ThemeIcon('git-commit');

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
			`Rebase paused at \${link}\${' via 'pullRequest}\${'&nbsp;&nbsp;\u2022&nbsp;&nbsp;'changesDetail}\${'&nbsp;&nbsp;&nbsp;&nbsp;'tips}\n\n\${avatar} &nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\${\n\n---\n\nfootnotes}`,
			this.commit,
			{
				autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
				dateFormat: this.view.container.config.defaultDateFormat,
				markdown: true,
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: pr,
				remotes: remotes,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
