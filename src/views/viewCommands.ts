import type { TextDocumentShowOptions } from 'vscode';
import { Disposable, env, ProgressLocation, Uri, window, workspace } from 'vscode';
import { getTempFile } from '@env/platform.js';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens.d.js';
import type { DiffWithCommandArgs } from '../commands/diffWith.js';
import type { DiffWithPreviousCommandArgs } from '../commands/diffWithPrevious.js';
import type { DiffWithWorkingCommandArgs } from '../commands/diffWithWorking.js';
import type { ExplainBranchCommandArgs } from '../commands/explainBranch.js';
import type { GenerateChangelogCommandArgs } from '../commands/generateChangelog.js';
import { generateChangelogAndOpenMarkdownDocument } from '../commands/generateChangelog.js';
import type { OpenFileAtRevisionCommandArgs } from '../commands/openFileAtRevision.js';
import type { OpenOnRemoteCommandArgs } from '../commands/openOnRemote.js';
import type { RecomposeFromCommitCommandArgs } from '../commands/recomposeFromCommit.js';
import type { ViewShowBranchComparison } from '../config.js';
import type { GlCommands } from '../constants.commands.js';
import { GlyphChars } from '../constants.js';
import type { Container } from '../container.js';
import * as BranchActions from '../git/actions/branch.js';
import * as CommitActions from '../git/actions/commit.js';
import * as ContributorActions from '../git/actions/contributor.js';
import { abortPausedOperation, continuePausedOperation, skipPausedOperation } from '../git/actions/pausedOperation.js';
import * as RemoteActions from '../git/actions/remote.js';
import * as RepoActions from '../git/actions/repository.js';
import * as StashActions from '../git/actions/stash.js';
import * as TagActions from '../git/actions/tag.js';
import * as WorktreeActions from '../git/actions/worktree.js';
import { browseAtRevision, executeGitCommand } from '../git/actions.js';
import { GitUri } from '../git/gitUri.js';
import type { GitBranch } from '../git/models/branch.js';
import type { PullRequest } from '../git/models/pullRequest.js';
import { RemoteResourceType } from '../git/models/remoteResource.js';
import type { Repository } from '../git/models/repository.js';
import { deletedOrMissing } from '../git/models/revision.js';
import {
	ensurePullRequestRefs,
	getOpenedPullRequestRepo,
	getOrOpenPullRequestRepository,
} from '../git/utils/-webview/pullRequest.utils.js';
import { openRebaseEditor } from '../git/utils/-webview/rebase.utils.js';
import { matchContributor } from '../git/utils/contributor.utils.js';
import {
	getComparisonRefsForPullRequest,
	getRepositoryIdentityForPullRequest,
} from '../git/utils/pullRequest.utils.js';
import { createReference } from '../git/utils/reference.utils.js';
import { shortenRevision } from '../git/utils/revision.utils.js';
import { showPatchesView } from '../plus/drafts/actions.js';
import { getPullRequestBranchDeepLink } from '../plus/launchpad/launchpadProvider.js';
import type { AssociateIssueWithBranchCommandArgs } from '../plus/startWork/associateIssueWithBranch.js';
import { showContributorsPicker } from '../quickpicks/contributorsPicker.js';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	executeEditorCommand,
	registerCommand,
} from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { getContext, setContext } from '../system/-webview/context.js';
import type { MergeEditorInputs } from '../system/-webview/vscode/editors.js';
import { editorLineToDiffRange, openMergeEditor } from '../system/-webview/vscode/editors.js';
import { openUrl } from '../system/-webview/vscode/uris.js';
import type { OpenWorkspaceLocation } from '../system/-webview/vscode/workspaces.js';
import { openWorkspace } from '../system/-webview/vscode/workspaces.js';
import { revealInFileExplorer } from '../system/-webview/vscode.js';
import { filterMap } from '../system/array.js';
import { createCommandDecorator } from '../system/decorators/command.js';
import { debug } from '../system/decorators/log.js';
import { runSequentially } from '../system/function.js';
import { join, map } from '../system/iterable.js';
import { lazy } from '../system/lazy.js';
import { basename } from '../system/path.js';
import { getSettledValue } from '../system/promise.js';
import { DeepLinkActionType } from '../uris/deepLinks/deepLink.js';
import type { ShowInCommitGraphCommandArgs } from '../webviews/plus/graph/registration.js';
import type { LaunchpadItemNode } from './launchpadView.js';
import type { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode.js';
import type { ClipboardType } from './nodes/abstract/viewNode.js';
import {
	canEditNode,
	canViewDismissNode,
	getNodeRepoPath,
	isPageableViewNode,
	ViewNode,
} from './nodes/abstract/viewNode.js';
import { ViewRefFileNode, ViewRefNode } from './nodes/abstract/viewRefNode.js';
import type { BranchesNode } from './nodes/branchesNode.js';
import type { BranchNode } from './nodes/branchNode.js';
import type { BranchTrackingStatusFilesNode } from './nodes/branchTrackingStatusFilesNode.js';
import type { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode.js';
import type { CommitFileNode } from './nodes/commitFileNode.js';
import type { CommitNode } from './nodes/commitNode.js';
import type { PagerNode } from './nodes/common.js';
import type { CompareResultsNode } from './nodes/compareResultsNode.js';
import type { ContributorNode } from './nodes/contributorNode.js';
import type { DraftNode } from './nodes/draftNode.js';
import type { FileHistoryNode } from './nodes/fileHistoryNode.js';
import type { FileRevisionAsCommitNode } from './nodes/fileRevisionAsCommitNode.js';
import type { FolderNode } from './nodes/folderNode.js';
import type { LineHistoryNode } from './nodes/lineHistoryNode.js';
import type { MergeConflictFileNode } from './nodes/mergeConflictFileNode.js';
import type { PausedOperationStatusNode } from './nodes/pausedOperationStatusNode.js';
import type { PullRequestNode } from './nodes/pullRequestNode.js';
import type { RemoteNode } from './nodes/remoteNode.js';
import type { RepositoryNode } from './nodes/repositoryNode.js';
import type { ResultsCommitsNode } from './nodes/resultsCommitsNode.js';
import type { ResultsFileNode } from './nodes/resultsFileNode.js';
import type { ResultsFilesNode } from './nodes/resultsFilesNode.js';
import { FilesQueryFilter } from './nodes/resultsFilesNode.js';
import type { StashFileNode } from './nodes/stashFileNode.js';
import type { StashNode } from './nodes/stashNode.js';
import type { StatusFileNode } from './nodes/statusFileNode.js';
import type { TagNode } from './nodes/tagNode.js';
import type { TagsNode } from './nodes/tagsNode.js';
import type { UncommittedFileNode } from './nodes/UncommittedFileNode.js';
import type { UncommittedFilesNode } from './nodes/UncommittedFilesNode.js';
import type { WorktreeNode } from './nodes/worktreeNode.js';
import type { WorktreesNode } from './nodes/worktreesNode.js';

const { command, getCommands } = createCommandDecorator<
	GlCommands,
	(...args: any[]) => unknown,
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
	@debug()
	private async copyNode(active: ViewNode | undefined, selection: ViewNode[], type: ClipboardType): Promise<void> {
		selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
		if (selection.length === 0) return;

		const data = join(
			// eslint-disable-next-line @typescript-eslint/await-thenable
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
	@debug()
	private async copyOrOpenNodeUrls(
		active: ViewNode | undefined,
		selection: ViewNode[],
		clipboard?: boolean,
	): Promise<void> {
		selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
		if (!selection.length) return;

		const urls = [
			// eslint-disable-next-line @typescript-eslint/await-thenable
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
	@debug()
	private copyOrOpenCommitsOnRemote(active: ViewRefNode, selection?: ViewRefNode[], clipboard?: boolean) {
		const refs = selection?.length ? selection.map(n => n.ref) : [active.ref];

		return executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: refs[0].repoPath,
			resource: refs.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@command('gitlens.views.collapseNode')
	@debug()
	private collapseNode() {
		return executeCoreCommand('list.collapseAllToFocus');
	}

	@command('gitlens.views.dismissNode')
	@debug()
	private dismissNode(node: ViewNode) {
		if (!canViewDismissNode(node.view)) return;

		node.view.dismissNode(node);
	}

	@command('gitlens.views.editNode')
	@debug()
	private editNode(node: ViewNode) {
		if (!canEditNode(node)) return;

		return node.edit();
	}

	@command('gitlens.views.expandNode')
	@debug()
	private expandNode(node: ViewNode) {
		return node.view.reveal(node, { select: false, focus: false, expand: 3 });
	}

	@command('gitlens.views.loadMoreChildren')
	@debug()
	private loadMoreChildren(node: PagerNode) {
		return node.loadMore();
	}

	@command('gitlens.views.loadAllChildren')
	@debug()
	private loadAllChildren(node: PagerNode) {
		return node.loadAll();
	}

	@command('gitlens.views.refreshNode', { multiselect: 'sequential' })
	@debug()
	private refreshNode(node: ViewNode, reset?: boolean) {
		if (reset == null && isPageableViewNode(node)) {
			node.limit = undefined;
			node.view.resetNodeLastKnownLimit(node);
		}

		return node.view.refreshNode(node, reset ?? true);
	}

	@command('gitlens.views.addAuthors')
	@debug()
	private addAuthors(node?: ViewNode) {
		return ContributorActions.addAuthors(getNodeRepoPath(node));
	}

	@command('gitlens.views.addAuthor')
	@command('gitlens.views.addAuthor.multi', { multiselect: true })
	@debug()
	private addAuthor(node?: ContributorNode, nodes?: ContributorNode[]) {
		if (!node?.is('contributor')) return Promise.resolve();

		const contributors = nodes?.length ? nodes.map(n => n.contributor) : [node.contributor];
		return ContributorActions.addAuthors(
			node.repoPath,
			contributors.filter(c => !c.current),
		);
	}

	@command('gitlens.views.addRemote')
	@debug()
	private addRemote(node?: ViewNode) {
		return RemoteActions.add(getNodeRepoPath(node));
	}

	@command('gitlens.views.addPullRequestRemote')
	@debug()
	private async addPullRequestRemote(node: ViewNode, pr: PullRequest, repo: Repository) {
		const identity = getRepositoryIdentityForPullRequest(pr);
		if (identity.remote?.url == null) return;

		await repo.git.remotes.addRemote?.(identity.provider.repoDomain, identity.remote.url, { fetch: true });
		return node.triggerChange(true);
	}

	@command('gitlens.views.applyChanges')
	@debug()
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

	@command('gitlens.stashApply:views')
	@debug()
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
	@debug()
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
	@debug()
	private cherryPick(node: CommitNode, nodes?: CommitNode[]) {
		if (!node.is('commit')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.ref) : [node.ref];
		return RepoActions.cherryPick(node.repoPath, refs);
	}

	@command('gitlens.views.clearComparison')
	@debug()
	private clearComparison(node: ViewNode) {
		if (node.is('compare-branch')) {
			void node.clear();
		}
	}

	@command('gitlens.views.clearReviewed')
	@debug()
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
	@debug()
	private closeRepository(node: RepositoryNode | RepositoryFolderNode): void {
		if (!node.isAny('repository', 'repo-folder')) return;

		node.repo.closed = true;
	}

	@command('gitlens.views.title.createBranch', { args: () => [] })
	@command('gitlens.createBranch:views')
	@debug()
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

			const branch = await repo.git.branches.getBranch();
			from = branch;
		}
		return BranchActions.create(node?.repoPath, from);
	}

	@command('gitlens.createPullRequest:views')
	@debug()
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
	@debug()
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

			const branch = await repo.git.branches.getBranch();
			from = branch;
		}
		return TagActions.create(node?.repoPath, from);
	}

	@command('gitlens.views.title.createWorktree', { args: () => [] })
	@command('gitlens.views.createWorktree')
	@debug()
	private async createWorktree(node?: BranchNode | WorktreesNode) {
		if (node?.is('worktrees')) {
			node = undefined;
		}
		if (node != null && !node.is('branch')) return undefined;

		return WorktreeActions.create(node?.repoPath, undefined, node?.ref);
	}

	@command('gitlens.views.deleteBranch')
	@command('gitlens.views.deleteBranch.multi', { multiselect: true })
	@debug()
	private deleteBranch(node: BranchNode, nodes?: BranchNode[]) {
		if (!node.is('branch')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.branch) : [node.branch];
		return BranchActions.remove(node.repoPath, refs);
	}

	@command('gitlens.stashDelete:views')
	@command('gitlens.stashDelete.multi:views', { multiselect: true })
	@debug()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!node.is('stash')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.commit) : [node.commit];
		return StashActions.drop(node.repoPath, refs);
	}

	@command('gitlens.stashRename:views')
	@debug()
	private renameStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.rename(node.repoPath, node.commit);
	}

	@command('gitlens.views.deleteTag')
	@command('gitlens.views.deleteTag.multi', { multiselect: true })
	@debug()
	private deleteTag(node: TagNode, nodes?: TagNode[]) {
		if (!node.is('tag')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.tag) : [node.tag];
		return TagActions.remove(node.repoPath, refs);
	}

	@command('gitlens.views.deleteWorktree')
	@command('gitlens.views.deleteWorktree.multi', { multiselect: true })
	@debug()
	private async deleteWorktree(node: WorktreeNode, nodes?: WorktreeNode[]) {
		if (!node.is('worktree')) return undefined;

		const worktrees = nodes?.length ? nodes.map(n => n.worktree) : [node.worktree];
		const uris = worktrees.filter(w => !w.isDefault && !w.opened).map(w => w.uri);
		return WorktreeActions.remove(node.repoPath, uris);
	}

	@command('gitlens.fetch:views')
	@debug()
	private fetch(node: RemoteNode | RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.fetch(node.repo);
		if (node.is('remote')) return RemoteActions.fetch(node.remote.repoPath, node.remote.name);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.fetch(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

	@command('gitlens.views.highlightChanges')
	@debug()
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
	@debug()
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
	@debug()
	private merge(node: BranchNode | TagNode) {
		if (!node.isAny('branch', 'tag')) return Promise.resolve();

		return RepoActions.merge(node.repoPath, node.is('branch') ? node.branch : node.tag);
	}

	@command('gitlens.views.openBranchOnRemote')
	@command('gitlens.views.openBranchOnRemote.multi', { multiselect: 'sequential' })
	@debug()
	private openBranchOnRemote(node: BranchNode) {
		return executeCommand('gitlens.openBranchOnRemote', node);
	}

	@command('gitlens.views.openInTerminal')
	@debug()
	private openInTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInTerminal', Uri.file(node.repoPath));
	}

	@command('gitlens.views.openInIntegratedTerminal')
	@debug()
	private openInIntegratedTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInIntegratedTerminal', Uri.file(node.repoPath));
	}

	@command('gitlens.views.pausedOperation.abort')
	@debug()
	private async abortPausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await abortPausedOperation(this.container.git.getRepositoryService(node.pausedOpStatus.repoPath));
	}

	@command('gitlens.views.pausedOperation.continue')
	@debug()
	private async continuePausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await continuePausedOperation(this.container.git.getRepositoryService(node.pausedOpStatus.repoPath));
	}

	@command('gitlens.views.pausedOperation.skip')
	@debug()
	private async skipPausedOperation(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status')) return;

		await skipPausedOperation(this.container.git.getRepositoryService(node.pausedOpStatus.repoPath));
	}

	@command('gitlens.views.pausedOperation.open')
	@debug()
	private async openPausedOperationInRebaseEditor(node: PausedOperationStatusNode) {
		if (!node.is('paused-operation-status') || node.pausedOpStatus.type !== 'rebase') return;

		await openRebaseEditor(this.container, node.repoPath);
	}

	@command('gitlens.openPullRequest:views')
	@debug()
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

	@command('gitlens.openPullRequestChanges:views')
	@debug()
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

	@command('gitlens.openPullRequestComparison:views')
	@debug()
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
	@debug()
	private async openDraft(node: DraftNode) {
		await showPatchesView({ mode: 'view', draft: node.draft });
	}

	@command('gitlens.views.draft.openOnWeb')
	@debug()
	private async openDraftOnWeb(node: DraftNode) {
		const url = await this.container.drafts.generateWebUrl(node.draft);
		await openUrl(url);
	}

	@command('gitlens.openWorktree:views')
	@command('gitlens.openWorktreeInNewWindow:views', { args: a => [a, undefined, { location: 'newWindow' }] })
	@command('gitlens.openWorktreeInNewWindow.multi:views', {
		args: (a, s) => [a, s, { location: 'newWindow' }],
		multiselect: true,
	})
	@debug()
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
	@debug()
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
	@debug()
	private pruneRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.prune(node.remote.repoPath, node.remote.name);
	}

	@command('gitlens.views.removeRemote')
	@debug()
	private async removeRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.remove(node.remote.repoPath, node.remote.name);
	}

	@command('gitlens.publishBranch:views')
	@debug()
	private publishBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.push(node.repoPath, undefined, node.branch);
		}
		return Promise.resolve();
	}

	@command('gitlens.views.publishRepository')
	@debug()
	private publishRepository(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return executeCoreGitCommand('git.publish', Uri.file(node.repoPath));
		}
		return Promise.resolve();
	}

	@command('gitlens.views.pull')
	@debug()
	private pull(node: RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.pull(node.repo);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.pull(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

	@command('gitlens.views.push', { args: n => [n, false] })
	@command('gitlens.views.pushWithForce', { args: n => [n, true] })
	@debug()
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
	@debug()
	private pushToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.push(node.repoPath, false, node.commit);
	}

	@command('gitlens.views.rebaseOntoBranch')
	@command('gitlens.views.rebaseOntoCommit')
	@debug()
	private rebase(node: BranchNode | CommitNode | FileRevisionAsCommitNode | TagNode) {
		if (!node.isAny('branch', 'commit', 'file-commit', 'tag')) {
			return Promise.resolve();
		}

		return RepoActions.rebase(node.repoPath, node.ref);
	}

	@command('gitlens.ai.explainUnpushed:views')
	@debug()
	private async explainUnpushed(node: BranchNode) {
		if (!node.is('branch') || !node.branch.upstream) {
			return Promise.resolve();
		}

		await executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: node.repoPath,
			ref: node.branch.ref,
			baseBranch: node.branch.upstream.name,
			source: { source: 'view', context: { type: 'branch' } },
		});
	}

	@command('gitlens.views.rebaseOntoUpstream')
	@debug()
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
	@debug()
	private renameBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return BranchActions.rename(node.repoPath, node.branch);
	}

	@command('gitlens.changeUpstream:views')
	@command('gitlens.setUpstream:views')
	@debug()
	private changeUpstreamBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (!node.isAny('branch', 'tracking-status')) return Promise.resolve();

		return BranchActions.changeUpstream(node.repoPath, node.branch);
	}

	@command('gitlens.views.resetCommit')
	@debug()
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
	@debug()
	private resetToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.reset(node.repoPath, node.ref);
	}

	@command('gitlens.views.resetToTip')
	@debug()
	private resetToTip(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(node.ref.ref, node.repoPath, { refType: 'revision', name: node.ref.name }),
		);
	}

	@command('gitlens.restore.file:views')
	@debug()
	private restoreFile(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.restoreFile(node.file, node.ref);
	}

	@command('gitlens.restorePrevious.file:views')
	@debug()
	private restorePreviousFile(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.restoreFile(node.file, node.ref, true);
	}

	@command('gitlens.views.revealRepositoryInExplorer')
	@debug()
	private revealRepositoryInExplorer(node: RepositoryNode) {
		if (!node.is('repository')) return undefined;

		return revealInFileExplorer(node.repo.uri);
	}

	@command('gitlens.views.revealWorktreeInExplorer')
	@debug()
	private revealWorktreeInExplorer(nodeOrUrl: WorktreeNode | string) {
		if (typeof nodeOrUrl === 'string') return revealInFileExplorer(Uri.parse(nodeOrUrl));
		if (!nodeOrUrl.is('worktree')) return undefined;

		return revealInFileExplorer(nodeOrUrl.worktree.uri);
	}

	@command('gitlens.views.revert')
	@debug()
	private revert(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.revert(node.repoPath, node.ref);
	}

	@command('gitlens.views.setAsDefault')
	@debug()
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
	@debug()
	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!node.is('compare-branch')) return undefined;

		return node.setComparisonType(comparisonType);
	}

	@command('gitlens.views.setShowRelativeDateMarkersOn', { args: () => [true] })
	@command('gitlens.views.setShowRelativeDateMarkersOff', { args: () => [false] })
	@debug()
	private setShowRelativeDateMarkers(enabled: boolean) {
		return configuration.updateEffective('views.showRelativeDateMarkers', enabled);
	}

	@command('gitlens.views.setContributorsStatisticsOff', { args: () => [false] })
	@command('gitlens.views.setContributorsStatisticsOn', { args: () => [true] })
	@debug()
	private setContributorsStatistics(enabled: boolean) {
		return configuration.updateEffective('views.showContributorsStatistics', enabled);
	}

	@command('gitlens.views.stageFile')
	@debug()
	private async stageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit', 'status-file')) {
			return;
		}

		await this.container.git.getRepositoryService(node.repoPath).staging?.stageFile(node.file.path);
		void node.triggerChange();
	}

	@command('gitlens.views.stageDirectory')
	@debug()
	private async stageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.getRepositoryService(node.repoPath).staging?.stageDirectory(node.relativePath);
		void node.triggerChange();
	}

	@command('gitlens.star.branch:views')
	@command('gitlens.star.branch.multi:views', { multiselect: 'sequential' })
	@command('gitlens.star.repository:views')
	@command('gitlens.star.repository.multi:views', { multiselect: 'sequential' })
	@debug()
	private async star(node: BranchNode | RepositoryNode | RepositoryFolderNode | WorktreeNode): Promise<void> {
		if (!node.isAny('branch', 'repository', 'repo-folder', 'worktree')) {
			return Promise.resolve();
		}

		return node.star();
	}

	@command('gitlens.switchToAnotherBranch:views')
	@debug()
	private switch(node?: ViewNode) {
		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@command('gitlens.switchToBranch:views')
	@command('gitlens.views.switchToCommit')
	@command('gitlens.views.switchToTag')
	@debug()
	private switchTo(node?: ViewNode) {
		if (node instanceof ViewRefNode) {
			return RepoActions.switchTo(node.repoPath, node.is('branch') && node.branch.current ? undefined : node.ref);
		}

		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@command('gitlens.views.undoCommit')
	@debug()
	private async undoCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return;

		await CommitActions.undoCommit(this.container, node.ref);
	}

	@command('gitlens.composeCommits:views')
	@debug()
	private composeCommits(node: UncommittedFileNode) {
		void executeCommand('gitlens.composeCommits', {
			repoPath: node.repoPath,
			source: 'view',
		});
	}

	@command('gitlens.recomposeFromCommit:views')
	@debug()
	private recomposeFromCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return;

		let branch: GitBranch | undefined;
		if (node.is('commit')) {
			branch = node.branch;
		} else if (node.is('file-commit')) {
			branch = (node as any)._options?.branch;
		}

		if (branch == null) {
			void window.showErrorMessage('Unable to determine branch for commit');
			return;
		}

		void executeCommand<RecomposeFromCommitCommandArgs>('gitlens.recomposeFromCommit', {
			repoPath: node.repoPath,
			commitSha: node.commit.sha,
			branchName: branch.name,
			source: 'view',
		});
	}

	@command('gitlens.views.unsetAsDefault')
	@debug()
	private unsetAsDefault(node: RemoteNode): Promise<void> {
		if (!node.is('remote')) return Promise.resolve();

		return node.setAsDefault(false);
	}

	@command('gitlens.views.unstageFile')
	@debug()
	private async unstageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit', 'status-file')) return;

		await this.container.git.getRepositoryService(node.repoPath).staging?.unstageFile(node.file.path);
		void node.triggerChange();
	}

	@command('gitlens.views.unstageDirectory')
	@debug()
	private async unstageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.getRepositoryService(node.repoPath).staging?.unstageDirectory(node.relativePath);
		void node.triggerChange();
	}

	@command('gitlens.unstar.branch:views')
	@command('gitlens.unstar.branch.multi:views', { multiselect: 'sequential' })
	@command('gitlens.unstar.repository:views')
	@command('gitlens.unstar.repository.multi:views', { multiselect: 'sequential' })
	@debug()
	private async unstar(node: BranchNode | RepositoryNode | RepositoryFolderNode | WorktreeNode): Promise<void> {
		if (!node.isAny('branch', 'repository', 'repo-folder', 'worktree')) return Promise.resolve();

		return node.unstar();
	}

	@command('gitlens.views.compareWithHead')
	@debug()
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
	@debug()
	private compareBranchWithHead(node: BranchNode) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, 'HEAD');
	}

	@command('gitlens.views.compareWithMergeBase')
	@debug()
	private async compareWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.getRepositoryService(node.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(node.repoPath)
			.refs.getMergeBase(branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref.ref, {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.views.openChangedFileDiffsWithMergeBase')
	@debug()
	private async openChangedFileDiffsWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.getRepositoryService(node.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(node.repoPath)
			.refs.getMergeBase(branch.ref, node.ref.ref);
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
	@debug()
	private compareWithUpstream(node: BranchNode) {
		if (!node.is('branch') || node.branch.upstream == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@command('gitlens.views.compareWithWorking')
	@debug()
	private compareWorkingWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, '');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, '', node.ref);
	}

	@command('gitlens.views.compareAncestryWithWorking')
	@debug()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!node.is('branch')) return undefined;

		const branch = await this.container.git.getRepositoryService(node.repoPath).branches.getBranch();
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git
			.getRepositoryService(node.repoPath)
			.refs.getMergeBase(branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, '', {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@command('gitlens.views.compareWithSelected')
	@debug()
	private compareWithSelected(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		const selectedRef = getContext('gitlens:views:canCompare');
		if (selectedRef == null) return;

		void setContext('gitlens:views:canCompare', undefined);

		if (selectedRef.repoPath !== node.repoPath) {
			this.selectForCompare(node);
			return;
		}

		void this.container.views.searchAndCompare.compare(node.repoPath, selectedRef, {
			label: node.ref.name,
			ref: node.ref.ref,
		});
	}

	@command('gitlens.views.selectForCompare')
	@debug()
	private selectForCompare(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		void setContext('gitlens:views:canCompare', {
			label: node.ref.name,
			ref: node.ref.ref,
			repoPath: node.repoPath,
		});
	}

	private async compareFileWith(
		repoPath: string,
		lhsUri: Uri,
		lhsRef: string,
		rhsUri: Uri | undefined,
		rhsRef: string,
	) {
		rhsUri ??= await this.container.git.getRepositoryService(repoPath).getWorkingUri(lhsUri);

		return executeCommand<DiffWithCommandArgs, void>('gitlens.diffWith', {
			repoPath: repoPath,
			lhs: { sha: lhsRef, uri: lhsUri },
			rhs: { sha: rhsRef, uri: rhsUri ?? lhsUri },
		});
	}

	@command('gitlens.views.compareFileWithSelected')
	@debug()
	private compareFileWithSelected(node: ViewRefFileNode) {
		const selectedFile = getContext('gitlens:views:canCompare:file');
		if (selectedFile == null || !(node instanceof ViewRefFileNode) || node.ref == null) {
			return Promise.resolve();
		}

		void setContext('gitlens:views:canCompare:file', undefined);

		if (selectedFile.repoPath !== node.repoPath) {
			this.selectFileForCompare(node);
			return Promise.resolve();
		}

		return this.compareFileWith(selectedFile.repoPath, selectedFile.uri, selectedFile.ref, node.uri, node.ref.ref);
	}

	@command('gitlens.views.selectFileForCompare')
	@debug()
	private selectFileForCompare(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode) || node.ref == null) return;

		void setContext('gitlens:views:canCompare:file', { ref: node.ref.ref, repoPath: node.repoPath, uri: node.uri });
	}

	@command('gitlens.views.openChangedFileDiffs', { args: (n, o) => [n, o] })
	@command('gitlens.views.openChangedFileDiffsIndividually', { args: (n, o) => [n, o, true] })
	@debug()
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
	@debug()
	private openChanges(node: ViewRefFileNode | MergeConflictFileNode) {
		if (node.is('conflict-file')) {
			void executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				lhs: { sha: node.status.HEAD.ref, uri: GitUri.fromFile(node.file, node.repoPath, undefined, true) },
				rhs: { sha: 'HEAD', uri: GitUri.fromFile(node.file, node.repoPath) },
				repoPath: node.repoPath,
				range: editorLineToDiffRange(0),
				showOptions: { preserveFocus: false, preview: false },
			});

			return;
		}

		if (!(node instanceof ViewRefFileNode)) return;

		const command = node.getCommand();
		if (command?.arguments == null) return;

		switch (command.command) {
			case 'gitlens.diffWith' satisfies GlCommands: {
				const [args] = command.arguments as [DiffWithCommandArgs];
				args.showOptions!.preview = false;
				void executeCommand<DiffWithCommandArgs>(command.command, args);
				break;
			}
			case 'gitlens.diffWithPrevious' satisfies GlCommands:
			case 'gitlens.diffWithPrevious:views' satisfies GlCommands: {
				const [, args] = command.arguments as [Uri, DiffWithPreviousCommandArgs];
				args.showOptions!.preview = false;
				void executeEditorCommand<DiffWithPreviousCommandArgs>(
					'gitlens.diffWithPrevious:views',
					undefined,
					args,
				);
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
	@debug()
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
	@debug()
	private async mergeChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return Promise.resolve();

		const nodeUri = await repo.git.getBestRevisionUri(node.file.path, node.ref.ref);
		if (nodeUri == null) return Promise.resolve();

		const input1: MergeEditorInputs['input1'] = { uri: nodeUri, title: `Incoming`, detail: ` ${node.ref.name}` };

		const [mergeBaseResult, workingUriResult] = await Promise.allSettled([
			repo.git.refs.getMergeBase(node.ref.ref, 'HEAD'),
			repo.git.getWorkingUri(node.uri),
		]);

		const workingUri = getSettledValue(workingUriResult);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open the merge editor, no working file found');
			return Promise.resolve();
		}

		const input2: MergeEditorInputs['input2'] = { uri: workingUri, title: 'Current', detail: ' Working Tree' };

		const headUri = await repo.git.getBestRevisionUri(node.file.path, 'HEAD');
		if (headUri != null) {
			const branch = await repo.git.branches.getBranch?.();

			input2.uri = headUri;
			input2.detail = ` ${branch?.name || 'HEAD'}`;
		}

		const mergeBase = getSettledValue(mergeBaseResult);
		const baseUri = mergeBase != null ? await repo.git.getBestRevisionUri(node.file.path, mergeBase) : undefined;

		const inputs: MergeEditorInputs = {
			base: baseUri ?? nodeUri,
			input1: input1,
			input2: input2,
			output: workingUri,
		};

		return openMergeEditor(inputs);
	}

	@command('gitlens.views.openChangesWithMergeBase')
	@debug()
	private async openChangesWithMergeBase(node: ResultsFileNode) {
		if (!node.is('results-file')) return Promise.resolve();

		const mergeBase = await this.container.git
			.getRepositoryService(node.repoPath)
			.refs.getMergeBase(node.ref1, node.ref2 || 'HEAD');
		if (mergeBase == null) return Promise.resolve();

		return CommitActions.openChanges(
			node.file,
			{ repoPath: node.repoPath, lhs: mergeBase, rhs: node.ref1 },
			{ preserveFocus: true, preview: true, lhsTitle: `${basename(node.uri.fsPath)} (Base)` },
		);
	}

	@command('gitlens.views.openChangesWithWorking')
	@debug()
	private async openChangesWithWorking(node: ViewRefFileNode | MergeConflictFileNode) {
		if (node.isAny('status-file', 'uncommitted-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking:views', undefined, {
				uri: node.uri,
				showOptions: { preserveFocus: true, preview: true },
			});
		}

		if (node.is('conflict-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking:views', undefined, {
				uri: node.baseUri,
				showOptions: { preserveFocus: true, preview: true },
			});
		}

		if (node.is('file-commit') && node.commit.file?.hasConflicts) {
			const baseUri = await node.getConflictBaseUri();
			if (baseUri != null) {
				return executeEditorCommand<DiffWithWorkingCommandArgs>('gitlens.diffWithWorking:views', undefined, {
					uri: baseUri,
					showOptions: { preserveFocus: true, preview: true },
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
	@debug()
	private async openPreviousChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: node.is('results-file') && node.ref2 !== '' ? node.ref1 : `${node.ref.ref}^`,
		});
	}

	@command('gitlens.views.openFile')
	@debug()
	private openFile(
		node: ViewRefFileNode | MergeConflictFileNode | FileHistoryNode | LineHistoryNode,
		options?: TextDocumentShowOptions,
	) {
		if (!(node instanceof ViewRefFileNode) && !node.isAny('conflict-file', 'file-history', 'line-history')) {
			return Promise.resolve();
		}

		return CommitActions.openFile(node.uri, { preserveFocus: true, preview: false, ...options });
	}

	@command('gitlens.openFileHistoryInGraph:views')
	@debug()
	private openFileHistoryInGraph(node: CommitFileNode | FileRevisionAsCommitNode | ResultsFileNode | StashFileNode) {
		if (!node.isAny('commit-file', 'file-commit', 'results-file', 'stash-file')) {
			return Promise.resolve();
		}

		return executeCommand('gitlens.openFileHistoryInGraph', node.uri);
	}

	@command('gitlens.graph.soloBranch:views')
	@command('gitlens.graph.soloTag:views')
	@debug()
	private async soloReferenceInGraph(node: BranchNode | TagNode) {
		if (!node.is('branch') && !node.is('tag')) return Promise.resolve();

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return Promise.resolve();

		// Show the graph with a ref: search query to filter the graph to this branch
		return void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
			repository: repo,
			search: {
				query: `ref:${node.ref.name}`,
				filter: true,
				matchAll: false,
				matchCase: false,
				matchRegex: false,
			},
			source: { source: 'view' },
		});
	}

	@command('gitlens.views.openChangedFiles')
	@debug()
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
	@debug()
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
	@debug()
	private async openRevision(
		node:
			| CommitFileNode
			| FileRevisionAsCommitNode
			| ResultsFileNode
			| StashFileNode
			| MergeConflictFileNode
			| StatusFileNode
			| UncommittedFileNode,
		options?: OpenFileAtRevisionCommandArgs,
	) {
		if (
			!node.isAny(
				'commit-file',
				'file-commit',
				'results-file',
				'stash-file',
				'conflict-file',
				'status-file',
				'uncommitted-file',
			)
		) {
			return Promise.resolve();
		}

		options = { showOptions: { preserveFocus: true, preview: false }, ...options };

		let uri = options.revisionUri;
		if (uri == null) {
			if (node.isAny('results-file', 'conflict-file', 'uncommitted-file')) {
				uri = this.container.git.getRevisionUriFromGitUri(node.uri);
			} else {
				uri =
					node.commit.file?.status === 'D'
						? this.container.git
								.getRepositoryService(node.commit.repoPath)
								.getRevisionUri(
									(await node.commit.getPreviousSha()) ?? deletedOrMissing,
									node.commit.file.path,
								)
						: this.container.git.getRevisionUriFromGitUri(node.uri);
			}
		}

		return CommitActions.openFileAtRevision(uri, options.showOptions ?? { preserveFocus: true, preview: false });
	}

	@command('gitlens.views.openChangedFileRevisions')
	@debug()
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
	@debug()
	private async setResultsCommitsFilter(node: ViewNode, filter: boolean) {
		if (!node?.isAny('compare-results', 'compare-branch')) return;

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return;

		if (filter) {
			let authors = node.getState('filterCommits');
			if (authors == null) {
				const current = await repo.git.config.getCurrentUser();
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
	@debug()
	private setResultsFilesFilter(node: ResultsFilesNode, filter: FilesQueryFilter | undefined) {
		if (!node.is('results-files')) return;

		node.filter = filter;
	}

	@command('gitlens.associateIssueWithBranch:views')
	@debug()
	private async associateIssueWithBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		executeCommand<AssociateIssueWithBranchCommandArgs>('gitlens.associateIssueWithBranch', {
			command: 'associateIssueWithBranch',
			branch: node.ref,
			source: 'view',
		});
	}

	@command('gitlens.ai.generateChangelog:views')
	@debug()
	private async generateChangelog(node: ResultsCommitsNode) {
		if (!node.is('results-commits')) return;

		await generateChangelogAndOpenMarkdownDocument(
			this.container,
			lazy(() => node.getChangesForChangelog()),
			{ source: 'view', detail: 'comparison' },
			{ progress: { location: ProgressLocation.Notification } },
		);
	}

	@command('gitlens.ai.generateChangelogFrom:views')
	@debug()
	private async generateChangelogFrom(node: BranchNode | TagNode) {
		if (!node.is('branch') && !node.is('tag')) return;

		await executeCommand<GenerateChangelogCommandArgs>('gitlens.ai.generateChangelog', {
			repoPath: node.repoPath,
			head: node.ref,
			source: { source: 'view', detail: node.is('branch') ? 'branch' : 'tag' },
		});
	}

	@command('gitlens.copyWorkingChangesToWorktree:views')
	@debug()
	private async copyWorkingChangesToWorktree(node: WorktreeNode | UncommittedFilesNode) {
		if (node.is('uncommitted-files')) {
			const parent = node.getParent()!;
			if (parent?.is('worktree')) {
				node = parent;
			}
		}
		if (!node.is('worktree')) return;

		return WorktreeActions.copyChangesToWorktree('working-tree', node.worktree.repoPath, undefined, node.worktree);
	}
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
