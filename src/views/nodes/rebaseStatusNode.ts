import type { Command } from 'vscode';
import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import type { DiffWithPreviousCommandArgs } from '../../commands';
import { configuration, ViewFilesLayout } from '../../configuration';
import { Commands, CoreCommands } from '../../constants';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitCommit } from '../../git/models/commit';
import type { GitRebaseStatus } from '../../git/models/rebase';
import type { GitRevisionReference } from '../../git/models/reference';
import { GitReference } from '../../git/models/reference';
import type { GitStatus } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { executeCoreCommand } from '../../system/command';
import { joinPaths, normalizePath } from '../../system/path';
import { getSettledValue } from '../../system/promise';
import { sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { BranchNode } from './branchNode';
import { CommitFileNode } from './commitFileNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { ContextValues, ViewNode, ViewRefNode } from './viewNode';

const localize = nls.loadMessageBundle();
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
			this.status?.conflicts.map(f => new MergeConflictFileNode(this.view, this, f, this.rebaseStatus)) ?? [];

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
			`${
				this.status?.hasConflicts
					? this.rebaseStatus.incoming != null
						? localize(
								'resolveConflictsToContinueRebasingBranch',
								'Resolve conflicts to continue rebasing {0}',
								GitReference.toString(this.rebaseStatus.incoming, { expand: false, icon: false }),
						  )
						: localize('resolveConflictsToContinueRebasing', 'Resolve conflicts to continue rebasing')
					: this.rebaseStatus.incoming != null
					? localize(
							'rebasingBranch',
							'Rebasing {0}',
							GitReference.toString(this.rebaseStatus.incoming, { expand: false, icon: false }),
					  )
					: localize('rebasing', 'Rebasing')
			} (${this.rebaseStatus.steps.current.number}/${this.rebaseStatus.steps.total})`,
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Rebase;
		item.description = this.status?.hasConflicts
			? this.status.conflicts.length === 1
				? localize('oneConflict', '1 conflict')
				: localize('conflicts', '{0} conflicts', this.status.conflicts.length)
			: undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground'))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground'));

		const markdown = new MarkdownString(
			`${
				this.rebaseStatus.incoming != null
					? localize(
							'rebasingBranchOntoBranch',
							'Rebasing {0} onto {1}',
							GitReference.toString(this.rebaseStatus.incoming),
							GitReference.toString(this.rebaseStatus.current),
					  )
					: localize(
							'rebasingOntoBranch',
							'Rebasing onto {0}',
							GitReference.toString(this.rebaseStatus.current),
					  )
			}
			\n\n${localize(
				'stepNumberOfTotal',
				'Step {0} of {1}',
				this.rebaseStatus.steps.current.number,
				this.rebaseStatus.steps.total,
			)}
			\\\n${localize(
				'pausedAtCommit',
				'Paused at {0}',
				GitReference.toString(this.rebaseStatus.steps.current.commit, { icon: true }),
			)}
			${
				this.status?.hasConflicts
					? `\n\n${
							this.status.conflicts.length === 1
								? localize('oneConflictedFile', '1 conflicted file')
								: localize('conflictedFiles', '{0} conflicted files', this.status.conflicts.length)
					  }`
					: ''
			}`,
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
		const item = new TreeItem(
			localize('pausedAtCommitSha', 'Paused at commit {0}', this.commit.shortSha),
			TreeItemCollapsibleState.Collapsed,
		);

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
			title: localize('openChangesWithPreviousRevision', 'Open Changes with Previous Revision'),
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
		const remote = await this.view.container.git.getBestRemoteWithRichProvider(remotes);

		if (this.commit.message == null) {
			await this.commit.ensureFullDetails();
		}

		let autolinkedIssuesOrPullRequests;
		let pr;

		if (remote?.provider != null) {
			const [autolinkedIssuesOrPullRequestsResult, prResult] = await Promise.allSettled([
				this.view.container.autolinks.getLinkedIssuesAndPullRequests(
					this.commit.message ?? this.commit.summary,
					remote,
				),
				this.commit.getAssociatedPullRequest({ remote: remote }),
			]);

			autolinkedIssuesOrPullRequests = getSettledValue(autolinkedIssuesOrPullRequestsResult);
			pr = getSettledValue(prResult);

			// Remove possible duplicate pull request
			if (pr != null) {
				autolinkedIssuesOrPullRequests?.delete(pr.id);
			}
		}

		const tooltip = await CommitFormatter.fromTemplateAsync(
			localize(
				'rebasePausedAt',
				'Rebase paused at {0}',
				`\${link}\${' via 'pullRequest}\${'&nbsp;&nbsp;\u2022&nbsp;&nbsp;'changesDetail}\${'&nbsp;&nbsp;&nbsp;&nbsp;'tips}\n\n\${avatar} &nbsp;__\${author}__, \${ago} &nbsp; _(\${date})_ \n\n\${message}\${\n\n---\n\nfootnotes}`,
			),
			this.commit,
			{
				autolinkedIssuesOrPullRequests: autolinkedIssuesOrPullRequests,
				dateFormat: configuration.get('defaultDateFormat'),
				messageAutolinks: true,
				messageIndent: 4,
				pullRequestOrRemote: pr,
				outputFormat: 'markdown',
				remotes: remotes,
			},
		);

		const markdown = new MarkdownString(tooltip, true);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		return markdown;
	}
}
