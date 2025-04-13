import type { TextDocumentShowOptions } from 'vscode';
import { Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import { getTempFile } from '@env/platform';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens';
import type { DiffWithCommandArgs } from '../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../commands/diffWithPrevious';
import type { DiffWithWorkingCommandArgs } from '../commands/diffWithWorking';
import type { GenerateChangelogCommandArgs } from '../commands/generateChangelog';
import { generateChangelogAndOpenMarkdownDocument } from '../commands/generateChangelog';
import type { OpenFileAtRevisionCommandArgs } from '../commands/openFileAtRevision';
import type { OpenOnRemoteCommandArgs } from '../commands/openOnRemote';
import type { ViewShowBranchComparison } from '../config';
import { GlyphChars } from '../constants';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import { browseAtRevision, executeGitCommand } from '../git/actions';
import * as BranchActions from '../git/actions/branch';
import * as CommitActions from '../git/actions/commit';
import * as ContributorActions from '../git/actions/contributor';
import { abortPausedOperation, continuePausedOperation, skipPausedOperation } from '../git/actions/pausedOperation';
import * as RemoteActions from '../git/actions/remote';
import * as RepoActions from '../git/actions/repository';
import * as StashActions from '../git/actions/stash';
import * as TagActions from '../git/actions/tag';
import * as WorktreeActions from '../git/actions/worktree';
import { GitUri } from '../git/gitUri';
import type { PullRequest } from '../git/models/pullRequest';
import { RemoteResourceType } from '../git/models/remoteResource';
import type { Repository } from '../git/models/repository';
import { deletedOrMissing } from '../git/models/revision';
import {
	ensurePullRequestRefs,
	getOpenedPullRequestRepo,
	getOrOpenPullRequestRepository,
} from '../git/utils/-webview/pullRequest.utils';
import { matchContributor } from '../git/utils/contributor.utils';
import { getComparisonRefsForPullRequest, getRepositoryIdentityForPullRequest } from '../git/utils/pullRequest.utils';
import { createReference } from '../git/utils/reference.utils';
import { shortenRevision } from '../git/utils/revision.utils';
import { showPatchesView } from '../plus/drafts/actions';
import { getPullRequestBranchDeepLink } from '../plus/launchpad/launchpadProvider';
import type { AssociateIssueWithBranchCommandArgs } from '../plus/startWork/startWork';
import { showContributorsPicker } from '../quickpicks/contributorsPicker';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	executeEditorCommand,
	registerCommand,
} from '../system/-webview/command';
import { configuration } from '../system/-webview/configuration';
import { setContext } from '../system/-webview/context';
import { revealInFileExplorer } from '../system/-webview/vscode';
import type { MergeEditorInputs } from '../system/-webview/vscode/editors';
import { openMergeEditor } from '../system/-webview/vscode/editors';
import { openUrl } from '../system/-webview/vscode/uris';
import type { OpenWorkspaceLocation } from '../system/-webview/vscode/workspaces';
import { openWorkspace } from '../system/-webview/vscode/workspaces';
import { filterMap } from '../system/array';
import { createCommandDecorator } from '../system/decorators/command';
import { log } from '../system/decorators/log';
import { runSequentially } from '../system/function';
import { join, map } from '../system/iterable';
import { lazy } from '../system/lazy';
import { basename } from '../system/path';
import { getSettledValue } from '../system/promise';
import { DeepLinkActionType } from '../uris/deepLinks/deepLink';
import type { LaunchpadItemNode } from './launchpadView';
import type { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
import type { ClipboardType } from './nodes/abstract/viewNode';
import {
	canEditNode,
	canViewDismissNode,
	getNodeRepoPath,
	isPageableViewNode,
	ViewNode,
} from './nodes/abstract/viewNode';
import { ViewRefFileNode, ViewRefNode } from './nodes/abstract/viewRefNode';
import type { BranchesNode } from './nodes/branchesNode';
import type { BranchNode } from './nodes/branchNode';
import type { BranchTrackingStatusFilesNode } from './nodes/branchTrackingStatusFilesNode';
import type { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import type { CommitFileNode } from './nodes/commitFileNode';
import type { CommitNode } from './nodes/commitNode';
import type { PagerNode } from './nodes/common';
import type { CompareResultsNode } from './nodes/compareResultsNode';
import type { ContributorNode } from './nodes/contributorNode';
import type { DraftNode } from './nodes/draftNode';
import type { FileHistoryNode } from './nodes/fileHistoryNode';
import type { FileRevisionAsCommitNode } from './nodes/fileRevisionAsCommitNode';
import type { FolderNode } from './nodes/folderNode';
import type { LineHistoryNode } from './nodes/lineHistoryNode';
import type { MergeConflictFileNode } from './nodes/mergeConflictFileNode';
import type { PausedOperationStatusNode } from './nodes/pausedOperationStatusNode';
import type { PullRequestNode } from './nodes/pullRequestNode';
import type { RemoteNode } from './nodes/remoteNode';
import type { RepositoryNode } from './nodes/repositoryNode';
import type { ResultsCommitsNode } from './nodes/resultsCommitsNode';
import type { ResultsFileNode } from './nodes/resultsFileNode';
import type { ResultsFilesNode } from './nodes/resultsFilesNode';
import { FilesQueryFilter } from './nodes/resultsFilesNode';
import type { StashFileNode } from './nodes/stashFileNode';
import type { StashNode } from './nodes/stashNode';
import type { StatusFileNode } from './nodes/statusFileNode';
import type { TagNode } from './nodes/tagNode';
import type { TagsNode } from './nodes/tagsNode';
import type { WorktreeNode } from './nodes/worktreeNode';
import type { WorktreesNode } from './nodes/worktreesNode';

const { command, getCommands } = createCommandDecorator<
	(...args: any[]) => unknown,
	GlCommands,
	{
		multiselect?: boolean | 'sequential';
		args?: (...args: unknown[]) => unknown[];
	}
>();

export type CopyNodeCommandArgs = [active: ViewNode | undefined, selection: readonly ViewNode[]];

export class ViewCommands implements Disposable {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		const subscriptions: Disposable[] = [];
		for (const { command, handler, options } of getCommands()) {
			subscriptions.push(registerViewCommand(command, handler, this, options));
		}
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	@command('gitlens.views.copy', { args: (a, s) => [a, s, 'text' satisfies ClipboardType] })
	@command('gitlens.views.copyAsMarkdown', { args: (a, s) => [a, s, 'markdown' satisfies ClipboardType] })
	@log()
	private async copyNode(active: ViewNode | undefined, selection: ViewNode[], type: ClipboardType): Promise<void> {
		selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
		if (selection.length === 0) return;

		const data = join(
			filterMap(await Promise.allSettled(map(selection, n => n.toClipboard?.(type))), r =>
				r.status === 'fulfilled' && r.value?.trim() ? r.value : undefined,
			),
			'\n',
		);

		await env.clipboard.writeText(data);
	}

	@command('gitlens.views.copyUrl', { args: (a, s) => [a, s, true] })
	@command('gitlens.views.copyUrl.multi', { args: (a, s) => [a, s, true], multiselect: true })
	@command('gitlens.views.openUrl', { args: (a, s) => [a, s, false] })
	@command('gitlens.views.openUrl.multi', { args: (a, s) => [a, s, false], multiselect: true })
	@log()
	private async copyOrOpenNodeUrls(
		active: ViewNode | undefined,
		selection: ViewNode[],
		clipboard?: boolean,
	): Promise<void> {
		selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
		if (!selection.length) return;

		const urls = [
			...filterMap(await Promise.allSettled(map(selection, n => n.getUrl?.())), r =>
				r.status === 'fulfilled' && r.value?.trim() ? r.value : undefined,
			),
		];
		if (!urls.length) return;

		if (clipboard) {
			await env.clipboard.writeText(urls.join('\n'));
			return;
		}

		if (urls.length > 10) {
			const confirm = { title: 'Open' };
			const cancel = { title: 'Cancel', isCloseAffordance: true };
			const result = await window.showWarningMessage(
				`Are you sure you want to open ${urls.length} URLs?`,
				{ modal: true },
				confirm,
				cancel,
			);
			if (result !== confirm) return;
		}

		for (const url of urls) {
			if (url == null) continue;

			void openUrl(url);
		}
	}

	@command('gitlens.views.copyRemoteCommitUrl', { args: (a, s) => [a, s, true] })
	@command('gitlens.views.copyRemoteCommitUrl.multi', { args: (a, s) => [a, s, true], multiselect: true })
	@command('gitlens.views.openCommitOnRemote', { args: (a, s) => [a, s, false] })
	@command('gitlens.views.openCommitOnRemote.multi', { args: (a, s) => [a, s, false], multiselect: true })
	@log()
	private copyOrOpenCommitsOnRemote(active: ViewRefNode, selection?: ViewRefNode[], clipboard?: boolean) {
		const refs = selection?.length ? selection.map(n => n.ref) : [active.ref];

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: refs[0].repoPath,
			resource: refs.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@command('gitlens.views.collapseNode')
	@log()
	private collapseNode() {
		return executeCoreCommand('list.collapseAllToFocus');
	}

	@command('gitlens.views.dismissNode')
	@log()
	private dismissNode(node: ViewNode) {
		if (!canViewDismissNode(node.view)) return;

		node.view.dismissNode(node);
	}

	@command('gitlens.views.editNode')
	@log()
	private editNode(node: ViewNode) {
		if (!canEditNode(node)) return;

		return node.edit();
	}

	@command('gitlens.views.expandNode')
	@log()
	private expandNode(node: ViewNode) {
		return node.view.reveal(node, { select: false, focus: false, expand: 3 });
	}

	@command('gitlens.views.loadMoreChildren')
	@log()
	private loadMoreChildren(node: PagerNode) {
		return node.loadMore();
	}

	@command('gitlens.views.loadAllChildren')
	@log()
	private loadAllChildren(node: PagerNode) {
		return node.loadAll();
	}

	@command('gitlens.views.refreshNode', { multiselect: 'sequential' })
	@log()
	private refreshNode(node: ViewNode, reset?: boolean) {
		if (reset == null && isPageableViewNode(node)) {
			node.limit = undefined;
			node.view.resetNodeLastKnownLimit(node);
		}

		return node.view.refreshNode(node, reset == null ? true : reset);
	}

	@command('gitlens.views.addAuthors')
	@log()
	private addAuthors(node?: ViewNode) {
		return ContributorActions.addAuthors(getNodeRepoPath(node));
	}

	@command('gitlens.views.addAuthor')
	@command('gitlens.views.addAuthor.multi', { multiselect: true })
	@log()
	private addAuthor(node?: ContributorNode, nodes?: ContributorNode[]) {
		if (!node?.is('contributor')) return Promise.resolve();

		const contributors = nodes?.length ? nodes.map(n => n.contributor) : [node.contributor];
		return ContributorActions.addAuthors(
			node.repoPath,
			contributors.filter(c => !c.current),
		);
	}

	@command('gitlens.views.addRemote')
	@log()
	private addRemote(node?: ViewNode) {
		return RemoteActions.add(getNodeRepoPath(node));
	}

	@command('gitlens.views.addPullRequestRemote')
	@log()
	private async addPullRequestRemote(node: ViewNode, pr: PullRequest, repo: Repository) {
		const identity = getRepositoryIdentityForPullRequest(pr);
		if (identity.remote?.url == null) return;

		await repo.git.remotes().addRemote?.(identity.provider.repoDomain, identity.remote.url, { fetch: true });
		return node.triggerChange(true);
	}

	@command('gitlens.views.applyChanges')
	@log()
	private applyChanges(node: ViewRefFileNode) {
		if (node.is('results-file')) {
			return CommitActions.applyChanges(
				node.file,
				createReference(node.ref1, node.repoPath),
				createReference(node.ref2, node.repoPath),
			);
		}

		if (!(node instanceof ViewRefFileNode) || node.ref == null || node.ref.ref === 'HEAD') return Promise.resolve();

		return CommitActions.applyChanges(node.file, node.ref);
	}

	@command('gitlens.views.stash.apply')
	@log()
	private applyStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.apply(node.repoPath, node.commit);
	}

	@command('gitlens.views.browseRepoAtRevision')
	@command('gitlens.views.browseRepoAtRevisionInNewWindow', { args: n => [n, { openInNewWindow: true }] })
	@command('gitlens.views.browseRepoBeforeRevision', { args: n => [n, { before: true }] })
	@command('gitlens.views.browseRepoBeforeRevisionInNewWindow', {
		args: n => [n, { before: true, openInNewWindow: true }],
	})
	@log()
	private browseRepoAtRevision(
		node: ViewRefNode | ViewRefFileNode,
		options?: { before?: boolean; openInNewWindow?: boolean },
	) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return Promise.resolve();

		return browseAtRevision(node.uri, {
			before: options?.before,
			openInNewWindow: options?.openInNewWindow,
		});
	}

	@command('gitlens.views.cherryPick')
	@command('gitlens.views.cherryPick.multi', { multiselect: true })
	@log()
	private cherryPick(node: CommitNode, nodes?: CommitNode[]) {
		if (!node.is('commit')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.ref) : [node.ref];
		return RepoActions.cherryPick(node.repoPath, refs);
	}

	@command('gitlens.views.clearComparison')
	@log()
	private clearComparison(node: ViewNode) {
		if (node.is('compare-branch')) {
			void node.clear();
		}
	}

	@command('gitlens.views.clearReviewed')
	@log()
	private clearReviewed(node: ViewNode) {
		let compareNode;
		if (node.is('results-files')) {
			compareNode = node.getParent();
			if (compareNode == null) return;
		} else {
			compareNode = node;
		}

		if (compareNode.isAny('compare-branch', 'compare-results')) {
			compareNode.clearReviewed();
		}
	}

	@command('gitlens.views.closeRepository')
	@log()
	private closeRepository(node: RepositoryNode | RepositoryFolderNode): void {
		if (!node.isAny('repository', 'repo-folder')) return;

		node.repo.closed = true;
	}

	@command('gitlens.views.title.createBranch', { args: () => [] })
	@command('gitlens.views.createBranch')
	@log()
	private async createBranch(node?: ViewRefNode | ViewRefFileNode | BranchesNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node?.is('tracking-status')
				  ? node.branch
				  : undefined;
		if (from == null) {
			const repo = node?.repoPath
				? this.container.git.getRepository(node.repoPath)
				: this.container.git.getBestRepository();
			if (repo == null) return;

			const branch = await repo.git.branches().getBranch();
			from = branch;
		}
		return BranchActions.create(node?.repoPath, from);
	}

	@command('gitlens.views.createPullRequest')
	@log()
	private async createPullRequest(node: BranchNode | BranchTrackingStatusNode) {
		if (!node.isAny('branch', 'tracking-status')) return Promise.resolve();

		const remote = await node.branch.getRemote();

		return executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
			repoPath: node.repoPath,
			remote:
				remote != null
					? {
							name: remote.name,
							provider:
								remote.provider != null
									? {
											id: remote.provider.id,
											name: remote.provider.name,
											domain: remote.provider.domain,
									  }
									: undefined,
							url: remote.url,
					  }
					: undefined,
			branch: {
				name: node.branch.name,
				upstream: node.branch.upstream?.name,
				isRemote: node.branch.remote,
			},
		});
	}

	@command('gitlens.views.title.createTag', { args: () => [] })
	@command('gitlens.views.createTag')
	@log()
	private async createTag(node?: ViewRefNode | ViewRefFileNode | TagsNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node?.is('tracking-status')
				  ? node.branch
				  : undefined;
		if (from == null) {
			const repo = node?.repoPath
				? this.container.git.getRepository(node.repoPath)
				: this.container.git.getBestRepository();
			if (repo == null) return;

			const branch = await repo.git.branches().getBranch();
			from = branch;
		}
		return TagActions.create(node?.repoPath, from);
	}

	@command('gitlens.views.title.createWorktree', { args: () => [] })
	@command('gitlens.views.createWorktree')
	@log()
	private async createWorktree(node?: BranchNode | WorktreesNode) {
		if (node?.is('worktrees')) {
			node = undefined;
		}
		if (node != null && !node.is('branch')) return undefined;

		return WorktreeActions.create(node?.repoPath, undefined, node?.ref);
	}

	@command('gitlens.views.deleteBranch')
	@command('gitlens.views.deleteBranch.multi', { multiselect: true })
	@log()
	private deleteBranch(node: BranchNode, nodes?: BranchNode[]) {
		if (!node.is('branch')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.branch) : [node.branch];
		return BranchActions.remove(node.repoPath, refs);
	}

	@command('gitlens.views.stash.delete')
	@command('gitlens.views.stash.delete.multi', { multiselect: true })
	@log()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!node.is('stash')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.commit) : [node.commit];
		return StashActions.drop(node.repoPath, refs);
	}

	@command('gitlens.views.stash.rename')
	@log()
	private renameStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.rename(node.repoPath, node.commit);
	}

	@command('gitlens.views.deleteTag')
	@command('gitlens.views.deleteTag.multi', { multiselect: true })
	@log()
	private deleteTag(node: TagNode, nodes?: TagNode[]) {
		if (!node.is('tag')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.tag) : [node.tag];
		return TagActions.remove(node.repoPath, refs);
	}

	@command('gitlens.views.deleteWorktree')
	@command('gitlens.views.deleteWorktree.multi', { multiselect: true })
	@log()
	private async deleteWorktree(node: WorktreeNode, nodes?: WorktreeNode[]) {
		if (!node.is('worktree')) return undefined;

		const worktrees = nodes?.length ? nodes.map(n => n.worktree) : [node.worktree];
		const uris = worktrees.filter(w => !w.isDefault && !w.opened).map(w => w.uri);
		return WorktreeActions.remove(node.repoPath, uris);
	}

	@command('gitlens.views.fetch')
	@log()
	private fetch(node: RemoteNode | RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.fetch(node.repo);
		if (node.is('remote')) return RemoteActions.fetch(node.remote.repoPath, node.remote.name);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.fetch(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

	@command('gitlens.views.highlightChanges')
	@log()
	private async highlightChanges(node: CommitFileNode | StashFileNode | FileRevisionAsCommitNode | ResultsFileNode) {
		if (!node.isAny('commit-file', 'stash-file', 'file-commit', 'results-file')) return;

		await this.openFile(node, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: node.ref.ref },
			true,
		));
	}

	@command('gitlens.views.highlightRevisionChanges')
	@log()
	private async highlightRevisionChanges(
		node: CommitFileNode | StashFileNode | FileRevisionAsCommitNode | ResultsFileNode,
	) {
		if (!node.isAny('commit-file', 'stash-file', 'file-commit', 'results-file')) return;

		await this.openFile(node, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: node.ref.ref, only: true },
			true,
		));
	}

	@command('gitlens.views.mergeBranchInto')
	@log()
	private merge(node: BranchNode | TagNode) {
		if (!node.isAny('branch', 'tag')) return Promise.resolve();

		return RepoActions.merge(node.repoPath, node.is('branch') ? node.branch : node.tag);
	}

	@command('gitlens.views.openBranchOnRemote')
	@command('gitlens.views.openBranchOnRemote.multi', { multiselect: 'sequential' })
	@log()
	private openBranchOnRemote(node: BranchNode) {
		return executeCommand('gitlens.openBranchOnRemote', node);
	}

	@command('gitlens.views.openInTerminal')
	@log()
	private openInTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInTerminal', Uri.file(node.repoPath));
	}

	@command('gitlens.views.openInIntegratedTerminal')
	@log()
	private openInIntegratedTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInIntegratedTerminal', Uri.file(node.repoPath));
	}

	@command('gitlens.views.abortPausedOperation')
	@log()
	private async abortPausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await abortPausedOperation(this.container, node.pausedOpStatus.repoPath);
	}

	@command('gitlens.views.continuePausedOperation')
	@log()
	private async continuePausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await continuePausedOperation(this.container, node.pausedOpStatus.repoPath);
	}

	@command('gitlens.views.skipPausedOperation')
	@log()
	private async skipPausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await skipPausedOperation(this.container, node.pausedOpStatus.repoPath);
	}

	@command('gitlens.views.openPausedOperationInRebaseEditor')
	@log()
	private async openPausedOperationInRebaseEditor(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status') || node.pausedOpStatus.type !== 'rebase') return;

		const gitDir = await this.container.git.config(node.repoPath).getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.views.openPullRequest')
	@log()
	private openPullRequest(node: PullRequestNode) {
		if (!node.is('pullrequest')) return Promise.resolve();

		return executeActionCommand<OpenPullRequestActionContext>('openPullRequest', {
			repoPath: node.uri.repoPath!,
			provider: {
				id: node.pullRequest.provider.id,
				name: node.pullRequest.provider.name,
				domain: node.pullRequest.provider.domain,
			},
			pullRequest: {
				id: node.pullRequest.id,
				url: node.pullRequest.url,
			},
		});
	}

	@command('gitlens.views.openPullRequestChanges')
	@log()
	private async openPullRequestChanges(node: PullRequestNode | LaunchpadItemNode) {
		if (!node.is('pullrequest') && !node.is('launchpad-item')) return Promise.resolve();

		const pr = node.pullRequest;
		if (pr?.refs?.base == null || pr?.refs.head == null) return Promise.resolve();

		const repo = await getOpenedPullRequestRepo(this.container, pr, node.repoPath);
		if (repo == null) return Promise.resolve();

		const refs = getComparisonRefsForPullRequest(repo.path, pr.refs);
		const counts = await ensurePullRequestRefs(
			pr,
			repo,
			{ promptMessage: `Unable to open changes for PR #${pr.id} because of a missing remote.` },
			refs,
		);
		if (counts == null) return Promise.resolve();

		return CommitActions.openComparisonChanges(
			this.container,
			{
				repoPath: refs.repoPath,
				lhs: refs.base.ref,
				rhs: refs.head.ref,
			},
			{
				title: `Changes in Pull Request #${pr.id}`,
			},
		);
	}

	@command('gitlens.views.openPullRequestComparison')
	@log()
	private async openPullRequestComparison(node: PullRequestNode | LaunchpadItemNode) {
		if (!node.is('pullrequest') && !node.is('launchpad-item')) return Promise.resolve();

		const pr = node.pullRequest;
		if (pr?.refs?.base == null || pr?.refs.head == null) return Promise.resolve();

		const repo = await getOpenedPullRequestRepo(this.container, pr, node.repoPath);
		if (repo == null) return Promise.resolve();

		const refs = getComparisonRefsForPullRequest(repo.path, pr.refs);
		const counts = await ensurePullRequestRefs(
			pr,
			repo,
			{ promptMessage: `Unable to open comparison for PR #${pr.id} because of a missing remote.` },
			refs,
		);
		if (counts == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
	}

	@command('gitlens.views.draft.open')
	@log()
	private async openDraft(node: DraftNode) {
		await showPatchesView({ mode: 'view', draft: node.draft });
	}

	@command('gitlens.views.draft.openOnWeb')
	@log()
	private async openDraftOnWeb(node: DraftNode) {
		const url = this.container.drafts.generateWebUrl(node.draft);
		await openUrl(url);
	}

	@command('gitlens.views.openWorktree')
	@command('gitlens.views.openWorktreeInNewWindow', { args: a => [a, undefined, { location: 'newWindow' }] })
	@command('gitlens.views.openWorktreeInNewWindow.multi', {
		args: (a, s) => [a, s, { location: 'newWindow' }],
		multiselect: true,
	})
	@log()
	private async openWorktree(
		active: BranchNode | WorktreeNode,
		selection?: (BranchNode | WorktreeNode)[],
		options?: { location?: OpenWorkspaceLocation },
	) {
		if (!active.is('branch') && !active.is('worktree')) return;
		if (active.worktree == null) return;

		let uri;
		if (selection?.length && options?.location === 'newWindow') {
			type VSCodeWorkspace = {
				folders: ({ name: string; path: string } | { name: string; uri: Uri })[];
				settings: { [key: string]: unknown };
			};

			// TODO@eamodio hash the folder paths to get a unique, but re-usable workspace name?
			const codeWorkspace: VSCodeWorkspace = {
				folders: filterMap(selection, n =>
					n.worktree != null ? { name: n.worktree.name, path: n.worktree.uri.fsPath } : undefined,
				),
				settings: {},
			};
			uri = Uri.file(getTempFile(`worktrees-${Date.now()}.code-workspace`));

			await workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(codeWorkspace, null, 2)));
		} else {
			uri = active.worktree.uri;
		}

		openWorkspace(uri, options);
	}

	@command('gitlens.views.openInWorktree')
	@log()
	private async openInWorktree(node: BranchNode | PullRequestNode | LaunchpadItemNode) {
		if (!node.is('branch') && !node.is('pullrequest') && !node.is('launchpad-item')) return;

		if (node.is('branch')) {
			const pr = await node.branch.getAssociatedPullRequest();
			if (pr != null) {
				const remoteUrl =
					(await node.branch.getRemote())?.url ?? getRepositoryIdentityForPullRequest(pr).remote.url;
				if (remoteUrl != null) {
					const deepLink = getPullRequestBranchDeepLink(
						this.container,
						pr,
						node.branch.getNameWithoutRemote(),
						remoteUrl,
						DeepLinkActionType.SwitchToPullRequestWorktree,
					);

					return this.container.deepLinks.processDeepLinkUri(deepLink, false, node.repo);
				}
			}

			return executeGitCommand({
				command: 'switch',
				state: {
					repos: node.repo,
					reference: node.branch,
					worktreeDefaultOpen: 'new',
				},
			});
		}

		if (node.is('pullrequest') || node.is('launchpad-item')) {
			const pr = node.pullRequest;
			if (pr?.refs?.head == null) return Promise.resolve();

			const repoIdentity = getRepositoryIdentityForPullRequest(pr);
			if (repoIdentity.remote.url == null) return Promise.resolve();

			const deepLink = getPullRequestBranchDeepLink(
				this.container,
				pr,
				pr.refs.head.branch,
				repoIdentity.remote.url,
				DeepLinkActionType.SwitchToPullRequestWorktree,
			);

			const prRepo = await getOrOpenPullRequestRepository(this.container, pr, {
				skipVirtual: true,
			});
			return this.container.deepLinks.processDeepLinkUri(deepLink, false, prRepo);
		}
	}

	@command('gitlens.views.pruneRemote')
	@log()
	private pruneRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.prune(node.remote.repoPath, node.remote.name);
	}

	@command('gitlens.views.removeRemote')
	@log()
	private async removeRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.remove(node.remote.repoPath, node.remote.name);
	}

	@command('gitlens.views.publishBranch')
	@log()
	private publishBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.push(node.repoPath, undefined, node.branch);
		}
		return Promise.resolve();
	}

	@command('gitlens.views.publishRepository')
	@log()
	private publishRepository(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return executeCoreGitCommand('git.publish', Uri.file(node.repoPath));
		}
		return Promise.resolve();
	}

	@command('gitlens.views.pull')
	@log()
	private pull(node: RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.pull(node.repo);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.pull(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

	@command('gitlens.views.push', { args: n => [n, false] })
	@command('gitlens.views.pushWithForce', { args: n => [n, true] })
	@log()
	private push(
		node:
			| RepositoryNode
			| RepositoryFolderNode
			| BranchNode
			| BranchTrackingStatusNode
			| CommitNode
			| FileRevisionAsCommitNode,
		force?: boolean,
	) {
		if (node.isAny('repository', 'repo-folder')) {
			return RepoActions.push(node.repo, force);
		}

		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.push(node.repoPath, force, node.root ? undefined : node.branch);
		}

		if (node.isAny('commit', 'file-commit')) {
			if (node.isTip) {
				return RepoActions.push(node.repoPath, force);
			}

			return this.pushToCommit(node);
		}

		return Promise.resolve();
	}

	@command('gitlens.views.pushToCommit')
	@log()
	private pushToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.push(node.repoPath, false, node.commit);
	}

	@command('gitlens.views.rebaseOntoBranch')
	@command('gitlens.views.rebaseOntoCommit')
	@log()
	private rebase(node: BranchNode | CommitNode | FileRevisionAsCommitNode | TagNode) {
		if (!node.isAny('branch', 'commit', 'file-commit', 'tag')) {
			return Promise.resolve();
		}

		return RepoActions.rebase(node.repoPath, node.ref);
	}

	@command('gitlens.views.rebaseOntoUpstream')
	@log()
	private rebaseToRemote(node: BranchNode | BranchTrackingStatusNode) {
		if (!node.isAny('branch', 'tracking-status')) return Promise.resolve();

		const upstream = node.is('branch') ? node.branch.upstream?.name : node.status.upstream?.name;
		if (upstream == null) return Promise.resolve();

		return RepoActions.rebase(
			node.repoPath,
			createReference(upstream, node.repoPath, {
				refType: 'branch',
				name: upstream,
				remote: true,
			}),
		);
	}

	@command('gitlens.views.renameBranch')
	@log()
	private renameBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return BranchActions.rename(node.repoPath, node.branch);
	}

	@command('gitlens.views.resetCommit')
	@log()
	private resetCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(`${node.ref.ref}^`, node.ref.repoPath, {
				refType: 'revision',
				name: `${node.ref.name}^`,
				message: node.ref.message,
			}),
		);
	}

	@command('gitlens.views.resetToCommit')
	@log()
	private resetToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.reset(node.repoPath, node.ref);
	}

	@command('gitlens.views.resetToTip')
	@log()
	private resetToTip(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(node.ref.ref, node.repoPath, { refType: 'revision', name: node.ref.name }),
		);
	}

	@command('gitlens.views.restore')
	@log()
	private restore(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.restoreFile(node.file, node.ref);
	}

	@command('gitlens.views.revealRepositoryInExplorer')
	@log()
	private revealRepositoryInExplorer(node: RepositoryNode) {
		if (!node.is('repository')) return undefined;

		return revealInFileExplorer(node.repo.uri);
	}

	@command('gitlens.views.revealWorktreeInExplorer')
	@log()
	private revealWorktreeInExplorer(nodeOrUrl: WorktreeNode | string) {
		if (typeof nodeOrUrl === 'string') return revealInFileExplorer(Uri.parse(nodeOrUrl));
		if (!nodeOrUrl.is('worktree')) return undefined;

		return revealInFileExplorer(nodeOrUrl.worktree.uri);
	}

	@command('gitlens.views.revert')
	@log()
	private revert(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.revert(node.repoPath, node.ref);
	}

	@command('gitlens.views.setAsDefault')
	@log()
	private setAsDefault(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return node.setAsDefault();
	}

	@command('gitlens.views.setBranchComparisonToWorking', {
		args: n => [n, 'working' satisfies ViewShowBranchComparison],
	})
	@command('gitlens.views.setBranchComparisonToBranch', {
		args: n => [n, 'branch' satisfies ViewShowBranchComparison],
	})
	@log()
	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!node.is('compare-branch')) return undefined;

		return node.setComparisonType(comparisonType);
	}

	@command('gitlens.views.setShowRelativeDateMarkersOn', { args: () => [true] })
	@command('gitlens.views.setShowRelativeDateMarkersOff', { args: () => [false] })
	@log()
	private setShowRelativeDateMarkers(enabled: boolean) {
		return configuration.updateEffective('views.showRelativeDateMarkers', enabled);
	}

	@command('gitlens.views.setContributorsStatisticsOff', { args: () => [false] })
	@command('gitlens.views.setContributorsStatisticsOn', { args: () => [true] })
	@log()
	private setContributorsStatistics(enabled: boolean) {
		return configuration.updateEffective('views.showContributorsStatistics', enabled);
	}

	@command('gitlens.views.stageFile')
	@log()
	private async stageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit') && !node.is('status-file')) {
			return;
		}

		await this.container.git.staging(node.repoPath)?.stageFile(node.file.path);
		void node.triggerChange();
	}

	@command('gitlens.views.stageDirectory')
	@log()
	private async stageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.staging(node.repoPath)?.stageDirectory(node.relativePath);
		void node.triggerChange();
	}

	@command('gitlens.views.star')
	@command('gitlens.views.star.multi', { multiselect: 'sequential' })
	@log()
	private async star(node: BranchNode | RepositoryNode | RepositoryFolderNode): Promise<void> {
		if (!node.isAny('branch', 'repository', 'repo-folder')) {
			return Promise.resolve();
		}

		return node.star();
	}

	@command('gitlens.views.switchToAnotherBranch')
	@log()
	private switch(node?: ViewNode) {
		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@command('gitlens.views.switchToBranch')
	@command('gitlens.views.switchToCommit')
	@command('gitlens.views.switchToTag')
	@log()
	private switchTo(node?: ViewNode) {
		if (node instanceof ViewRefNode) {
			return RepoActions.switchTo(node.repoPath, node.is('branch') && node.branch.current ? undefined : node.ref);
		}

		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@command('gitlens.views.undoCommit')
	@log()
	private async undoCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return;

		await CommitActions.undoCommit(this.container, node.ref);
	}

	@command('gitlens.views.unsetAsDefault')
	@log()
	private unsetAsDefault(node: RemoteNode): Promise<void> {
		if (!node.is('remote')) return Promise.resolve();

		return node.setAsDefault(false);
	}

	@command('gitlens.views.unstageFile')
	@log()
	private async unstageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit', 'status-file')) return;

		await this.container.git.staging(node.repoPath)?.unstageFile(node.file.path);
		void node.triggerChange();
	}

	@command('gitlens.views.unstageDirectory')
	@log()
	private async unstageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.staging(node.repoPath)?.unstageDirectory(node.relativePath);
		void node.triggerChange();
	}

	@command('gitlens.views.unstar')
	@command('gitlens.views.unstar.multi', { multiselect: 'sequential' })
	@log()
	private async unstar(node: BranchNode | RepositoryNode | RepositoryFolderNode): Promise<void> {
		if (!node.isAny('branch', 'repository', 'repo-folder')) return Promise.resolve();

		return node.unstar();
	}

	@command('gitlens.views.compareWithHead')
	@log()
	private async compareHeadWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, 'HEAD');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		const [ref1, ref2] = await CommitActions.getOrderedComparisonRefs(
			this.container,
			node.repoPath,
			'HEAD',
			node.ref.ref,
		);
		return this.container.views.searchAndCompare.compare(node.repoPath, ref1, ref2);
	}

	@command('gitlens.views.compareBranchWithHead')
	@log()
	private compareBranchWithHead(node: BranchNode) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, 'HEAD');
	}

	@command('gitlens.views.compareWithMergeBase')
	@log()
	private async compareWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.branches(node.repoPath).getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.refs(node.repoPath).getMergeBase(branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref.ref, {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.views.openChangedFileDiffsWithMergeBase')
	@log()
	private async openChangedFileDiffsWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.branches(node.repoPath).getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.refs(node.repoPath).getMergeBase(branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return CommitActions.openComparisonChanges(
			this.container,
			{ repoPath: node.repoPath, lhs: commonAncestor, rhs: node.ref.ref },
			{
				title: `Changes between ${branch.ref} (${shortenRevision(commonAncestor)}) ${
					GlyphChars.ArrowLeftRightLong
				} ${shortenRevision(node.ref.ref, { strings: { working: 'Working Tree' } })}`,
			},
		);
	}

	@command('gitlens.views.compareWithUpstream')
	@log()
	private compareWithUpstream(node: BranchNode) {
		if (!node.is('branch') || node.branch.upstream == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@command('gitlens.views.compareWithWorking')
	@log()
	private compareWorkingWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, '');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, '', node.ref);
	}

	@command('gitlens.views.compareAncestryWithWorking')
	@log()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!node.is('branch')) return undefined;

		const branch = await this.container.git.branches(node.repoPath).getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.refs(node.repoPath).getMergeBase(branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, '', {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.views.compareWithSelected')
	@log()
	private compareWithSelected(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.views.searchAndCompare.compareWithSelected(node.repoPath, node.ref);
	}

	@command('gitlens.views.selectForCompare')
	@log()
	private selectForCompare(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.views.searchAndCompare.selectForCompare(node.repoPath, node.ref);
	}

	private async compareFileWith(
		repoPath: string,
		lhsUri: Uri,
		lhsRef: string,
		rhsUri: Uri | undefined,
		rhsRef: string,
	) {
		if (rhsUri == null) {
			rhsUri = await this.container.git.getWorkingUri(repoPath, lhsUri);
		}

		return executeCommand<DiffWithCommandArgs, void>('gitlens.diffWith', {
			repoPath: repoPath,
			lhs: {
				sha: lhsRef,
				uri: lhsUri,
			},
			rhs: {
				sha: rhsRef,
				uri: rhsUri ?? lhsUri,
			},
		});
	}

	@command('gitlens.views.compareFileWithSelected')
	@log()
	private compareFileWithSelected(node: ViewRefFileNode) {
		if (this._selectedFile == null || !(node instanceof ViewRefFileNode) || node.ref == null) {
			return Promise.resolve();
		}

		if (this._selectedFile.repoPath !== node.repoPath) {
			this.selectFileForCompare(node);
			return Promise.resolve();
		}

		const selected = this._selectedFile;

		this._selectedFile = undefined;
		void setContext('gitlens:views:canCompare:file', false);

		return this.compareFileWith(selected.repoPath!, selected.uri!, selected.ref, node.uri, node.ref.ref);
	}

	private _selectedFile: CompareSelectedInfo | undefined;

	@command('gitlens.views.selectFileForCompare')
	@log()
	private selectFileForCompare(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode) || node.ref == null) return;

		this._selectedFile = {
			ref: node.ref.ref,
			repoPath: node.repoPath,
			uri: node.uri,
		};
		void setContext('gitlens:views:canCompare:file', true);
	}

	@command('gitlens.views.openChangedFileDiffs', { args: (n, o) => [n, o] })
	@command('gitlens.views.openChangedFileDiffsIndividually', { args: (n, o) => [n, o, true] })
	@log()
	private async openAllChanges(
		node:
			| BranchTrackingStatusFilesNode
			| BranchTrackingStatusNode
			| CompareResultsNode
			| CommitNode
			| ResultsFilesNode
			| StashNode,
		options?: TextDocumentShowOptions & { title?: string },
		individually?: boolean,
	) {
		if (node.isAny('compare-results', 'results-files', 'tracking-status', 'tracking-status-files')) {
			const comparison = await node.getFilesComparison();
			if (!comparison?.files.length) return undefined;

			if (comparison.title != null) {
				options = { ...options, title: comparison.title };
			}

			return CommitActions.openMultipleChanges(
				this.container,
				comparison.files,
				{ repoPath: comparison.repoPath, lhs: comparison.ref1, rhs: comparison.ref2 },
				individually,
				options,
			);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openCommitChanges(this.container, node.commit, individually, options);
	}

	@command('gitlens.views.openChanges')
	@log()
	private openChanges(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('conflict-file')) {
			void executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				lhs: {
					sha: node.status.HEAD.ref,
					uri: GitUri.fromFile(node.file, node.repoPath, undefined, true),
				},
				rhs: {
					sha: 'HEAD',
					uri: GitUri.fromFile(node.file, node.repoPath),
				},
				repoPath: node.repoPath,
				line: 0,
				showOptions: {
					preserveFocus: false,
					preview: false,
				},
			});

			return;
		}

		if (!(node instanceof ViewRefFileNode) && !node.is('status-file')) return;

		const command = node.getCommand();
		if (command?.arguments == null) return;

		switch (command.command) {
			case 'gitlens.diffWith' satisfies GlCommands: {
				const [args] = command.arguments as [DiffWithCommandArgs];
				args.showOptions!.preview = false;
				void executeCommand<DiffWithCommandArgs>(command.command, args);
				break;
			}
			case 'gitlens.diffWithPrevious' satisfies GlCommands: {
				const [, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
				args.showOptions!.preview = false;
				void executeEditorCommand<DiffWithPreviousCommandArgs>(command.command, undefined, args);
				break;
			}
			default:
				throw new Error(`Unexpected command: ${command.command}`);
		}

		// TODO@eamodio Revisit this
		// return CommitActions.openChanges(node.file, node instanceof ViewRefFileNode ? node.ref : node.commit, {
		// 	preserveFocus: true,
		// 	preview: false,
		// });
	}

	@command('gitlens.views.openChangedFileDiffsWithWorking', { args: (n, o) => [n, o] })
	@command('gitlens.views.openChangedFileDiffsWithWorkingIndividually', { args: (n, o) => [n, o, true] })
	@log()
	private async openAllChangesWithWorking(
		node:
			| BranchTrackingStatusFilesNode
			| BranchTrackingStatusNode
			| CompareResultsNode
			| CommitNode
			| ResultsFilesNode
			| StashNode,
		options?: TextDocumentShowOptions & { title?: string },
		individually?: boolean,
	) {
		if (node.isAny('compare-results', 'results-files', 'tracking-status', 'tracking-status-files')) {
			const comparison = await node.getFilesComparison();
			if (!comparison?.files.length) return undefined;

			return CommitActions.openMultipleChangesWithWorking(
				this.container,
				comparison.files,
				{ repoPath: comparison.repoPath, ref: comparison.ref1 || comparison.ref2 },
				individually,
				options,
			);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openCommitChangesWithWorking(this.container, node.commit, individually, options);
	}

	@command('gitlens.views.mergeChangesWithWorking')
	@log()
	private async mergeChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return Promise.resolve();

		const nodeUri = await this.container.git.getBestRevisionUri(node.repoPath, node.file.path, node.ref.ref);
		if (nodeUri == null) return Promise.resolve();

		const input1: MergeEditorInputs['input1'] = {
			uri: nodeUri,
			title: `Incoming`,
			detail: ` ${node.ref.name}`,
		};

		const [mergeBaseResult, workingUriResult] = await Promise.allSettled([
			repo.git.refs().getMergeBase(node.ref.ref, 'HEAD'),
			this.container.git.getWorkingUri(node.repoPath, node.uri),
		]);

		const workingUri = getSettledValue(workingUriResult);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open the merge editor, no working file found');
			return Promise.resolve();
		}

		const input2: MergeEditorInputs['input2'] = {
			uri: workingUri,
			title: 'Current',
			detail: ' Working Tree',
		};

		const headUri = await this.container.git.getBestRevisionUri(node.repoPath, node.file.path, 'HEAD');
		if (headUri != null) {
			const branch = await repo.git.branches().getBranch?.();

			input2.uri = headUri;
			input2.detail = ` ${branch?.name || 'HEAD'}`;
		}

		const mergeBase = getSettledValue(mergeBaseResult);
		const baseUri =
			mergeBase != null
				? await this.container.git.getBestRevisionUri(node.repoPath, node.file.path, mergeBase)
				: undefined;

		const inputs: MergeEditorInputs = {
			base: baseUri ?? nodeUri,
			input1: input1,
			input2: input2,
			output: workingUri,
		};

		return openMergeEditor(inputs);
	}

	@command('gitlens.views.openChangesWithMergeBase')
	@log()
	private async openChangesWithMergeBase(node: ResultsFileNode) {
		if (!node.is('results-file')) return Promise.resolve();

		const mergeBase = await this.container.git.refs(node.repoPath).getMergeBase(node.ref1, node.ref2 || 'HEAD');
		if (mergeBase == null) return Promise.resolve();

		return CommitActions.openChanges(
			node.file,
			{ repoPath: node.repoPath, lhs: mergeBase, rhs: node.ref1 },
			{
				preserveFocus: true,
				preview: true,
				lhsTitle: `${basename(node.uri.fsPath)} (Base)`,
			},
		);
	}

	@command('gitlens.views.openChangesWithWorking')
	@log()
	private async openChangesWithWorking(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('status-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking', undefined, {
				uri: node.uri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		}

		if (node.is('conflict-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking', undefined, {
				uri: node.baseUri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		}

		if (node.is('file-commit') && node.commit.file?.hasConflicts) {
			const baseUri = await node.getConflictBaseUri();
			if (baseUri != null) {
				return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking', undefined, {
					uri: baseUri,
					showOptions: {
						preserveFocus: true,
						preview: true,
					},
				});
			}
		}

		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: node.is('results-file') && node.ref2 !== '' ? node.ref2 : node.ref.ref,
		});
	}

	@command('gitlens.views.openPreviousChangesWithWorking')
	@log()
	private async openPreviousChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: node.is('results-file') && node.ref2 !== '' ? node.ref1 : `${node.ref.ref}^`,
		});
	}

	@command('gitlens.views.openFile')
	@log()
	private openFile(
		node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode | FileHistoryNode | LineHistoryNode,
		options?: TextDocumentShowOptions,
	) {
		if (
			!(node instanceof ViewRefFileNode) &&
			!node.isAny('conflict-file', 'status-file', 'file-history', 'line-history')
		) {
			return Promise.resolve();
		}

		return CommitActions.openFile(node.uri, {
			preserveFocus: true,
			preview: false,
			...options,
		});
	}

	@command('gitlens.views.openChangedFiles')
	@log()
	private async openFiles(
		node: BranchTrackingStatusFilesNode | CompareResultsNode | CommitNode | StashNode | ResultsFilesNode,
	) {
		if (node.isAny('compare-results', 'results-files', 'tracking-status', 'tracking-status-files')) {
			const comparison = await node.getFilesComparison();
			if (!comparison?.files.length) return undefined;

			return CommitActions.openFiles(comparison.files, {
				repoPath: comparison.repoPath,
				ref: comparison.ref1 || comparison.ref2,
			});
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openFiles(node.commit);
	}

	@command('gitlens.views.openOnlyChangedFiles')
	@log()
	private async openOnlyChangedFiles(
		node: BranchTrackingStatusFilesNode | CompareResultsNode | CommitNode | StashNode | ResultsFilesNode,
	) {
		if (
			node.is('compare-results') ||
			node.is('results-files') ||
			node.is('tracking-status') ||
			node.is('tracking-status-files')
		) {
			const comparison = await node.getFilesComparison();
			if (!comparison?.files.length) return undefined;

			return CommitActions.openOnlyChangedFiles(node.view.container, comparison.files);
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openOnlyChangedFiles(node.view.container, node.commit);
	}

	@command('gitlens.views.openFileRevision')
	@log()
	private async openRevision(
		node:
			| CommitFileNode
			| FileRevisionAsCommitNode
			| ResultsFileNode
			| StashFileNode
			| MergeConflictFileNode
			| StatusFileNode,
		options?: OpenFileAtRevisionCommandArgs,
	) {
		if (!node.isAny('commit-file', 'file-commit', 'results-file', 'stash-file', 'conflict-file', 'status-file')) {
			return Promise.resolve();
		}

		options = { showOptions: { preserveFocus: true, preview: false }, ...options };

		let uri = options.revisionUri;
		if (uri == null) {
			if (node.isAny('results-file', 'conflict-file')) {
				uri = this.container.git.getRevisionUriFromGitUri(node.uri);
			} else {
				uri =
					node.commit.file?.status === 'D'
						? this.container.git.getRevisionUri(
								node.commit.repoPath,
								(await node.commit.getPreviousSha()) ?? deletedOrMissing,
								node.commit.file.path,
						  )
						: this.container.git.getRevisionUriFromGitUri(node.uri);
			}
		}

		return CommitActions.openFileAtRevision(uri, options.showOptions ?? { preserveFocus: true, preview: false });
	}

	@command('gitlens.views.openChangedFileRevisions')
	@log()
	private async openRevisions(
		node: BranchTrackingStatusFilesNode | CompareResultsNode | CommitNode | StashNode | ResultsFilesNode,
		options?: TextDocumentShowOptions,
	) {
		if (node.isAny('compare-results', 'results-files', 'tracking-status', 'tracking-status-files')) {
			const comparison = await node.getFilesComparison();
			if (!comparison?.files.length) return undefined;

			return CommitActions.openFilesAtRevision(comparison.files, {
				repoPath: comparison.repoPath,
				lhs: comparison.ref2,
				rhs: comparison.ref1,
			});
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openFilesAtRevision(node.commit, options);
	}

	@command('gitlens.views.setResultsCommitsFilterAuthors', { args: n => [n, true] })
	@command('gitlens.views.setResultsCommitsFilterOff', { args: n => [n, false] })
	@log()
	private async setResultsCommitsFilter(node: ViewNode, filter: boolean) {
		if (!node?.isAny('compare-results', 'compare-branch')) return;

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return;

		if (filter) {
			let authors = node.getState('filterCommits');
			if (authors == null) {
				const current = await repo.git.config().getCurrentUser();
				authors = current != null ? [current] : undefined;
			}

			const result = await showContributorsPicker(
				this.container,
				repo,
				'Filter Commits',
				repo.virtual ? 'Choose a contributor to show commits from' : 'Choose contributors to show commits from',
				{
					appendReposToTitle: true,
					clearButton: true,
					multiselect: !repo.virtual,
					picked: c => authors?.some(u => matchContributor(c, u)) ?? false,
				},
			);
			if (result == null) return;

			if (result.length === 0) {
				filter = false;
				node.deleteState('filterCommits');
			} else {
				node.storeState('filterCommits', result);
			}
		} else if (repo != null) {
			node.deleteState('filterCommits');
		} else {
			node.deleteState('filterCommits');
		}

		void node.triggerChange(true);
	}

	@command('gitlens.views.setResultsFilesFilterOnLeft', { args: n => [n, FilesQueryFilter.Left] })
	@command('gitlens.views.setResultsFilesFilterOnRight', { args: n => [n, FilesQueryFilter.Right] })
	@command('gitlens.views.setResultsFilesFilterOff', { args: n => [n, undefined] })
	@log()
	private setResultsFilesFilter(node: ResultsFilesNode, filter: FilesQueryFilter | undefined) {
		if (!node.is('results-files')) return;

		node.filter = filter;
	}

	@command('gitlens.views.associateIssueWithBranch')
	@log()
	private async associateIssueWithBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		executeCommand<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
			command: 'associateIssueWithBranch',
			branch: node.ref,
			source: 'view',
		});
	}

	@command('gitlens.views.ai.generateChangelog')
	@log()
	private async generateChangelog(node: ResultsCommitsNode) {
		if (!node.is('results-commits')) return;

		await generateChangelogAndOpenMarkdownDocument(
			this.container,
			lazy(() => node.getChangesForChangelog()),
			{ source: 'view', detail: 'comparison' },
			{ progress: { location: ProgressLocation.Notification } },
		);
	}

	@command('gitlens.views.ai.generateChangelogFrom')
	@log()
	private async generateChangelogFrom(node: BranchNode | TagNode) {
		if (!node.is('branch') && !node.is('tag')) return;

		await executeCommand<GenerateChangelogCommandArgs>('gitlens.ai.generateChangelog', {
			repoPath: node.repoPath,
			head: node.ref,
			source: { source: 'view', detail: node.is('branch') ? 'branch' : 'tag' },
		});
	}
}

interface CompareSelectedInfo {
	ref: string;
	repoPath: string | undefined;
	uri?: Uri;
}

export function registerViewCommand(
	command: GlCommands,
	callback: (...args: any[]) => unknown,
	thisArg?: any,
	options?: {
		multiselect?: boolean | 'sequential';
		args?: (...args: unknown[]) => unknown[];
	},
): Disposable {
	return registerCommand(
		command,
		(...args: any[]) => {
			if (options?.args != null) {
				args = options.args(...args);
			}

			if (options?.multiselect) {
				const [active, selection, ...rest] = args;

				// If there is a node followed by an array of nodes, then check how we want to execute the command
				if (active instanceof ViewNode && Array.isArray(selection) && selection[0] instanceof ViewNode) {
					const nodes = selection.filter((n): n is ViewNode => n?.constructor === active.constructor);

					if (options.multiselect === 'sequential') {
						if (!nodes.includes(active)) {
							nodes.splice(0, 0, active);
						}

						// Execute the command for each node sequentially
						return runSequentially(
							callback,
							nodes.map<[ViewNode, ...any[]]>(n => [n, ...rest]),
							thisArg,
						);
					}

					// Delegate to the callback to handle the multi-select
					return callback.apply(thisArg, [active, nodes, ...rest]);
				}
			}

			return callback.apply(thisArg, args);
		},
		thisArg,
	);
}
