import type { Disposable, TextDocumentShowOptions } from 'vscode';
import { env, Uri, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens';
import type {
	DiffWithCommandArgs,
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	OpenFileAtRevisionCommandArgs,
} from '../commands';
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
import type { GitStashReference } from '../git/models/reference';
import { createReference, getReferenceLabel, shortenRevision } from '../git/models/reference';
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
import { debug } from '../system/decorators/log';
import { sequentialize } from '../system/function';
import type { OpenWorkspaceLocation } from '../system/utils';
import { openWorkspace } from '../system/utils';
import type { BranchesNode } from './nodes/branchesNode';
import { BranchNode } from './nodes/branchNode';
import { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import { CommitFileNode } from './nodes/commitFileNode';
import { CommitNode } from './nodes/commitNode';
import type { PagerNode } from './nodes/common';
import { CompareBranchNode } from './nodes/compareBranchNode';
import { ContributorNode } from './nodes/contributorNode';
import { FileHistoryNode } from './nodes/fileHistoryNode';
import { FileRevisionAsCommitNode } from './nodes/fileRevisionAsCommitNode';
import { FolderNode } from './nodes/folderNode';
import { LineHistoryNode } from './nodes/lineHistoryNode';
import { MergeConflictFileNode } from './nodes/mergeConflictFileNode';
import { PullRequestNode } from './nodes/pullRequestNode';
import { RemoteNode } from './nodes/remoteNode';
import { RepositoryNode } from './nodes/repositoryNode';
import { ResultsFileNode } from './nodes/resultsFileNode';
import { ResultsFilesNode } from './nodes/resultsFilesNode';
import { StashFileNode } from './nodes/stashFileNode';
import { StashNode } from './nodes/stashNode';
import { StatusFileNode } from './nodes/statusFileNode';
import { TagNode } from './nodes/tagNode';
import type { TagsNode } from './nodes/tagsNode';
import {
	canClearNode,
	canEditNode,
	canViewDismissNode,
	getNodeRepoPath,
	isPageableViewNode,
	RepositoryFolderNode,
	ViewNode,
	ViewRefFileNode,
	ViewRefNode,
} from './nodes/viewNode';
import { WorktreeNode } from './nodes/worktreeNode';
import { WorktreesNode } from './nodes/worktreesNode';

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
		registerViewCommand('gitlens.views.clearNode', (n: ViewNode) => canClearNode(n) && n.clear(), this);
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
	}
	@debug()
	private addAuthors(node?: ViewNode) {
		return ContributorActions.addAuthors(getNodeRepoPath(node));
	}

	@debug()
	private addAuthor(node?: ContributorNode) {
		if (node instanceof ContributorNode) {
			return ContributorActions.addAuthors(
				node.repoPath,
				node.contributor.current ? undefined : node.contributor,
			);
		}

		return Promise.resolve();
	}

	@debug()
	private addRemote(node?: ViewNode) {
		return RemoteActions.add(getNodeRepoPath(node));
	}

	@debug()
	private applyChanges(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		if (node instanceof ResultsFileNode) {
			return CommitActions.applyChanges(
				node.file,
				createReference(node.ref1, node.repoPath),
				createReference(node.ref2, node.repoPath),
			);
		}

		if (node.ref == null || node.ref.ref === 'HEAD') return Promise.resolve();

		return CommitActions.applyChanges(node.file, node.ref);
	}

	@debug()
	private applyStash() {
		return StashActions.apply();
	}

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

	@debug()
	private cherryPick(node: CommitNode, nodes?: CommitNode[]) {
		if (!(node instanceof CommitNode)) return Promise.resolve();

		if (nodes != null && nodes.length !== 0) {
			return RepoActions.cherryPick(
				node.repoPath,
				nodes.map(n => n.ref),
			);
		}

		return RepoActions.cherryPick(node.repoPath, node.ref);
	}

	@debug()
	private closeRepository(node: RepositoryNode | RepositoryFolderNode) {
		if (!(node instanceof RepositoryNode) && !(node instanceof RepositoryFolderNode)) return;

		node.repo.closed = true;
	}

	@debug()
	private async createBranch(node?: ViewRefNode | ViewRefFileNode | BranchesNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node instanceof BranchTrackingStatusNode
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

	@debug()
	private async createPullRequest(node: BranchNode | BranchTrackingStatusNode) {
		if (!(node instanceof BranchNode) && !(node instanceof BranchTrackingStatusNode)) {
			return Promise.resolve();
		}

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

	@debug()
	private async createTag(node?: ViewRefNode | ViewRefFileNode | TagsNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode || node instanceof ViewRefFileNode
				? node?.ref
				: node instanceof BranchTrackingStatusNode
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

	@debug()
	private async createWorktree(node?: BranchNode | WorktreesNode) {
		if (node instanceof WorktreesNode) {
			node = undefined;
		}
		if (node != null && !(node instanceof BranchNode)) return undefined;

		return WorktreeActions.create(node?.repoPath, undefined, node?.ref);
	}

	@debug()
	private deleteBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();

		return BranchActions.remove(node.repoPath, node.branch);
	}

	@debug()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!(node instanceof StashNode)) return Promise.resolve();

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

	@debug()
	private renameStash(node: StashNode) {
		if (!(node instanceof StashNode)) return Promise.resolve();

		return StashActions.rename(node.repoPath, node.commit);
	}

	@debug()
	private deleteTag(node: TagNode) {
		if (!(node instanceof TagNode)) return Promise.resolve();

		return TagActions.remove(node.repoPath, node.tag);
	}

	@debug()
	private async deleteWorktree(node: WorktreeNode) {
		if (!(node instanceof WorktreeNode)) return undefined;

		return WorktreeActions.remove(node.repoPath, node.worktree.uri);
	}

	@debug()
	private fetch(node: RemoteNode | RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node instanceof RepositoryNode || node instanceof RepositoryFolderNode) return RepoActions.fetch(node.repo);
		if (node instanceof RemoteNode) return RemoteActions.fetch(node.remote.repoPath, node.remote.name);
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return RepoActions.fetch(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

	@debug()
	private async highlightChanges(node: CommitFileNode | StashFileNode | FileRevisionAsCommitNode | ResultsFileNode) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof ResultsFileNode)
		) {
			return;
		}

		await this.openFile(node, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: node.ref.ref },
			true,
		));
	}

	@debug()
	private async highlightRevisionChanges(
		node: CommitFileNode | StashFileNode | FileRevisionAsCommitNode | ResultsFileNode,
	) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof ResultsFileNode)
		) {
			return;
		}

		await this.openFile(node, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: node.ref.ref, only: true },
			true,
		));
	}

	@debug()
	private merge(node: BranchNode | TagNode) {
		if (!(node instanceof BranchNode) && !(node instanceof TagNode)) return Promise.resolve();

		return RepoActions.merge(node.repoPath, node instanceof BranchNode ? node.branch : node.tag);
	}

	@debug()
	private openInTerminal(node: RepositoryNode | RepositoryFolderNode) {
		if (!(node instanceof RepositoryNode) && !(node instanceof RepositoryFolderNode)) return Promise.resolve();

		return executeCoreCommand('openInTerminal', Uri.file(node.repo.path));
	}

	@debug()
	private openPullRequest(node: PullRequestNode) {
		if (!(node instanceof PullRequestNode)) return Promise.resolve();

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

	@debug()
	private openWorktree(node: WorktreeNode, options?: { location?: OpenWorkspaceLocation }) {
		if (!(node instanceof WorktreeNode)) return;

		openWorkspace(node.worktree.uri, options);
	}

	@debug()
	private pruneRemote(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return Promise.resolve();

		return RemoteActions.prune(node.remote.repoPath, node.remote.name);
	}

	@debug()
	private async removeRemote(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return Promise.resolve();

		return RemoteActions.remove(node.remote.repoPath, node.remote.name);
	}

	@debug()
	private publishBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return RepoActions.push(node.repoPath, undefined, node.branch);
		}
		return Promise.resolve();
	}

	@debug()
	private publishRepository(node: BranchNode | BranchTrackingStatusNode) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return executeCoreGitCommand('git.publish', Uri.file(node.repoPath));
		}
		return Promise.resolve();
	}

	@debug()
	private pull(node: RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node instanceof RepositoryNode || node instanceof RepositoryFolderNode) return RepoActions.pull(node.repo);
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return RepoActions.pull(node.repoPath, node.root ? undefined : node.branch);
		}

		return Promise.resolve();
	}

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
		if (node instanceof RepositoryNode || node instanceof RepositoryFolderNode) {
			return RepoActions.push(node.repo, force);
		}

		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return RepoActions.push(node.repoPath, force, node.root ? undefined : node.branch);
		}

		if (node instanceof CommitNode || node instanceof FileRevisionAsCommitNode) {
			if (node.isTip) {
				return RepoActions.push(node.repoPath, force);
			}

			return this.pushToCommit(node);
		}

		return Promise.resolve();
	}

	@debug()
	private pushToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return RepoActions.push(node.repoPath, false, node.commit);
	}

	@debug()
	private rebase(node: BranchNode | CommitNode | FileRevisionAsCommitNode | TagNode) {
		if (
			!(node instanceof BranchNode) &&
			!(node instanceof CommitNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof TagNode)
		) {
			return Promise.resolve();
		}

		return RepoActions.rebase(node.repoPath, node.ref);
	}

	@debug()
	private rebaseToRemote(node: BranchNode | BranchTrackingStatusNode) {
		if (!(node instanceof BranchNode) && !(node instanceof BranchTrackingStatusNode)) return Promise.resolve();

		const upstream = node instanceof BranchNode ? node.branch.upstream?.name : node.status.upstream;
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

	@debug()
	private renameBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();

		return BranchActions.rename(node.repoPath, node.branch);
	}

	@debug()
	private resetCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(`${node.ref.ref}^`, node.ref.repoPath, {
				refType: 'revision',
				name: `${node.ref.name}^`,
				message: node.ref.message,
			}),
		);
	}

	@debug()
	private resetToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return RepoActions.reset(node.repoPath, node.ref);
	}

	@debug()
	private resetToTip(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();

		return RepoActions.reset(
			node.repoPath,
			createReference(node.ref.ref, node.repoPath, { refType: 'revision', name: node.ref.name }),
		);
	}

	@debug()
	private restore(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.restoreFile(node.file, node.ref);
	}

	@debug()
	private revealRepositoryInExplorer(node: RepositoryNode) {
		if (!(node instanceof RepositoryNode)) return undefined;

		return RepoActions.revealInFileExplorer(node.repo);
	}

	@debug()
	private revealWorktreeInExplorer(node: WorktreeNode) {
		if (!(node instanceof WorktreeNode)) return undefined;

		return WorktreeActions.revealInFileExplorer(node.worktree);
	}

	@debug()
	private revert(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return RepoActions.revert(node.repoPath, node.ref);
	}

	@debug()
	private setAsDefault(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return Promise.resolve();

		return node.setAsDefault();
	}

	@debug()
	private setBranchComparison(node: ViewNode, comparisonType: Exclude<ViewShowBranchComparison, false>) {
		if (!(node instanceof CompareBranchNode)) return undefined;

		return node.setComparisonType(comparisonType);
	}

	@debug()
	private setShowRelativeDateMarkers(enabled: boolean) {
		return configuration.updateEffective('views.showRelativeDateMarkers', enabled);
	}

	@debug()
	private async stageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof StatusFileNode)
		) {
			return;
		}

		await this.container.git.stageFile(node.repoPath, node.file.path);
		void node.triggerChange();
	}

	@debug()
	private async stageDirectory(node: FolderNode) {
		if (!(node instanceof FolderNode) || !node.relativePath) return;

		await this.container.git.stageDirectory(node.repoPath, node.relativePath);
		void node.triggerChange();
	}

	@debug()
	private star(node: BranchNode | RepositoryNode | RepositoryFolderNode) {
		if (
			!(node instanceof BranchNode) &&
			!(node instanceof RepositoryNode) &&
			!(node instanceof RepositoryFolderNode)
		) {
			return Promise.resolve();
		}

		return node.star();
	}

	@debug()
	private switch(node?: ViewNode) {
		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@debug()
	private switchTo(node?: ViewNode) {
		if (node instanceof ViewRefNode) {
			return RepoActions.switchTo(
				node.repoPath,
				node instanceof BranchNode && node.branch.current ? undefined : node.ref,
			);
		}

		return RepoActions.switchTo(getNodeRepoPath(node));
	}

	@debug()
	private async undoCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return;

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

	@debug()
	private unsetAsDefault(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return Promise.resolve();

		return node.setAsDefault(false);
	}

	@debug()
	private async unstageFile(node: CommitFileNode | FileRevisionAsCommitNode | StatusFileNode) {
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof StatusFileNode)
		) {
			return;
		}

		await this.container.git.unstageFile(node.repoPath, node.file.path);
		void node.triggerChange();
	}

	@debug()
	private async unstageDirectory(node: FolderNode) {
		if (!(node instanceof FolderNode) || !node.relativePath) return;

		await this.container.git.unstageDirectory(node.repoPath, node.relativePath);
		void node.triggerChange();
	}

	@debug()
	private unstar(node: BranchNode | RepositoryNode | RepositoryFolderNode) {
		if (
			!(node instanceof BranchNode) &&
			!(node instanceof RepositoryNode) &&
			!(node instanceof RepositoryFolderNode)
		) {
			return Promise.resolve();
		}

		return node.unstar();
	}

	@debug()
	private compareHeadWith(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return Promise.resolve();

		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, 'HEAD');
		}

		return this.container.searchAndCompareView.compare(node.repoPath, 'HEAD', node.ref);
	}

	@debug()
	private compareWithUpstream(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();
		if (node.branch.upstream == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@debug()
	private compareWorkingWith(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return Promise.resolve();

		if (node instanceof ViewRefFileNode) {
			return this.compareFileWith(node.repoPath, node.uri, node.ref.ref, undefined, '');
		}

		return this.container.searchAndCompareView.compare(node.repoPath, '', node.ref);
	}

	@debug()
	private async compareAncestryWithWorking(node: BranchNode) {
		if (!(node instanceof BranchNode)) return undefined;

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

	@debug()
	private compareWithSelected(node: ViewRefNode | ViewRefFileNode) {
		if (!(node instanceof ViewRefNode) && !(node instanceof ViewRefFileNode)) return;

		this.container.searchAndCompareView.compareWithSelected(node.repoPath, node.ref);
	}

	@debug()
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

	@debug()
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

	@debug()
	private selectFileForCompare(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode) || node.ref == null) return;

		this._selectedFile = {
			ref: node.ref.ref,
			repoPath: node.repoPath,
			uri: node.uri,
		};
		void setContext('gitlens:views:canCompare:file', true);
	}

	@debug()
	private async openAllChanges(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openAllChanges(
				diff,
				{
					repoPath: node.repoPath,
					ref1: node.ref1,
					ref2: node.ref2,
				},
				options,
			);
		}

		return CommitActions.openAllChanges(node.commit, options);
	}

	@debug()
	private openChanges(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (
			!(node instanceof ViewRefFileNode) &&
			!(node instanceof MergeConflictFileNode) &&
			!(node instanceof StatusFileNode)
		) {
			return;
		}

		if (node instanceof MergeConflictFileNode) {
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

	@debug()
	private async openAllChangesWithWorking(
		node: CommitNode | StashNode | ResultsFilesNode,
		options?: TextDocumentShowOptions,
	) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
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

	@debug()
	private async openChangesWithWorking(node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode) {
		if (
			!(node instanceof ViewRefFileNode) &&
			!(node instanceof MergeConflictFileNode) &&
			!(node instanceof StatusFileNode)
		) {
			return Promise.resolve();
		}

		if (node instanceof StatusFileNode) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
				uri: node.uri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		} else if (node instanceof MergeConflictFileNode) {
			return executeEditorCommand<DiffWithWorkingCommandArgs>(Commands.DiffWithWorking, undefined, {
				uri: node.baseUri,
				showOptions: {
					preserveFocus: true,
					preview: true,
				},
			});
		} else if (node instanceof FileRevisionAsCommitNode && node.commit.file?.hasConflicts) {
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

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: node.ref.ref,
		});
	}

	@debug()
	private async openPreviousChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return CommitActions.openChangesWithWorking(node.file, {
			repoPath: node.repoPath,
			ref: `${node.ref.ref}^`,
		});
	}

	@debug()
	private openFile(
		node: ViewRefFileNode | MergeConflictFileNode | StatusFileNode | FileHistoryNode | LineHistoryNode,
		options?: TextDocumentShowOptions,
	) {
		if (
			!(node instanceof ViewRefFileNode) &&
			!(node instanceof MergeConflictFileNode) &&
			!(node instanceof StatusFileNode) &&
			!(node instanceof FileHistoryNode) &&
			!(node instanceof LineHistoryNode)
		) {
			return Promise.resolve();
		}

		return CommitActions.openFile(node.uri, {
			preserveFocus: true,
			preview: false,
			...options,
		});
	}

	@debug()
	private async openFiles(node: CommitNode | StashNode | ResultsFilesNode) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openFiles(diff, node.repoPath, node.ref1 || node.ref2);
		}

		return CommitActions.openFiles(node.commit);
	}

	@debug()
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
		if (
			!(node instanceof CommitFileNode) &&
			!(node instanceof FileRevisionAsCommitNode) &&
			!(node instanceof ResultsFileNode) &&
			!(node instanceof StashFileNode) &&
			!(node instanceof MergeConflictFileNode) &&
			!(node instanceof StatusFileNode)
		) {
			return Promise.resolve();
		}

		options = { showOptions: { preserveFocus: true, preview: false }, ...options };

		let uri = options.revisionUri;
		if (uri == null) {
			if (node instanceof ResultsFileNode || node instanceof MergeConflictFileNode) {
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

	@debug()
	private async openRevisions(node: CommitNode | StashNode | ResultsFilesNode, _options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return CommitActions.openFilesAtRevision(diff, node.repoPath, node.ref1, node.ref2);
		}

		return CommitActions.openFilesAtRevision(node.commit);
	}
}
