import type { Disposable, TextDocumentShowOptions } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens';
import type { DiffWithCommandArgs } from '../commands/diffWith';
import type { DiffWithPreviousCommandArgs } from '../commands/diffWithPrevious';
import type { DiffWithWorkingCommandArgs } from '../commands/diffWithWorking';
import type { OpenFileAtRevisionCommandArgs } from '../commands/openFileAtRevision';
import type { ViewShowBranchComparison } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { browseAtRevision } from '../git/actions';
import * as BranchActions from '../git/actions/branch';
import * as CommitActions from '../git/actions/commit';
import * as ContributorActions from '../git/actions/contributor';
import * as RemoteActions from '../git/actions/remote';
import * as RepoActions from '../git/actions/repository';
import * as StashActions from '../git/actions/stash';
import * as TagActions from '../git/actions/tag';
import * as WorktreeActions from '../git/actions/worktree';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing } from '../git/models/constants';
import { matchContributor } from '../git/models/contributor';
import type { GitStashReference } from '../git/models/reference';
import { createReference, getReferenceLabel, shortenRevision } from '../git/models/reference';
import { showContributorsPicker } from '../quickpicks/contributorsPicker';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	executeEditorCommand,
	registerCommand,
} from '../system/command';
import { configuration } from '../system/configuration';
import { setContext } from '../system/context';
import { log } from '../system/decorators/log';
import { sequentialize } from '../system/function';
import type { OpenWorkspaceLocation } from '../system/utils';
import { openWorkspace, revealInFileExplorer } from '../system/utils';
import type { RepositoryFolderNode } from './nodes/abstract/repositoryFolderNode';
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
import type { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import type { CommitFileNode } from './nodes/commitFileNode';
import type { CommitNode } from './nodes/commitNode';
import type { PagerNode } from './nodes/common';
import type { ContributorNode } from './nodes/contributorNode';
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

const enum ViewCommandMultiSelectMode {
	Disallowed,
	Allowed,
	Custom,
}

export function registerViewCommand(
	command: string,
	callback: (...args: any[]) => unknown,
	thisArg?: any,
	multiSelect: ViewCommandMultiSelectMode = ViewCommandMultiSelectMode.Allowed,
): Disposable {
	return registerCommand(
		command,
		(...args: any[]) => {
			if (multiSelect !== ViewCommandMultiSelectMode.Disallowed) {
				let [node, nodes, ...rest] = args;
				// If there is a node followed by an array of nodes, then we want to execute the command for each
				if (node instanceof ViewNode && Array.isArray(nodes) && nodes[0] instanceof ViewNode) {
					nodes = nodes.filter(n => n?.constructor === node.constructor);

					if (multiSelect === ViewCommandMultiSelectMode.Custom) {
						return callback.apply(thisArg, [node, nodes, ...rest]);
					}

					return sequentialize(
						callback,
						// eslint-disable-next-line @typescript-eslint/no-unsafe-return
						(nodes as ViewNode[]).map(n => [n, ...rest]),
						thisArg,
					);
				}
			}

			return callback.apply(thisArg, args);
		},
		thisArg,
	);
}

export class ViewCommands {
	constructor(private readonly container: Container) {
		registerViewCommand('gitlens.views.clearComparison', n => this.clearComparison(n), this);
		registerViewCommand('gitlens.views.clearReviewed', n => this.clearReviewed(n), this);
		// Register independently as it already handles copying multiple nodes
		registerCommand(
			Commands.ViewsCopy,
			async (active: ViewNode | undefined, selection: ViewNode[]) => {
				selection = Array.isArray(selection) ? selection : active != null ? [active] : [];
				if (selection.length === 0) return;

				const data = selection
					.map(n => n.toClipboard?.())
					.filter(s => Boolean(s))
					.join('\n');
				await env.clipboard.writeText(data);
			},
			this,
		);
		registerViewCommand('gitlens.views.collapseNode', () => executeCoreCommand('list.collapseAllToFocus'), this);
		registerViewCommand(
			'gitlens.views.dismissNode',
			(n: ViewNode) => canViewDismissNode(n.view) && n.view.dismissNode(n),
			this,
		);
		registerViewCommand('gitlens.views.editNode', (n: ViewNode) => canEditNode(n) && n.edit(), this);
		registerViewCommand(
			'gitlens.views.expandNode',
			(n: ViewNode) => n.view.reveal(n, { select: false, focus: false, expand: 3 }),
			this,
		);
		registerViewCommand('gitlens.views.loadMoreChildren', (n: PagerNode) => n.loadMore(), this);
		registerViewCommand('gitlens.views.loadAllChildren', (n: PagerNode) => n.loadAll(), this);
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
		);

		registerViewCommand(
			'gitlens.views.setShowRelativeDateMarkersOn',
			() => this.setShowRelativeDateMarkers(true),
			this,
		);
		registerViewCommand(
			'gitlens.views.setShowRelativeDateMarkersOff',
			() => this.setShowRelativeDateMarkers(false),
			this,
		);

		registerViewCommand('gitlens.views.fetch', this.fetch, this);
		registerViewCommand('gitlens.views.publishBranch', this.publishBranch, this);
		registerViewCommand('gitlens.views.publishRepository', this.publishRepository, this);
		registerViewCommand('gitlens.views.pull', this.pull, this);
		registerViewCommand('gitlens.views.push', this.push, this);
		registerViewCommand('gitlens.views.pushWithForce', n => this.push(n, true), this);
		registerViewCommand('gitlens.views.closeRepository', this.closeRepository, this);

		registerViewCommand('gitlens.views.setAsDefault', this.setAsDefault, this);
		registerViewCommand('gitlens.views.unsetAsDefault', this.unsetAsDefault, this);

		registerViewCommand('gitlens.views.openInTerminal', this.openInTerminal, this);
		registerViewCommand('gitlens.views.star', this.star, this);
		registerViewCommand('gitlens.views.unstar', this.unstar, this);

		registerViewCommand('gitlens.views.browseRepoAtRevision', this.browseRepoAtRevision, this);
		registerViewCommand(
			'gitlens.views.browseRepoAtRevisionInNewWindow',
			n => this.browseRepoAtRevision(n, { openInNewWindow: true }),
			this,
		);
		registerViewCommand(
			'gitlens.views.browseRepoBeforeRevision',
			n => this.browseRepoAtRevision(n, { before: true }),
			this,
		);
		registerViewCommand(
			'gitlens.views.browseRepoBeforeRevisionInNewWindow',
			n => this.browseRepoAtRevision(n, { before: true, openInNewWindow: true }),
			this,
		);

		registerViewCommand('gitlens.views.addAuthors', this.addAuthors, this);
		registerViewCommand('gitlens.views.addAuthor', this.addAuthor, this);

		registerViewCommand('gitlens.views.openChanges', this.openChanges, this);
		registerViewCommand('gitlens.views.openChangesWithWorking', this.openChangesWithWorking, this);
		registerViewCommand('gitlens.views.openPreviousChangesWithWorking', this.openPreviousChangesWithWorking, this);
		registerViewCommand('gitlens.views.openFile', this.openFile, this);
		registerViewCommand('gitlens.views.openFileRevision', this.openRevision, this);
		registerViewCommand('gitlens.views.openChangedFiles', this.openFiles, this);
		registerViewCommand('gitlens.views.openChangedFileDiffs', this.openAllChanges, this);
		registerViewCommand('gitlens.views.openChangedFileDiffsWithWorking', this.openAllChangesWithWorking, this);
		registerViewCommand('gitlens.views.openChangedFileRevisions', this.openRevisions, this);
		registerViewCommand('gitlens.views.applyChanges', this.applyChanges, this);
		registerViewCommand('gitlens.views.highlightChanges', this.highlightChanges, this);
		registerViewCommand('gitlens.views.highlightRevisionChanges', this.highlightRevisionChanges, this);
		registerViewCommand('gitlens.views.restore', this.restore, this);
		registerViewCommand('gitlens.views.switchToAnotherBranch', this.switch, this);
		registerViewCommand('gitlens.views.switchToBranch', this.switchTo, this);
		registerViewCommand('gitlens.views.switchToCommit', this.switchTo, this);
		registerViewCommand('gitlens.views.switchToTag', this.switchTo, this);
		registerViewCommand('gitlens.views.addRemote', this.addRemote, this);
		registerViewCommand('gitlens.views.pruneRemote', this.pruneRemote, this);
		registerViewCommand('gitlens.views.removeRemote', this.removeRemote, this);

		registerViewCommand('gitlens.views.stageDirectory', this.stageDirectory, this);
		registerViewCommand('gitlens.views.stageFile', this.stageFile, this);
		registerViewCommand('gitlens.views.unstageDirectory', this.unstageDirectory, this);
		registerViewCommand('gitlens.views.unstageFile', this.unstageFile, this);

		registerViewCommand('gitlens.views.compareAncestryWithWorking', this.compareAncestryWithWorking, this);
		registerViewCommand('gitlens.views.compareWithHead', this.compareHeadWith, this);
		registerViewCommand('gitlens.views.compareWithUpstream', this.compareWithUpstream, this);
		registerViewCommand('gitlens.views.compareWithSelected', this.compareWithSelected, this);
		registerViewCommand('gitlens.views.selectForCompare', this.selectForCompare, this);
		registerViewCommand('gitlens.views.compareFileWithSelected', this.compareFileWithSelected, this);
		registerViewCommand('gitlens.views.selectFileForCompare', this.selectFileForCompare, this);
		registerViewCommand('gitlens.views.compareWithWorking', this.compareWorkingWith, this);

		registerViewCommand(
			'gitlens.views.setBranchComparisonToWorking',
			n => this.setBranchComparison(n, 'working'),
			this,
		);
		registerViewCommand(
			'gitlens.views.setBranchComparisonToBranch',
			n => this.setBranchComparison(n, 'branch'),
			this,
		);

		registerViewCommand('gitlens.views.cherryPick', this.cherryPick, this, ViewCommandMultiSelectMode.Custom);

		registerViewCommand('gitlens.views.title.createBranch', () => this.createBranch());
		registerViewCommand('gitlens.views.createBranch', this.createBranch, this);
		registerViewCommand('gitlens.views.deleteBranch', this.deleteBranch, this);
		registerViewCommand('gitlens.views.renameBranch', this.renameBranch, this);

		registerViewCommand('gitlens.views.title.applyStash', () => this.applyStash());
		registerViewCommand('gitlens.views.stash.delete', this.deleteStash, this, ViewCommandMultiSelectMode.Custom);
		registerViewCommand('gitlens.views.stash.rename', this.renameStash, this);

		registerViewCommand('gitlens.views.title.createTag', () => this.createTag());
		registerViewCommand('gitlens.views.createTag', this.createTag, this);
		registerViewCommand('gitlens.views.deleteTag', this.deleteTag, this);

		registerViewCommand('gitlens.views.mergeBranchInto', this.merge, this);
		registerViewCommand('gitlens.views.pushToCommit', this.pushToCommit, this);

		registerViewCommand('gitlens.views.rebaseOntoBranch', this.rebase, this);
		registerViewCommand('gitlens.views.rebaseOntoUpstream', this.rebaseToRemote, this);
		registerViewCommand('gitlens.views.rebaseOntoCommit', this.rebase, this);

		registerViewCommand('gitlens.views.resetCommit', this.resetCommit, this);
		registerViewCommand('gitlens.views.resetToCommit', this.resetToCommit, this);
		registerViewCommand('gitlens.views.resetToTip', this.resetToTip, this);
		registerViewCommand('gitlens.views.revert', this.revert, this);
		registerViewCommand('gitlens.views.undoCommit', this.undoCommit, this);

		registerViewCommand('gitlens.views.createPullRequest', this.createPullRequest, this);
		registerViewCommand('gitlens.views.openPullRequest', this.openPullRequest, this);

		registerViewCommand('gitlens.views.title.createWorktree', () => this.createWorktree());
		registerViewCommand('gitlens.views.createWorktree', this.createWorktree, this);
		registerViewCommand('gitlens.views.deleteWorktree', this.deleteWorktree, this);
		registerViewCommand('gitlens.views.openWorktree', this.openWorktree, this);
		registerViewCommand('gitlens.views.revealRepositoryInExplorer', this.revealRepositoryInExplorer, this);
		registerViewCommand('gitlens.views.revealWorktreeInExplorer', this.revealWorktreeInExplorer, this);
		registerViewCommand(
			'gitlens.views.openWorktreeInNewWindow',
			n => this.openWorktree(n, { location: 'newWindow' }),
			this,
		);

		registerViewCommand(
			'gitlens.views.setResultsCommitsFilterAuthors',
			n => this.setResultsCommitsFilter(n, true),
			this,
		);
		registerViewCommand(
			'gitlens.views.setResultsCommitsFilterOff',
			n => this.setResultsCommitsFilter(n, false),
			this,
		);
	}

	@log()
	private addAuthors(node?: ViewNode) {
		return ContributorActions.addAuthors(getNodeRepoPath(node));
	}

	@log()
	private addAuthor(node?: ContributorNode) {
		if (node?.is('contributor')) {
			return ContributorActions.addAuthors(
				node.repoPath,
				node.contributor.current ? undefined : node.contributor,
			);
		}

		return Promise.resolve();
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
	private applyStash() {
		return StashActions.apply();
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

		if (nodes != null && nodes.length !== 0) {
			return RepoActions.cherryPick(
				node.repoPath,
				nodes.map(n => n.ref),
			);
		}

		return RepoActions.cherryPick(node.repoPath, node.ref);
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
	private deleteBranch(node: BranchNode) {
		if (!node.is('branch')) return Promise.resolve();

		return BranchActions.remove(node.repoPath, node.branch);
	}

	@log()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!node.is('stash')) return Promise.resolve();

		if (nodes != null && nodes.length !== 0) {
			const sorted = nodes.sort((a, b) => parseInt(b.commit.number, 10) - parseInt(a.commit.number, 10));

			return sequentialize(
				StashActions.drop,
				sorted.map<[string, GitStashReference]>(n => [n.repoPath, n.commit]),
				this,
			);
		}
		return StashActions.drop(node.repoPath, node.commit);
	}

	@log()
	private renameStash(node: StashNode) {
		if (!node.is('stash')) return Promise.resolve();

		return StashActions.rename(node.repoPath, node.commit);
	}

	@log()
	private deleteTag(node: TagNode) {
		if (!node.is('tag')) return Promise.resolve();

		return TagActions.remove(node.repoPath, node.tag);
	}

	@log()
	private async deleteWorktree(node: WorktreeNode) {
		if (!node.is('worktree')) return undefined;

		return WorktreeActions.remove(node.repoPath, node.worktree.uri);
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
	private openInTerminal(node: RepositoryNode | RepositoryFolderNode) {
		if (!node.isAny('repository', 'repo-folder')) return Promise.resolve();

		return executeCoreCommand('openInTerminal', Uri.file(node.repo.path));
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
	private openWorktree(node: WorktreeNode, options?: { location?: OpenWorkspaceLocation }) {
		if (!node.is('worktree')) return;

		openWorkspace(node.worktree.uri, options);
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

		const upstream = node.is('branch') ? node.branch.upstream?.name : node.status.upstream;
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
	private revealWorktreeInExplorer(node: WorktreeNode) {
		if (!node.is('worktree')) return undefined;

		return revealInFileExplorer(node.worktree.uri);
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

		const repo = await this.container.git.getOrOpenScmRepository(node.repoPath);
		const commit = await repo?.getCommit('HEAD');

		if (commit?.hash !== node.ref.ref) {
			void window.showWarningMessage(
				`Commit ${getReferenceLabel(node.ref, {
					capitalize: true,
					icon: false,
				})} cannot be undone, because it is no longer the most recent commit.`,
			);

			return;
		}

		await executeCoreGitCommand('git.undoCommit', node.repoPath);
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
	private compareHeadWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, 'HEAD');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, 'HEAD', node.ref);
	}

	@log()
	private compareWithUpstream(node: BranchNode) {
		if (!node.is('branch') || node.branch.upstream == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@log()
	private compareWorkingWith(node: ViewRefNode | ViewRefFileNode) {
		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, '');
		}

		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, '', node.ref);
	}

	@log()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!node.is('branch')) return undefined;

		const branch = await this.container.git.getBranch(node.repoPath);
		if (branch == null) return undefined;

		const commonAncestor = await this.container.git.getMergeBase(node.repoPath, branch.ref, node.ref.ref);
		if (commonAncestor == null) return undefined;

		return this.container.searchAndCompareView.compare(
			node.repoPath,
			{
				ref: commonAncestor,
				label: `ancestry with ${node.ref.ref} (${shortenRevision(commonAncestor)})`,
			},
			'',
		);
	}

	@log()
	private compareWithSelected(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.searchAndCompareView.compareWithSelected(node.repoPath, node.ref);
	}

	@log()
	private selectForCompare(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.searchAndCompareView.selectForCompare(node.repoPath, node.ref);
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

		return executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
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
	private async openAllChanges(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (node.is('results-files')) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openAllChanges(
				diff,
				{
					repoPath: node.repoPath,
					lhs: node.ref1,
					rhs: node.ref2,
				},
				options,
			);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openAllChanges(node.commit, options);
	}

	@log()
	private openChanges(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('conflict-file')) {
			void executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
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
			case Commands.DiffWith: {
				const [args] = command.arguments as [DiffWithCommandArgs];
				args.showOptions!.preview = false;
				void executeCommand<DiffWithCommandArgs>(command.command, args);
				break;
			}
			case Commands.DiffWithPrevious: {
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
		node: CommitNode | StashNode | ResultsFilesNode,
		options?: TextDocumentShowOptions,
	) {
		if (node.is('results-files')) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openAllChangesWithWorking(
				diff,
				{
					repoPath: node.repoPath,
					ref: node.ref1 || node.ref2,
				},
				options,
			);
		}

		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openAllChangesWithWorking(node.commit, options);

		// options = { preserveFocus: false, preview: false, ...options };

		// let repoPath: string;
		// let files;
		// let ref: string;

		// if (node instanceof ResultsFilesNode) {
		// 	const { diff } = await node.getFilesQueryResults();
		// 	if (diff == null || diff.length === 0) return;

		// 	repoPath = node.repoPath;
		// 	files = diff;
		// 	ref = node.ref1 || node.ref2;
		// } else {
		// 	repoPath = node.commit.repoPath;
		// 	files = node.commit.files;
		// 	ref = node.commit.sha;
		// }

		// if (files.length > 20) {
		// 	const result = await window.showWarningMessage(
		// 		`Are you sure you want to open all ${files.length} files?`,
		// 		{ title: 'Yes' },
		// 		{ title: 'No', isCloseAffordance: true },
		// 	);
		// 	if (result == null || result.title === 'No') return;
		// }

		// for (const file of files) {
		// 	if (file.status === 'A' || file.status === 'D') continue;

		// 	const args: DiffWithWorkingCommandArgs = {
		// 		showOptions: options,
		// 	};

		// 	const uri = GitUri.fromFile(file, repoPath, ref);
		// 	await executeCommand(Commands.DiffWithWorking, uri, args);
		// }
	}

	@log()
	private async openChangesWithWorking(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (node.is('status-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
				uri: node.uri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		}

		if (node.is('conflict-file')) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
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
				return executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
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
	private async openFiles(node: CommitNode | StashNode | ResultsFilesNode) {
		if (node.is('results-files')) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openFiles(diff, node.repoPath, node.ref1 || node.ref2);
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openFiles(node.commit);
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
	private async openRevisions(node: CommitNode | StashNode | ResultsFilesNode, _options?: TextDocumentShowOptions) {
		if (node.is('results-files')) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openFilesAtRevision(diff, node.repoPath, node.ref1, node.ref2);
		}
		if (!node.isAny('commit', 'stash')) return undefined;

		return CommitActions.openFilesAtRevision(node.commit);
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
}
