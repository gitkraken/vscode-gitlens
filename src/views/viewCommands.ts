import { getTempFile } from '@env/platform';
import type { TextDocumentShowOptions } from 'vscode';
import { Disposable, env, Uri, window, workspace } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens';
import type { DiffWithCommandArgs } from '../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../commands/diffWithPrevious';
import type { DiffWithWorkingCommandArgs } from '../commands/diffWithWorking';
import type { OpenFileAtRevisionCommandArgs } from '../commands/openFileAtRevision';
import type { OpenOnRemoteCommandArgs } from '../commands/openOnRemote';
import type { ViewShowBranchComparison } from '../config';
import { GlyphChars } from '../constants';
import type { Commands } from '../constants.commands';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { browseAtRevision, executeGitCommand } from '../git/actions';
import * as BranchActions from '../git/actions/branch';
import * as CommitActions from '../git/actions/commit';
import * as ContributorActions from '../git/actions/contributor';
import * as RemoteActions from '../git/actions/remote';
import * as RepoActions from '../git/actions/repository';
import * as StashActions from '../git/actions/stash';
import * as TagActions from '../git/actions/tag';
import * as WorktreeActions from '../git/actions/worktree';
import { GitUri } from '../git/gitUri';
import { matchContributor } from '../git/models/contributor';
import {
	ensurePullRequestRefs,
	getComparisonRefsForPullRequest,
	getOpenedPullRequestRepo,
	getOrOpenPullRequestRepository,
	getRepositoryIdentityForPullRequest,
} from '../git/models/pullRequest';
import { createReference } from '../git/models/reference.utils';
import { RemoteResourceType } from '../git/models/remoteResource';
import { deletedOrMissing } from '../git/models/revision';
import { shortenRevision } from '../git/models/revision.utils';
import { showPatchesView } from '../plus/drafts/actions';
import { getPullRequestBranchDeepLink } from '../plus/launchpad/launchpadProvider';
import type { AssociateIssueWithBranchCommandArgs } from '../plus/startWork/startWork';
import { showContributorsPicker } from '../quickpicks/contributorsPicker';
import { filterMap } from '../system/array';
import { log } from '../system/decorators/log';
import { partial, sequentialize } from '../system/function';
import { join, map } from '../system/iterable';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	executeEditorCommand,
	registerCommand,
} from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import type { OpenWorkspaceLocation } from '../system/vscode/utils';
import { openUrl, openWorkspace, revealInFileExplorer } from '../system/vscode/utils';
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
import type { PullRequestNode } from './nodes/pullRequestNode';
import type { RemoteNode } from './nodes/remoteNode';
import type { RepositoryNode } from './nodes/repositoryNode';
import type { ResultsFileNode } from './nodes/resultsFileNode';
import type { ResultsFilesNode } from './nodes/resultsFilesNode';
import type { StashFileNode } from './nodes/stashFileNode';
import type { StashNode } from './nodes/stashNode';
import type { StatusFileNode } from './nodes/statusFileNode';
import type { TagNode } from './nodes/tagNode';
import type { TagsNode } from './nodes/tagsNode';
import type { WorktreeNode } from './nodes/worktreeNode';
import type { WorktreesNode } from './nodes/worktreesNode';

interface CompareSelectedInfo {
	ref: string;
	repoPath: string | undefined;
	uri?: Uri;
}

export function registerViewCommand(
	command: Commands,
	callback: (...args: any[]) => unknown,
	thisArg?: any,
	multiselect: boolean | 'sequential' = false,
): Disposable {
	return registerCommand(
		command,
		(...args: any[]) => {
			if (multiselect) {
				const [active, selection, ...rest] = args;

				// If there is a node followed by an array of nodes, then check how we want to execute the command
				if (active instanceof ViewNode && Array.isArray(selection) && selection[0] instanceof ViewNode) {
					const nodes = selection.filter((n): n is ViewNode => n?.constructor === active.constructor);

					if (multiselect === 'sequential') {
						if (!nodes.includes(active)) {
							nodes.splice(0, 0, active);
						}

						// Execute the command for each node sequentially
						return sequentialize(
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

export class ViewCommands implements Disposable {
	private readonly _disposable: Disposable;

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			registerViewCommand('gitlens.views.clearComparison', n => this.clearComparison(n), this),
			registerViewCommand('gitlens.views.clearReviewed', n => this.clearReviewed(n), this),
			registerViewCommand(GlCommand.ViewsCopy, partial(copyNode, 'text'), this, true),
			registerViewCommand(GlCommand.ViewsCopyAsMarkdown, partial(copyNode, 'markdown'), this, true),
			registerViewCommand(GlCommand.ViewsCopyUrl, copyNodeUrl, this),
			registerViewCommand(`${GlCommand.ViewsCopyUrl}.multi`, copyNodeUrl, this, true),
			registerViewCommand(GlCommand.ViewsOpenUrl, openNodeUrl, this),
			registerViewCommand(`${GlCommand.ViewsOpenUrl}.multi`, openNodeUrl, this, true),
			registerViewCommand(
				'gitlens.views.collapseNode',
				() => executeCoreCommand('list.collapseAllToFocus'),
				this,
			),
			registerViewCommand(
				'gitlens.views.dismissNode',
				(n: ViewNode) => canViewDismissNode(n.view) && n.view.dismissNode(n),
				this,
			),
			registerViewCommand('gitlens.views.editNode', (n: ViewNode) => canEditNode(n) && n.edit(), this),
			registerViewCommand(
				'gitlens.views.expandNode',
				(n: ViewNode) => n.view.reveal(n, { select: false, focus: false, expand: 3 }),
				this,
			),
			registerViewCommand('gitlens.views.loadMoreChildren', (n: PagerNode) => n.loadMore(), this),
			registerViewCommand('gitlens.views.loadAllChildren', (n: PagerNode) => n.loadAll(), this),
			registerViewCommand(
				'gitlens.views.refreshNode',
				(n: ViewNode, reset?: boolean) => {
					if (reset == null && isPageableViewNode(n)) {
						n.limit = undefined;
						n.view.resetNodeLastKnownLimit(n);
					}

					return n.view.refreshNode(n, reset == null ? true : reset);
				},
				this,
				'sequential',
			),

			registerViewCommand(
				'gitlens.views.setShowRelativeDateMarkersOn',
				() => this.setShowRelativeDateMarkers(true),
				this,
			),
			registerViewCommand(
				'gitlens.views.setShowRelativeDateMarkersOff',
				() => this.setShowRelativeDateMarkers(false),
				this,
			),

			registerViewCommand('gitlens.views.fetch', this.fetch, this),
			registerViewCommand('gitlens.views.publishBranch', this.publishBranch, this),
			registerViewCommand('gitlens.views.publishRepository', this.publishRepository, this),
			registerViewCommand('gitlens.views.pull', this.pull, this),
			registerViewCommand('gitlens.views.push', this.push, this),
			registerViewCommand('gitlens.views.pushWithForce', n => this.push(n, true), this),
			registerViewCommand('gitlens.views.closeRepository', this.closeRepository, this),

			registerViewCommand('gitlens.views.setAsDefault', this.setAsDefault, this),
			registerViewCommand('gitlens.views.unsetAsDefault', this.unsetAsDefault, this),

			registerViewCommand('gitlens.views.openInTerminal', this.openInTerminal, this),
			registerViewCommand('gitlens.views.openInIntegratedTerminal', this.openInIntegratedTerminal, this),
			registerViewCommand('gitlens.views.star', this.star, this),
			registerViewCommand('gitlens.views.star.multi', this.star, this, 'sequential'),
			registerViewCommand('gitlens.views.unstar', this.unstar, this),
			registerViewCommand('gitlens.views.unstar.multi', this.unstar, this, 'sequential'),

			registerViewCommand('gitlens.views.browseRepoAtRevision', this.browseRepoAtRevision, this),
			registerViewCommand(
				'gitlens.views.browseRepoAtRevisionInNewWindow',
				n => this.browseRepoAtRevision(n, { openInNewWindow: true }),
				this,
			),
			registerViewCommand(
				'gitlens.views.browseRepoBeforeRevision',
				n => this.browseRepoAtRevision(n, { before: true }),
				this,
			),
			registerViewCommand(
				'gitlens.views.browseRepoBeforeRevisionInNewWindow',
				n => this.browseRepoAtRevision(n, { before: true, openInNewWindow: true }),
				this,
			),

			registerViewCommand('gitlens.views.addAuthors', this.addAuthors, this),
			registerViewCommand('gitlens.views.addAuthor', this.addAuthor, this),
			registerViewCommand('gitlens.views.addAuthor.multi', this.addAuthor, this, true),

			registerViewCommand(
				'gitlens.views.openBranchOnRemote',
				n => executeCommand(GlCommand.OpenBranchOnRemote, n),
				this,
			),
			registerViewCommand(
				'gitlens.views.openBranchOnRemote.multi',
				n => executeCommand(GlCommand.OpenBranchOnRemote, n),
				this,
				'sequential',
			),

			registerViewCommand('gitlens.views.associateIssueWithBranch', n => this.associateIssueWithBranch(n), this),

			registerViewCommand(
				'gitlens.views.copyRemoteCommitUrl',
				(n, nodes) => this.openCommitOnRemote(n, nodes, true),
				this,
			),
			registerViewCommand(
				'gitlens.views.copyRemoteCommitUrl.multi',
				(n, nodes) => this.openCommitOnRemote(n, nodes, true),
				this,
			),
			registerViewCommand(
				'gitlens.views.openCommitOnRemote',
				(n, nodes) => this.openCommitOnRemote(n, nodes),
				this,
			),
			registerViewCommand(
				'gitlens.views.openCommitOnRemote.multi',
				(n, nodes) => this.openCommitOnRemote(n, nodes),
				this,
			),

			registerViewCommand('gitlens.views.openChanges', this.openChanges, this),
			registerViewCommand('gitlens.views.openChangesWithWorking', this.openChangesWithWorking, this),
			registerViewCommand(
				'gitlens.views.openPreviousChangesWithWorking',
				this.openPreviousChangesWithWorking,
				this,
			),
			registerViewCommand('gitlens.views.openFile', this.openFile, this),
			registerViewCommand('gitlens.views.openFileRevision', this.openRevision, this),
			registerViewCommand('gitlens.views.openChangedFiles', this.openFiles, this),
			registerViewCommand('gitlens.views.openOnlyChangedFiles', this.openOnlyChangedFiles),
			registerViewCommand('gitlens.views.openChangedFileDiffs', (n, o) => this.openAllChanges(n, o), this),
			registerViewCommand(
				'gitlens.views.openChangedFileDiffsWithWorking',
				(n, o) => this.openAllChangesWithWorking(n, o),
				this,
			),
			registerViewCommand(
				'gitlens.views.openChangedFileDiffsIndividually',
				(n, o) => this.openAllChanges(n, o, true),
				this,
			),
			registerViewCommand(
				'gitlens.views.openChangedFileDiffsWithWorkingIndividually',
				(n, o) => this.openAllChangesWithWorking(n, o, true),
				this,
			),
			registerViewCommand('gitlens.views.openChangedFileRevisions', this.openRevisions, this),
			registerViewCommand('gitlens.views.applyChanges', this.applyChanges, this),
			registerViewCommand('gitlens.views.highlightChanges', this.highlightChanges, this),
			registerViewCommand('gitlens.views.highlightRevisionChanges', this.highlightRevisionChanges, this),
			registerViewCommand('gitlens.views.restore', this.restore, this),
			registerViewCommand('gitlens.views.switchToAnotherBranch', this.switch, this),
			registerViewCommand('gitlens.views.switchToBranch', this.switchTo, this),
			registerViewCommand('gitlens.views.switchToCommit', this.switchTo, this),
			registerViewCommand('gitlens.views.switchToTag', this.switchTo, this),
			registerViewCommand('gitlens.views.addRemote', this.addRemote, this),
			registerViewCommand('gitlens.views.pruneRemote', this.pruneRemote, this),
			registerViewCommand('gitlens.views.removeRemote', this.removeRemote, this),

			registerViewCommand('gitlens.views.stageDirectory', this.stageDirectory, this),
			registerViewCommand('gitlens.views.stageFile', this.stageFile, this),
			registerViewCommand('gitlens.views.unstageDirectory', this.unstageDirectory, this),
			registerViewCommand('gitlens.views.unstageFile', this.unstageFile, this),

			registerViewCommand(
				'gitlens.views.openChangedFileDiffsWithMergeBase',
				this.openChangedFileDiffsWithMergeBase,
				this,
			),

			registerViewCommand('gitlens.views.compareAncestryWithWorking', this.compareAncestryWithWorking, this),
			registerViewCommand('gitlens.views.compareWithHead', this.compareHeadWith, this),
			registerViewCommand('gitlens.views.compareBranchWithHead', this.compareBranchWithHead, this),
			registerViewCommand('gitlens.views.compareWithMergeBase', this.compareWithMergeBase, this),
			registerViewCommand('gitlens.views.compareWithUpstream', this.compareWithUpstream, this),
			registerViewCommand('gitlens.views.compareWithSelected', this.compareWithSelected, this),
			registerViewCommand('gitlens.views.selectForCompare', this.selectForCompare, this),
			registerViewCommand('gitlens.views.compareFileWithSelected', this.compareFileWithSelected, this),
			registerViewCommand('gitlens.views.selectFileForCompare', this.selectFileForCompare, this),
			registerViewCommand('gitlens.views.compareWithWorking', this.compareWorkingWith, this),

			registerViewCommand(
				'gitlens.views.setBranchComparisonToWorking',
				n => this.setBranchComparison(n, 'working'),
				this,
			),
			registerViewCommand(
				'gitlens.views.setBranchComparisonToBranch',
				n => this.setBranchComparison(n, 'branch'),
				this,
			),

			registerViewCommand('gitlens.views.cherryPick', this.cherryPick, this),
			registerViewCommand('gitlens.views.cherryPick.multi', this.cherryPick, this, true),

			registerViewCommand('gitlens.views.title.createBranch', () => this.createBranch()),
			registerViewCommand('gitlens.views.createBranch', this.createBranch, this),
			registerViewCommand('gitlens.views.deleteBranch', this.deleteBranch, this),
			registerViewCommand('gitlens.views.deleteBranch.multi', this.deleteBranch, this, true),
			registerViewCommand('gitlens.views.renameBranch', this.renameBranch, this),

			registerViewCommand('gitlens.views.stash.apply', this.applyStash, this),
			registerViewCommand('gitlens.views.stash.delete', this.deleteStash, this),
			registerViewCommand('gitlens.views.stash.delete.multi', this.deleteStash, this, true),
			registerViewCommand('gitlens.views.stash.rename', this.renameStash, this),

			registerViewCommand('gitlens.views.title.createTag', () => this.createTag()),
			registerViewCommand('gitlens.views.createTag', this.createTag, this),
			registerViewCommand('gitlens.views.deleteTag', this.deleteTag, this),
			registerViewCommand('gitlens.views.deleteTag.multi', this.deleteTag, this, true),

			registerViewCommand('gitlens.views.mergeBranchInto', this.merge, this),
			registerViewCommand('gitlens.views.pushToCommit', this.pushToCommit, this),

			registerViewCommand('gitlens.views.rebaseOntoBranch', this.rebase, this),
			registerViewCommand('gitlens.views.rebaseOntoUpstream', this.rebaseToRemote, this),
			registerViewCommand('gitlens.views.rebaseOntoCommit', this.rebase, this),

			registerViewCommand('gitlens.views.resetCommit', this.resetCommit, this),
			registerViewCommand('gitlens.views.resetToCommit', this.resetToCommit, this),
			registerViewCommand('gitlens.views.resetToTip', this.resetToTip, this),
			registerViewCommand('gitlens.views.revert', this.revert, this),
			registerViewCommand('gitlens.views.undoCommit', this.undoCommit, this),

			registerViewCommand('gitlens.views.createPullRequest', this.createPullRequest, this),
			registerViewCommand('gitlens.views.openPullRequest', this.openPullRequest, this),
			registerViewCommand('gitlens.views.openPullRequestChanges', this.openPullRequestChanges, this),
			registerViewCommand('gitlens.views.openPullRequestComparison', this.openPullRequestComparison, this),

			registerViewCommand('gitlens.views.draft.open', this.openDraft, this),
			registerViewCommand('gitlens.views.draft.openOnWeb', this.openDraftOnWeb, this),

			registerViewCommand('gitlens.views.title.createWorktree', () => this.createWorktree()),
			registerViewCommand('gitlens.views.createWorktree', this.createWorktree, this),
			registerViewCommand('gitlens.views.deleteWorktree', this.deleteWorktree, this),
			registerViewCommand('gitlens.views.deleteWorktree.multi', this.deleteWorktree, this, true),
			registerViewCommand('gitlens.views.openWorktree', this.openWorktree, this),
			registerViewCommand('gitlens.views.openInWorktree', this.openInWorktree, this),
			registerViewCommand('gitlens.views.revealRepositoryInExplorer', this.revealRepositoryInExplorer, this),
			registerViewCommand('gitlens.views.revealWorktreeInExplorer', this.revealWorktreeInExplorer, this),
			registerViewCommand(
				'gitlens.views.openWorktreeInNewWindow',
				n => this.openWorktree(n, undefined, { location: 'newWindow' }),
				this,
			),
			registerViewCommand(
				'gitlens.views.openWorktreeInNewWindow.multi',
				(n, nodes) => this.openWorktree(n, nodes, { location: 'newWindow' }),
				this,
				true,
			),

			registerViewCommand(
				'gitlens.views.setResultsCommitsFilterAuthors',
				n => this.setResultsCommitsFilter(n, true),
				this,
			),
			registerViewCommand(
				'gitlens.views.setResultsCommitsFilterOff',
				n => this.setResultsCommitsFilter(n, false),
				this,
			),
			registerViewCommand(
				'gitlens.views.setContributorsStatisticsOff',
				() => this.setContributorsStatistics(false),
				this,
			),
			registerViewCommand(
				'gitlens.views.setContributorsStatisticsOn',
				() => this.setContributorsStatistics(true),
				this,
			),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	@log()
	private addAuthors(node?: ViewNode) {
		return ContributorActions.addAuthors(getNodeRepoPath(node));
	}

	@log()
	private addAuthor(node?: ContributorNode, nodes?: ContributorNode[]) {
		if (!node?.is('contributor')) return Promise.resolve();

		const contributors = nodes?.length ? nodes.map(n => n.contributor) : [node.contributor];
		return ContributorActions.addAuthors(
			node.repoPath,
			contributors.filter(c => !c.current),
		);
	}

	@log()
	private addRemote(node?: ViewNode) {
		return RemoteActions.add(getNodeRepoPath(node));
	}

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

	@log()
	private applyStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.apply(node.repoPath, node.commit);
	}

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

	@log()
	private cherryPick(node: CommitNode, nodes?: CommitNode[]) {
		if (!node.is('commit')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.ref) : [node.ref];
		return RepoActions.cherryPick(node.repoPath, refs);
	}

	@log()
	private clearComparison(node: ViewNode) {
		if (node.is('compare-branch')) {
			void node.clear();
		}
	}

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

	@log()
	private closeRepository(node: RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('repository', 'repo-folder')) return;

		node.repo.closed = true;
	}

	@log()
	private async createBranch(node?: ViewRefNode | ViewRefFileNode | BranchesNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node?.is('tracking-status')
				  ? node.branch
				  : undefined;
		if (from == null) {
			const branch = await this.container.git.getBranch(
				node?.repoPath ?? this.container.git.getBestRepository()?.uri,
			);
			from = branch;
		}
		return BranchActions.create(node?.repoPath, from);
	}

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

	@log()
	private async createTag(node?: ViewRefNode | ViewRefFileNode | TagsNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node?.is('tracking-status')
				  ? node.branch
				  : undefined;
		if (from == null) {
			const branch = await this.container.git.getBranch(
				node?.repoPath ?? this.container.git.getBestRepository()?.uri,
			);
			from = branch;
		}
		return TagActions.create(node?.repoPath, from);
	}

	@log()
	private async createWorktree(node?: BranchNode | WorktreesNode) {
		if (node?.is('worktrees')) {
			node = undefined;
		}
		if (node != null && !node.is('branch')) return undefined;

		return WorktreeActions.create(node?.repoPath, undefined, node?.ref);
	}

	@log()
	private deleteBranch(node: BranchNode, nodes?: BranchNode[]) {
		if (!node.is('branch')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.branch) : [node.branch];
		return BranchActions.remove(node.repoPath, refs);
	}

	@log()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!node.is('stash')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.commit) : [node.commit];
		return StashActions.drop(node.repoPath, refs);
	}

	@log()
	private renameStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.rename(node.repoPath, node.commit);
	}

	@log()
	private deleteTag(node: TagNode, nodes?: TagNode[]) {
		if (!node.is('tag')) return Promise.resolve();

		const refs = nodes?.length ? nodes.map(n => n.tag) : [node.tag];
		return TagActions.remove(node.repoPath, refs);
	}

	@log()
	private async deleteWorktree(node: WorktreeNode, nodes?: WorktreeNode[]) {
		if (!node.is('worktree')) return undefined;

		const worktrees = nodes?.length ? nodes.map(n => n.worktree) : [node.worktree];
		const uris = worktrees.filter(w => !w.isDefault && !w.opened).map(w => w.uri);
		return WorktreeActions.remove(node.repoPath, uris);
	}

	@log()
	private fetch(node: RemoteNode | RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.fetch(node.repo);
		if (node.is('remote')) return RemoteActions.fetch(node.remote.repoPath, node.remote.name);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.fetch(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

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

	@log()
	private merge(node: BranchNode | TagNode) {
		if (!node.isAny('branch', 'tag')) return Promise.resolve();

		return RepoActions.merge(node.repoPath, node.is('branch') ? node.branch : node.tag);
	}

	@log()
	private openInTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInTerminal', Uri.file(node.repoPath));
	}

	@log()
	private openInIntegratedTerminal(node: BranchTrackingStatusNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('tracking-status', 'repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInIntegratedTerminal', Uri.file(node.repoPath));
	}

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

	@log()
	private async openPullRequestChanges(node: PullRequestNode | LaunchpadItemNode) {
		if (!node.is('pullrequest') && !node.is('launchpad-item')) return Promise.resolve();

		const pr = node.pullRequest;
		if (pr?.refs?.base == null || pr?.refs.head == null) return Promise.resolve();

		const repo = await getOpenedPullRequestRepo(this.container, pr, node.repoPath);
		if (repo == null) return Promise.resolve();

		const refs = getComparisonRefsForPullRequest(repo.path, pr.refs);
		const counts = await ensurePullRequestRefs(
			this.container,
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

	@log()
	private async openPullRequestComparison(node: PullRequestNode | LaunchpadItemNode) {
		if (!node.is('pullrequest') && !node.is('launchpad-item')) return Promise.resolve();

		const pr = node.pullRequest;
		if (pr?.refs?.base == null || pr?.refs.head == null) return Promise.resolve();

		const repo = await getOpenedPullRequestRepo(this.container, pr, node.repoPath);
		if (repo == null) return Promise.resolve();

		const refs = getComparisonRefsForPullRequest(repo.path, pr.refs);
		const counts = await ensurePullRequestRefs(
			this.container,
			pr,
			repo,
			{ promptMessage: `Unable to open comparison for PR #${pr.id} because of a missing remote.` },
			refs,
		);
		if (counts == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
	}

	@log()
	private async openDraft(node: DraftNode) {
		await showPatchesView({ mode: 'view', draft: node.draft });
	}

	@log()
	private async openDraftOnWeb(node: DraftNode) {
		const url = this.container.drafts.generateWebUrl(node.draft);
		await openUrl(url);
	}

	@log()
	private async openWorktree(
		node: BranchNode | WorktreeNode,
		nodes?: (BranchNode | WorktreeNode)[],
		options?: { location?: OpenWorkspaceLocation },
	) {
		if (!node.is('branch') && !node.is('worktree')) return;
		if (node.worktree == null) return;

		let uri;
		if (nodes?.length && options?.location === 'newWindow') {
			type VSCodeWorkspace = {
				folders: ({ name: string; path: string } | { name: string; uri: Uri })[];
				settings: { [key: string]: unknown };
			};

			// TODO@eamodio hash the folder paths to get a unique, but re-usable workspace name?
			const codeWorkspace: VSCodeWorkspace = {
				folders: filterMap(nodes, n =>
					n.worktree != null ? { name: n.worktree.name, path: n.worktree.uri.fsPath } : undefined,
				),
				settings: {},
			};
			uri = Uri.file(getTempFile(`worktrees-${Date.now()}.code-workspace`));

			await workspace.fs.writeFile(uri, new TextEncoder().encode(JSON.stringify(codeWorkspace, null, 2)));
		} else {
			uri = node.worktree.uri;
		}

		openWorkspace(uri, options);
	}

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
						node.branch.getNameWithoutRemote(),
						remoteUrl,
						DeepLinkActionType.SwitchToPullRequestWorktree,
						pr,
					);

					return this.container.deepLinks.processDeepLinkUri(deepLink, false, node.repo);
				}
			}

			return executeGitCommand({
				command: 'switch',
				state: {
					repos: node.repo,
					reference: node.branch,
					skipWorktreeConfirmations: true,
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
				pr.refs.head.branch,
				repoIdentity.remote.url,
				DeepLinkActionType.SwitchToPullRequestWorktree,
				pr,
			);

			const prRepo = await getOrOpenPullRequestRepository(this.container, pr, {
				skipVirtual: true,
			});
			return this.container.deepLinks.processDeepLinkUri(deepLink, false, prRepo);
		}
	}

	@log()
	private pruneRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.prune(node.remote.repoPath, node.remote.name);
	}

	@log()
	private async removeRemote(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return RemoteActions.remove(node.remote.repoPath, node.remote.name);
	}

	@log()
	private publishBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.push(node.repoPath, undefined, node.branch);
		}
		return Promise.resolve();
	}

	@log()
	private publishRepository(node: BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('branch', 'tracking-status')) {
			return executeCoreGitCommand('git.publish', Uri.file(node.repoPath));
		}
		return Promise.resolve();
	}

	@log()
	private pull(node: RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node.isAny('repository', 'repo-folder')) return RepoActions.pull(node.repo);
		if (node.isAny('branch', 'tracking-status')) {
			return RepoActions.pull(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

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

	@log()
	private pushToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.push(node.repoPath, false, node.commit);
	}

	@log()
	private rebase(node: BranchNode | CommitNode | FileRevisionAsCommitNode | TagNode) {
		if (!node.isAny('branch', 'commit', 'file-commit', 'tag')) {
			return Promise.resolve();
		}

		return RepoActions.rebase(node.repoPath, node.ref);
	}

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

	@log()
	private renameBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return BranchActions.rename(node.repoPath, node.branch);
	}

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

	@log()
	private resetToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.reset(node.repoPath, node.ref);
	}

	@log()
	private resetToTip(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(node.ref.ref, node.repoPath, { refType: 'revision', name: node.ref.name }),
		);
	}

	@log()
	private restore(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.restoreFile(node.file, node.ref);
	}

	@log()
	private revealRepositoryInExplorer(node: RepositoryNode) {
		if (!node.is('repository')) return undefined;

		return revealInFileExplorer(node.repo.uri);
	}

	@log()
	private revealWorktreeInExplorer(nodeOrUrl: WorktreeNode | string) {
		if (typeof nodeOrUrl === 'string') return revealInFileExplorer(Uri.parse(nodeOrUrl));
		if (!nodeOrUrl.is('worktree')) return undefined;

		return revealInFileExplorer(nodeOrUrl.worktree.uri);
	}

	@log()
	private revert(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return Promise.resolve();

		return RepoActions.revert(node.repoPath, node.ref);
	}

	@log()
	private setAsDefault(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return node.setAsDefault();
	}

	@log()
	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!node.is('compare-branch')) return undefined;

		return node.setComparisonType(comparisonType);
	}

	@log()
	private setShowRelativeDateMarkers(enabled: boolean) {
		return configuration.updateEffective('views.showRelativeDateMarkers', enabled);
	}

	@log()
	private setContributorsStatistics(enabled: boolean) {
		return configuration.updateEffective('views.showContributorsStatistics', enabled);
	}

	@log()
	private async stageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit') && !node.is('status-file')) {
			return;
		}

		await this.container.git.stageFile(node.repoPath, node.file.path);
		void node.triggerChange();
	}

	@log()
	private async stageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.stageDirectory(node.repoPath, node.relativePath);
		void node.triggerChange();
	}

	@log()
	private star(node: BranchNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('branch', 'repository', 'repo-folder')) {
			return Promise.resolve();
		}

		return node.star();
	}

	@log()
	private switch(node?: ViewNode) {
		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@log()
	private switchTo(node?: ViewNode) {
		if (node instanceof ViewRefNode) {
			return RepoActions.switchTo(node.repoPath, node.is('branch') && node.branch.current ? undefined : node.ref);
		}

		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@log()
	private async undoCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!node.isAny('commit', 'file-commit')) return;

		await CommitActions.undoCommit(this.container, node.ref);
	}

	@log()
	private unsetAsDefault(node: RemoteNode) {
		if (!node.is('remote')) return Promise.resolve();

		return node.setAsDefault(false);
	}

	@log()
	private async unstageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (!node.isAny('commit-file', 'file-commit', 'status-file')) return;

		await this.container.git.unstageFile(node.repoPath, node.file.path);
		void node.triggerChange();
	}

	@log()
	private async unstageDirectory(node: FolderNode) {
		if (!node.is('folder') || !node.relativePath) return;

		await this.container.git.unstageDirectory(node.repoPath, node.relativePath);
		void node.triggerChange();
	}

	@log()
	private unstar(node: BranchNode | RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('branch', 'repository', 'repo-folder')) return Promise.resolve();
		return node.unstar();
	}

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

	@log()
	private compareBranchWithHead(node: BranchNode) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, 'HEAD');
	}

	@log()
	private async compareWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.getBranch(node.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(node.repoPath, branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref.ref, {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@log()
	private async openChangedFileDiffsWithMergeBase(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		const branch = await this.container.git.getBranch(node.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(node.repoPath, branch.ref, node.ref.ref);
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

	@log()
	private compareWithUpstream(node: BranchNode) {
		if (!node.is('branch') || node.branch.upstream == null) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@log()
	private compareWorkingWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, '');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.views.searchAndCompare.compare(node.repoPath, '', node.ref);
	}

	@log()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!node.is('branch')) return undefined;

		const branch = await this.container.git.getBranch(node.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(node.repoPath, branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.views.searchAndCompare.compare(node.repoPath, '', {
			ref: commonAncestor,
			label: `${branch.ref} (${shortenRevision(commonAncestor)})`,
		});
	}

	@log()
	private compareWithSelected(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.views.searchAndCompare.compareWithSelected(node.repoPath, node.ref);
	}

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

		return executeCommand<DiffWithCommandArgs, void>(GlCommand.DiffWith, {
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

			return (individually ? CommitActions.openAllChangesIndividually : CommitActions.openAllChanges)(
				comparison.files,
				{ repoPath: comparison.repoPath, lhs: comparison.ref1, rhs: comparison.ref2 },
				options,
			);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return (individually ? CommitActions.openAllChangesIndividually : CommitActions.openAllChanges)(
			node.commit,
			options,
		);
	}

	@log()
	private openCommitOnRemote(node: ViewRefNode, nodes?: ViewRefNode[], clipboard?: boolean) {
		const refs = nodes?.length ? nodes.map(n => n.ref) : [node.ref];

		return executeCommand<OpenOnRemoteCommandArgs>(GlCommand.OpenOnRemote, {
			repoPath: refs[0].repoPath,
			resource: refs.map(r => ({ type: RemoteResourceType.Commit, sha: r.ref })),
			clipboard: clipboard,
		});
	}

	@log()
	private openChanges(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('conflict-file')) {
			void executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
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
			case GlCommand.DiffWith: {
				const [args] = command.arguments as [DiffWithCommandArgs];
				args.showOptions!.preview = false;
				void executeCommand<DiffWithCommandArgs>(command.command, args);
				break;
			}
			case GlCommand.DiffWithPrevious: {
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

			return (
				individually
					? CommitActions.openAllChangesWithWorkingIndividually
					: CommitActions.openAllChangesWithWorking
			)(comparison.files, { repoPath: comparison.repoPath, ref: comparison.ref1 || comparison.ref2 }, options);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return (
			individually ? CommitActions.openAllChangesWithWorkingIndividually : CommitActions.openAllChangesWithWorking
		)(node.commit, options);
	}

	@log()
	private async openChangesWithWorking(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('status-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(GlCommand.DiffWithWorking, undefined, {
				uri: node.uri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		}

		if (node.is('conflict-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(GlCommand.DiffWithWorking, undefined, {
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
				return executeEditorCommand<DiffWithWorkingCommandArgs>(GlCommand.DiffWithWorking, undefined, {
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
			ref: node.is('results-file') ? node.ref2 : node.ref.ref,
		});
	}

	@log()
	private async openPreviousChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: node.is('results-file') ? node.ref1 : `${node.ref.ref}^`,
		});
	}

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

			return CommitActions.openOnlyChangedFiles(comparison.files);
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openOnlyChangedFiles(node.commit);
	}

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
				uri = this.container.git.getRevisionUri(node.uri);
			} else {
				uri =
					node.commit.file?.status === 'D'
						? this.container.git.getRevisionUri(
								(await node.commit.getPreviousSha()) ?? deletedOrMissing,
								node.commit.file.path,
								node.commit.repoPath,
						  )
						: this.container.git.getRevisionUri(node.uri);
			}
		}

		return CommitActions.openFileAtRevision(uri, options.showOptions ?? { preserveFocus: true, preview: false });
	}

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

	@log()
	private async setResultsCommitsFilter(node: ViewNode, filter: boolean) {
		if (!node?.isAny('compare-results', 'compare-branch')) return;

		const repo = this.container.git.getRepository(node.repoPath);
		if (repo == null) return;

		if (filter) {
			let authors = node.getState('filterCommits');
			if (authors == null) {
				const current = await this.container.git.getCurrentUser(repo.uri);
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

	@log()
	private async associateIssueWithBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		executeCommand<AssociateIssueWithBranchCommandArgs>(GlCommand.AssociateIssueWithBranch, {
			command: 'associateIssueWithBranch',
			branch: node.ref,
			source: 'view',
		});
	}
}

async function copyNode(type: ClipboardType, active: ViewNode | undefined, selection: ViewNode[]): Promise<void> {
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

async function copyNodeUrl(active: ViewNode | undefined, selection: ViewNode[]): Promise<void> {
	const urls = await getNodeUrls(active, selection);
	if (urls.length === 0) return;

	await env.clipboard.writeText(urls.join('\n'));
}

async function openNodeUrl(active: ViewNode | undefined, selection: ViewNode[]): Promise<void> {
	const urls = await getNodeUrls(active, selection);
	if (urls.length === 0) return;

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

async function getNodeUrls(active: ViewNode | undefined, selection: ViewNode[]): Promise<string[]> {
	selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
	if (selection.length === 0) return Promise.resolve([]);

	return [
		...filterMap(await Promise.allSettled(map(selection, n => n.getUrl?.())), r =>
			r.status === 'fulfilled' && r.value?.trim() ? r.value : undefined,
		),
	];
}
