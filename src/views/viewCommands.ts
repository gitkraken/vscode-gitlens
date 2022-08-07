import type { Disposable, TextDocumentShowOptions } from 'vscode';
import { commands, env, Uri, window } from 'vscode';
import type { CreatePullRequestActionContext, OpenPullRequestActionContext } from '../api/gitlens';
import type {
	DiffWithCommandArgs,
	DiffWithPreviousCommandArgs,
	DiffWithWorkingCommandArgs,
	OpenFileAtRevisionCommandArgs,
} from '../commands';
import { GitActions } from '../commands/gitCommands.actions';
import { configuration, FileAnnotationType, ViewShowBranchComparison } from '../configuration';
import { Commands, ContextKeys, CoreCommands, CoreGitCommands } from '../constants';
import { Container } from '../container';
import { setContext } from '../context';
import { GitUri } from '../git/gitUri';
import type { GitStashReference } from '../git/models/reference';
import { GitReference, GitRevision } from '../git/models/reference';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	executeEditorCommand,
} from '../system/command';
import { debug } from '../system/decorators/log';
import { sequentialize } from '../system/function';
import { OpenWorkspaceLocation } from '../system/utils';
import { runGitCommandInTerminal } from '../terminal';
import { BranchesNode } from './nodes/branchesNode';
import { BranchNode } from './nodes/branchNode';
import { BranchTrackingStatusNode } from './nodes/branchTrackingStatusNode';
import { CommitFileNode } from './nodes/commitFileNode';
import { CommitNode } from './nodes/commitNode';
import type { PagerNode } from './nodes/common';
import { CompareBranchNode } from './nodes/compareBranchNode';
import { ContributorNode } from './nodes/contributorNode';
import { ContributorsNode } from './nodes/contributorsNode';
import { FileHistoryNode } from './nodes/fileHistoryNode';
import { FileRevisionAsCommitNode } from './nodes/fileRevisionAsCommitNode';
import { FolderNode } from './nodes/folderNode';
import { LineHistoryNode } from './nodes/lineHistoryNode';
import { MergeConflictFileNode } from './nodes/mergeConflictFileNode';
import { PullRequestNode } from './nodes/pullRequestNode';
import { RemoteNode } from './nodes/remoteNode';
import type { RemotesNode } from './nodes/remotesNode';
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
	PageableViewNode,
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

export class ViewCommands {
	private registerCommand(
		command: string,
		callback: (...args: any[]) => unknown,
		thisArg?: any,
		multiSelect: ViewCommandMultiSelectMode = ViewCommandMultiSelectMode.Allowed,
	): Disposable {
		return commands.registerCommand(
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

	constructor(private readonly container: Container) {
		this.registerCommand('gitlens.views.clearNode', (n: ViewNode) => canClearNode(n) && n.clear(), this);
		// Register independently as it already handles copying multiple nodes
		commands.registerCommand(
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
		this.registerCommand(
			'gitlens.views.dismissNode',
			(n: ViewNode) => canViewDismissNode(n.view) && n.view.dismissNode(n),
			this,
		);
		this.registerCommand('gitlens.views.editNode', (n: ViewNode) => canEditNode(n) && n.edit(), this);
		this.registerCommand(
			'gitlens.views.expandNode',
			(n: ViewNode) => n.view.reveal(n, { select: false, focus: false, expand: 3 }),
			this,
		);
		this.registerCommand('gitlens.views.loadMoreChildren', (n: PagerNode) => n.loadMore(), this);
		this.registerCommand('gitlens.views.loadAllChildren', (n: PagerNode) => n.loadAll(), this);
		this.registerCommand(
			'gitlens.views.refreshNode',
			(n: ViewNode, reset?: boolean) => {
				if (reset == null && PageableViewNode.is(n)) {
					n.limit = undefined;
					n.view.resetNodeLastKnownLimit(n);
				}

				return n.view.refreshNode(n, reset == null ? true : reset);
			},
			this,
		);

		this.registerCommand(
			'gitlens.views.setShowRelativeDateMarkersOn',
			() => this.setShowRelativeDateMarkers(true),
			this,
		);
		this.registerCommand(
			'gitlens.views.setShowRelativeDateMarkersOff',
			() => this.setShowRelativeDateMarkers(false),
			this,
		);

		this.registerCommand('gitlens.views.fetch', this.fetch, this);
		this.registerCommand('gitlens.views.publishBranch', this.publishBranch, this);
		this.registerCommand('gitlens.views.publishRepository', this.publishRepository, this);
		this.registerCommand('gitlens.views.pull', this.pull, this);
		this.registerCommand('gitlens.views.push', this.push, this);
		this.registerCommand('gitlens.views.pushWithForce', n => this.push(n, true), this);
		this.registerCommand('gitlens.views.closeRepository', this.closeRepository, this);

		this.registerCommand('gitlens.views.setAsDefault', this.setAsDefault, this);
		this.registerCommand('gitlens.views.unsetAsDefault', this.unsetAsDefault, this);

		this.registerCommand('gitlens.views.openInTerminal', this.openInTerminal, this);
		this.registerCommand('gitlens.views.star', this.star, this);
		this.registerCommand('gitlens.views.unstar', this.unstar, this);

		this.registerCommand('gitlens.views.browseRepoAtRevision', this.browseRepoAtRevision, this);
		this.registerCommand(
			'gitlens.views.browseRepoAtRevisionInNewWindow',
			n => this.browseRepoAtRevision(n, { openInNewWindow: true }),
			this,
		);
		this.registerCommand(
			'gitlens.views.browseRepoBeforeRevision',
			n => this.browseRepoAtRevision(n, { before: true }),
			this,
		);
		this.registerCommand(
			'gitlens.views.browseRepoBeforeRevisionInNewWindow',
			n => this.browseRepoAtRevision(n, { before: true, openInNewWindow: true }),
			this,
		);

		this.registerCommand('gitlens.views.addAuthors', this.addAuthors, this);
		this.registerCommand('gitlens.views.addAuthor', this.addAuthors, this);

		this.registerCommand('gitlens.views.openChanges', this.openChanges, this);
		this.registerCommand('gitlens.views.openChangesWithWorking', this.openChangesWithWorking, this);
		this.registerCommand('gitlens.views.openPreviousChangesWithWorking', this.openPreviousChangesWithWorking, this);
		this.registerCommand('gitlens.views.openFile', this.openFile, this);
		this.registerCommand('gitlens.views.openFileRevision', this.openRevision, this);
		this.registerCommand('gitlens.views.openChangedFiles', this.openFiles, this);
		this.registerCommand('gitlens.views.openChangedFileDiffs', this.openAllChanges, this);
		this.registerCommand('gitlens.views.openChangedFileDiffsWithWorking', this.openAllChangesWithWorking, this);
		this.registerCommand('gitlens.views.openChangedFileRevisions', this.openRevisions, this);
		this.registerCommand('gitlens.views.applyChanges', this.applyChanges, this);
		this.registerCommand('gitlens.views.highlightChanges', this.highlightChanges, this);
		this.registerCommand('gitlens.views.highlightRevisionChanges', this.highlightRevisionChanges, this);
		this.registerCommand('gitlens.views.restore', this.restore, this);
		this.registerCommand('gitlens.views.switchToBranch', this.switch, this);
		this.registerCommand('gitlens.views.switchToAnotherBranch', this.switch, this);
		this.registerCommand('gitlens.views.switchToCommit', this.switch, this);
		this.registerCommand('gitlens.views.switchToTag', this.switch, this);
		this.registerCommand('gitlens.views.addRemote', this.addRemote, this);
		this.registerCommand('gitlens.views.pruneRemote', this.pruneRemote, this);

		this.registerCommand('gitlens.views.stageDirectory', this.stageDirectory, this);
		this.registerCommand('gitlens.views.stageFile', this.stageFile, this);
		this.registerCommand('gitlens.views.unstageDirectory', this.unstageDirectory, this);
		this.registerCommand('gitlens.views.unstageFile', this.unstageFile, this);

		this.registerCommand('gitlens.views.compareAncestryWithWorking', this.compareAncestryWithWorking, this);
		this.registerCommand('gitlens.views.compareWithHead', this.compareHeadWith, this);
		this.registerCommand('gitlens.views.compareWithUpstream', this.compareWithUpstream, this);
		this.registerCommand('gitlens.views.compareWithSelected', this.compareWithSelected, this);
		this.registerCommand('gitlens.views.selectForCompare', this.selectForCompare, this);
		this.registerCommand('gitlens.views.compareFileWithSelected', this.compareFileWithSelected, this);
		this.registerCommand('gitlens.views.selectFileForCompare', this.selectFileForCompare, this);
		this.registerCommand('gitlens.views.compareWithWorking', this.compareWorkingWith, this);

		this.registerCommand(
			'gitlens.views.setBranchComparisonToWorking',
			n => this.setBranchComparison(n, ViewShowBranchComparison.Working),
			this,
		);
		this.registerCommand(
			'gitlens.views.setBranchComparisonToBranch',
			n => this.setBranchComparison(n, ViewShowBranchComparison.Branch),
			this,
		);

		this.registerCommand('gitlens.views.cherryPick', this.cherryPick, this);
		this.registerCommand('gitlens.views.createBranch', this.createBranch, this);
		this.registerCommand('gitlens.views.deleteBranch', this.deleteBranch, this);
		this.registerCommand('gitlens.views.renameBranch', this.renameBranch, this);
		this.registerCommand('gitlens.views.deleteStash', this.deleteStash, this, ViewCommandMultiSelectMode.Custom);
		this.registerCommand('gitlens.views.createTag', this.createTag, this);
		this.registerCommand('gitlens.views.deleteTag', this.deleteTag, this);

		this.registerCommand('gitlens.views.mergeBranchInto', this.merge, this);
		this.registerCommand('gitlens.views.pushToCommit', this.pushToCommit, this);

		this.registerCommand('gitlens.views.rebaseOntoBranch', this.rebase, this);
		this.registerCommand('gitlens.views.rebaseOntoUpstream', this.rebaseToRemote, this);
		this.registerCommand('gitlens.views.rebaseOntoCommit', this.rebase, this);

		this.registerCommand('gitlens.views.resetCommit', this.resetCommit, this);
		this.registerCommand('gitlens.views.resetToCommit', this.resetToCommit, this);
		this.registerCommand('gitlens.views.revert', this.revert, this);
		this.registerCommand('gitlens.views.undoCommit', this.undoCommit, this);

		this.registerCommand('gitlens.views.terminalRemoveRemote', this.terminalRemoveRemote, this);

		this.registerCommand('gitlens.views.createPullRequest', this.createPullRequest, this);
		this.registerCommand('gitlens.views.openPullRequest', this.openPullRequest, this);

		this.registerCommand('gitlens.views.createWorktree', this.createWorktree, this);
		this.registerCommand('gitlens.views.deleteWorktree', this.deleteWorktree, this);
		this.registerCommand('gitlens.views.openWorktree', this.openWorktree, this);
		this.registerCommand('gitlens.views.revealWorktreeInExplorer', this.revealWorktreeInExplorer, this);
		this.registerCommand(
			'gitlens.views.openWorktreeInNewWindow',
			n => this.openWorktree(n, { location: OpenWorkspaceLocation.NewWindow }),
			this,
		);
	}

	@debug()
	private addAuthors(node?: ContributorNode | ContributorsNode) {
		if (node != null && !(node instanceof ContributorNode) && !(node instanceof ContributorsNode)) {
			return Promise.resolve();
		}

		return GitActions.Contributor.addAuthors(
			node?.uri.repoPath,
			node instanceof ContributorNode ? node.contributor : undefined,
		);
	}

	@debug()
	private addRemote(node?: RemotesNode) {
		return GitActions.Remote.add(node?.repoPath);
	}

	@debug()
	private applyChanges(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		if (node instanceof ResultsFileNode) {
			return GitActions.Commit.applyChanges(
				node.file,
				GitReference.create(node.ref1, node.repoPath),
				GitReference.create(node.ref2, node.repoPath),
			);
		}

		if (node.ref == null || node.ref.ref === 'HEAD') return Promise.resolve();

		return GitActions.Commit.applyChanges(node.file, node.ref);
	}

	@debug()
	private browseRepoAtRevision(node: ViewRefNode, options?: { before?: boolean; openInNewWindow?: boolean }) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return GitActions.browseAtRevision(node.uri, {
			before: options?.before,
			openInNewWindow: options?.openInNewWindow,
		});
	}

	@debug()
	private cherryPick(node: CommitNode) {
		if (!(node instanceof CommitNode)) return Promise.resolve();

		return GitActions.cherryPick(node.repoPath, node.ref);
	}

	@debug()
	private closeRepository(node: RepositoryNode | RepositoryFolderNode) {
		if (!(node instanceof RepositoryNode) && !(node instanceof RepositoryFolderNode)) return;

		node.repo.closed = true;
	}

	@debug()
	private async createBranch(node?: ViewRefNode | BranchesNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode
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
		return GitActions.Branch.create(node?.repoPath, from);
	}

	@debug()
	private async createWorktree(node?: BranchNode | WorktreesNode) {
		if (node instanceof WorktreesNode) {
			node = undefined;
		}
		if (node != null && !(node instanceof BranchNode)) return undefined;

		return GitActions.Worktree.create(node?.repoPath, undefined, node?.ref);
	}

	@debug()
	private openWorktree(node: WorktreeNode, options?: { location?: OpenWorkspaceLocation }) {
		if (!(node instanceof WorktreeNode)) return undefined;

		return GitActions.Worktree.open(node.worktree, options);
	}

	@debug()
	private revealWorktreeInExplorer(node: WorktreeNode) {
		if (!(node instanceof WorktreeNode)) return undefined;

		return GitActions.Worktree.revealInFileExplorer(node.worktree);
	}

	@debug()
	private async deleteWorktree(node: WorktreeNode) {
		if (!(node instanceof WorktreeNode)) return undefined;

		return GitActions.Worktree.remove(node.repoPath, node.worktree.uri);
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
	private async createTag(node?: ViewRefNode | TagsNode | BranchTrackingStatusNode) {
		let from =
			node instanceof ViewRefNode
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
		return GitActions.Tag.create(node?.repoPath, from);
	}

	@debug()
	private deleteBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();

		return GitActions.Branch.remove(node.repoPath, node.branch);
	}

	@debug()
	private deleteStash(node: StashNode, nodes?: StashNode[]) {
		if (!(node instanceof StashNode)) return Promise.resolve();

		if (nodes != null && nodes.length !== 0) {
			const sorted = nodes.sort((a, b) => parseInt(b.commit.number, 10) - parseInt(a.commit.number, 10));

			return sequentialize(
				GitActions.Stash.drop,
				sorted.map<[string, GitStashReference]>(n => [n.repoPath, n.commit]),
				this,
			);
		}
		return GitActions.Stash.drop(node.repoPath, node.commit);
	}

	@debug()
	private deleteTag(node: TagNode) {
		if (!(node instanceof TagNode)) return Promise.resolve();

		return GitActions.Tag.remove(node.repoPath, node.tag);
	}

	@debug()
	private fetch(node: RemoteNode | RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node instanceof RepositoryNode || node instanceof RepositoryFolderNode) return GitActions.fetch(node.repo);
		if (node instanceof RemoteNode) return GitActions.Remote.fetch(node.remote.repoPath, node.remote.name);
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return GitActions.fetch(node.repoPath, node.root ? undefined : node.branch);
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
			FileAnnotationType.Changes,
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
			FileAnnotationType.Changes,
			{ sha: node.ref.ref, only: true },
			true,
		));
	}

	@debug()
	private merge(node: BranchNode | TagNode) {
		if (!(node instanceof BranchNode) && !(node instanceof TagNode)) return Promise.resolve();

		return GitActions.merge(node.repoPath, node instanceof BranchNode ? node.branch : node.tag);
	}

	@debug()
	private pushToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return GitActions.push(node.repoPath, false, node.commit);
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
	private openInTerminal(node: RepositoryNode | RepositoryFolderNode) {
		if (!(node instanceof RepositoryNode) && !(node instanceof RepositoryFolderNode)) return Promise.resolve();

		return executeCoreCommand(CoreCommands.OpenInTerminal, Uri.file(node.repo.path));
	}

	@debug()
	private async pruneRemote(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return Promise.resolve();

		return GitActions.Remote.prune(node.repo, node.remote.name);
	}

	@debug()
	private publishBranch(node: BranchNode | BranchTrackingStatusNode) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return GitActions.push(node.repoPath, undefined, node.branch);
		}
		return Promise.resolve();
	}

	@debug()
	private publishRepository(node: BranchNode | BranchTrackingStatusNode) {
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return executeCoreGitCommand(CoreGitCommands.Publish, Uri.file(node.repoPath));
		}
		return Promise.resolve();
	}

	@debug()
	private pull(node: RepositoryNode | RepositoryFolderNode | BranchNode | BranchTrackingStatusNode) {
		if (node instanceof RepositoryNode || node instanceof RepositoryFolderNode) return GitActions.pull(node.repo);
		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return GitActions.pull(node.repoPath, node.root ? undefined : node.branch);
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
			return GitActions.push(node.repo, force);
		}

		if (node instanceof BranchNode || node instanceof BranchTrackingStatusNode) {
			return GitActions.push(node.repoPath, undefined, node.root ? undefined : node.branch);
		}

		if (node instanceof CommitNode || node instanceof FileRevisionAsCommitNode) {
			if (node.isTip) {
				return GitActions.push(node.repoPath, force);
			}

			return this.pushToCommit(node);
		}

		return Promise.resolve();
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

		return GitActions.rebase(node.repoPath, node.ref);
	}

	@debug()
	private rebaseToRemote(node: BranchNode | BranchTrackingStatusNode) {
		if (!(node instanceof BranchNode) && !(node instanceof BranchTrackingStatusNode)) return Promise.resolve();

		const upstream = node instanceof BranchNode ? node.branch.upstream?.name : node.status.upstream;
		if (upstream == null) return Promise.resolve();

		return GitActions.rebase(
			node.repoPath,
			GitReference.create(upstream, node.repoPath, {
				refType: 'branch',
				name: upstream,
				remote: true,
			}),
		);
	}

	@debug()
	private renameBranch(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();

		return GitActions.Branch.rename(node.repoPath, node.branch);
	}

	@debug()
	private resetCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return GitActions.reset(
			node.repoPath,
			GitReference.create(`${node.ref.ref}^`, node.ref.repoPath, {
				refType: 'revision',
				name: `${node.ref.name}^`,
				message: node.ref.message,
			}),
		);
	}

	@debug()
	private resetToCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return GitActions.reset(node.repoPath, node.ref);
	}

	@debug()
	private restore(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return GitActions.Commit.restoreFile(node.file, node.ref);
	}

	@debug()
	private revert(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return Promise.resolve();

		return GitActions.revert(node.repoPath, node.ref);
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
	private switch(node?: ViewRefNode | BranchesNode) {
		if (node == null) {
			return GitActions.switchTo(this.container.git.highlander);
		}

		if (!(node instanceof ViewRefNode) && !(node instanceof BranchesNode)) return Promise.resolve();

		return GitActions.switchTo(
			node.repoPath,
			node instanceof BranchesNode || (node instanceof BranchNode && node.branch.current) ? undefined : node.ref,
		);
	}

	@debug()
	private async undoCommit(node: CommitNode | FileRevisionAsCommitNode) {
		if (!(node instanceof CommitNode) && !(node instanceof FileRevisionAsCommitNode)) return;

		const repo = await Container.instance.git.getOrOpenScmRepository(node.repoPath);
		const commit = await repo?.getCommit('HEAD');

		if (commit?.hash !== node.ref.ref) {
			void window.showWarningMessage(
				`Commit ${GitReference.toString(node.ref, {
					capitalize: true,
					icon: false,
				})} cannot be undone, because it is no longer the most recent commit.`,
			);

			return;
		}

		await executeCoreGitCommand(CoreGitCommands.UndoCommit, node.repoPath);
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

		await this.container.git.unStageFile(node.repoPath, node.file.path);
		void node.triggerChange();
	}

	@debug()
	private async unstageDirectory(node: FolderNode) {
		if (!(node instanceof FolderNode) || !node.relativePath) return;

		await this.container.git.unStageDirectory(node.repoPath, node.relativePath);
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
	private compareHeadWith(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, 'HEAD', node.ref);
	}

	@debug()
	private compareWithUpstream(node: BranchNode) {
		if (!(node instanceof BranchNode)) return Promise.resolve();
		if (node.branch.upstream == null) return Promise.resolve();

		return this.container.searchAndCompareView.compare(node.repoPath, node.ref, node.branch.upstream.name);
	}

	@debug()
	private compareWorkingWith(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return Promise.resolve();

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
			{ ref: commonAncestor, label: `ancestry with ${node.ref.ref} (${GitRevision.shorten(commonAncestor)})` },
			'',
		);
	}

	@debug()
	private compareWithSelected(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return;

		this.container.searchAndCompareView.compareWithSelected(node.repoPath, node.ref);
	}

	@debug()
	private selectForCompare(node: ViewRefNode) {
		if (!(node instanceof ViewRefNode)) return;

		this.container.searchAndCompareView.selectForCompare(node.repoPath, node.ref);
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
		void setContext(ContextKeys.ViewsCanCompareFile, false);

		return executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: selected.repoPath,
			lhs: {
				sha: selected.ref,
				uri: selected.uri!,
			},
			rhs: {
				sha: node.ref.ref,
				uri: node.uri,
			},
		});
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
		void setContext(ContextKeys.ViewsCanCompareFile, true);
	}

	@debug()
	private async openAllChanges(node: CommitNode | StashNode | ResultsFilesNode, options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return GitActions.Commit.openAllChanges(
				diff,
				{
					repoPath: node.repoPath,
					ref1: node.ref1,
					ref2: node.ref2,
				},
				options,
			);
		}

		return GitActions.Commit.openAllChanges(node.commit, options);
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
		// return GitActions.Commit.openChanges(node.file, node instanceof ViewRefFileNode ? node.ref : node.commit, {
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

			return GitActions.Commit.openAllChangesWithWorking(
				diff,
				{
					repoPath: node.repoPath,
					ref: node.ref1 || node.ref2,
				},
				options,
			);
		}

		return GitActions.Commit.openAllChangesWithWorking(node.commit, options);

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

		return GitActions.Commit.openChangesWithWorking(node.file, { repoPath: node.repoPath, ref: node.ref.ref });
	}

	@debug()
	private async openPreviousChangesWithWorking(node: ViewRefFileNode) {
		if (!(node instanceof ViewRefFileNode)) return Promise.resolve();

		return GitActions.Commit.openChangesWithWorking(node.file, {
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

		return GitActions.Commit.openFile(node.uri, {
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

			return GitActions.Commit.openFiles(diff, node.repoPath, node.ref1 || node.ref2);
		}

		return GitActions.Commit.openFiles(node.commit);
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
				uri = Container.instance.git.getRevisionUri(node.uri);
			} else {
				uri =
					node.commit.file?.status === 'D'
						? Container.instance.git.getRevisionUri(
								(await node.commit.getPreviousSha()) ?? GitRevision.deletedOrMissing,
								node.commit.file.path,
								node.commit.repoPath,
						  )
						: Container.instance.git.getRevisionUri(node.uri);
			}
		}

		return GitActions.Commit.openFileAtRevision(
			uri,
			options.showOptions ?? { preserveFocus: true, preview: false },
		);
	}

	@debug()
	private async openRevisions(node: CommitNode | StashNode | ResultsFilesNode, _options?: TextDocumentShowOptions) {
		if (!(node instanceof CommitNode) && !(node instanceof StashNode) && !(node instanceof ResultsFilesNode)) {
			return undefined;
		}

		if (node instanceof ResultsFilesNode) {
			const { files: diff } = await node.getFilesQueryResults();
			if (diff == null || diff.length === 0) return undefined;

			return GitActions.Commit.openFilesAtRevision(diff, node.repoPath, node.ref1, node.ref2);
		}

		return GitActions.Commit.openFilesAtRevision(node.commit);
	}

	private terminalRemoveRemote(node: RemoteNode) {
		if (!(node instanceof RemoteNode)) return;

		runGitCommandInTerminal('remote', `remove ${node.remote.name}`, node.remote.repoPath);
	}
}
