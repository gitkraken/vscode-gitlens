import type { TreeViewNodeTypes } from '../../../../constants.views';
import { treeViewFileNodeTypes, treeViewRefFileNodeTypes, treeViewRefNodeTypes } from '../../../../constants.views';
import type { GitCommit } from '../../../../git/models/commit';
import type { DraftsViewNode } from '../../../draftsView';
import type { LaunchpadItemNode, LaunchpadViewNode } from '../../../launchpadView';
import type { SearchAndCompareViewNode } from '../../../searchAndCompareView';
import type { WorkspacesViewNode } from '../../../workspacesView';
import type { RepositoryFolderNode } from '../../abstract/repositoryFolderNode';
import { ContextValues, ViewNode } from '../../abstract/viewNode';
import type { AutolinkedItemNode } from '../../autolinkedItemNode';
import type { AutolinkedItemsNode } from '../../autolinkedItemsNode';
import type { BranchesNode } from '../../branchesNode';
import type { BranchNode, CommitsCurrentBranchNode } from '../../branchNode';
import type { BranchOrTagFolderNode } from '../../branchOrTagFolderNode';
import type { BranchTrackingStatusFilesNode } from '../../branchTrackingStatusFilesNode';
import type { BranchTrackingStatusNode } from '../../branchTrackingStatusNode';
import type { CodeSuggestionsNode } from '../../codeSuggestionsNode';
import type { CommitFileNode } from '../../commitFileNode';
import type { CommitNode } from '../../commitNode';
import type { PagerNode } from '../../common';
import { MessageNode } from '../../common';
import type { CompareBranchNode } from '../../compareBranchNode';
import type { CompareResultsNode } from '../../compareResultsNode';
import type { ContributorNode } from '../../contributorNode';
import type { ContributorsNode } from '../../contributorsNode';
import type { DraftNode } from '../../draftNode';
import type { FileHistoryNode } from '../../fileHistoryNode';
import type { FileHistoryTrackerNode } from '../../fileHistoryTrackerNode';
import type { FileRevisionAsCommitNode } from '../../fileRevisionAsCommitNode';
import type { FolderNode } from '../../folderNode';
import type { GroupingNode } from '../../groupingNode';
import type { LineHistoryNode } from '../../lineHistoryNode';
import type { LineHistoryTrackerNode } from '../../lineHistoryTrackerNode';
import type { MergeConflictCurrentChangesNode } from '../../mergeConflictCurrentChangesNode';
import type { MergeConflictFileNode } from '../../mergeConflictFileNode';
import type { MergeConflictFilesNode } from '../../mergeConflictFilesNode';
import type { MergeConflictIncomingChangesNode } from '../../mergeConflictIncomingChangesNode';
import type { PausedOperationStatusNode } from '../../pausedOperationStatusNode';
import type { PullRequestNode } from '../../pullRequestNode';
import type { ReflogNode } from '../../reflogNode';
import type { ReflogRecordNode } from '../../reflogRecordNode';
import type { RemoteNode } from '../../remoteNode';
import type { RemotesNode } from '../../remotesNode';
import type { RepositoriesNode } from '../../repositoriesNode';
import type { RepositoryNode } from '../../repositoryNode';
import type { ResultsCommitsNode } from '../../resultsCommitsNode';
import type { ResultsFileNode } from '../../resultsFileNode';
import type { ResultsFilesNode } from '../../resultsFilesNode';
import type { SearchResultsNode } from '../../searchResultsNode';
import type { StashesNode } from '../../stashesNode';
import type { StashFileNode } from '../../stashFileNode';
import type { StashNode } from '../../stashNode';
import type { StatusFileNode } from '../../statusFileNode';
import type { StatusFilesNode } from '../../statusFilesNode';
import type { TagNode } from '../../tagNode';
import type { TagsNode } from '../../tagsNode';
import type { UncommittedFileNode } from '../../UncommittedFileNode';
import type { UncommittedFilesNode } from '../../UncommittedFilesNode';
import type { WorkspaceMissingRepositoryNode } from '../../workspaceMissingRepositoryNode';
import type { WorkspaceNode } from '../../workspaceNode';
import type { WorktreeNode } from '../../worktreeNode';
import type { WorktreesNode } from '../../worktreesNode';

// prettier-ignore
export type TreeViewNodesByType = {
	[T in TreeViewNodeTypes]: T extends 'autolink'
		? AutolinkedItemNode
		: T extends 'autolinks'
		? AutolinkedItemsNode
		: T extends 'branch'
		? BranchNode
		: T extends 'branch-tag-folder'
		? BranchOrTagFolderNode
		: T extends 'branches'
		? BranchesNode
		: T extends 'commit'
		? CommitNode
		: T extends 'commit-file'
		? CommitFileNode
		: T extends 'commits-current-branch'
		? CommitsCurrentBranchNode
		: T extends 'compare-branch'
		? CompareBranchNode
		: T extends 'compare-results'
		? CompareResultsNode
		: T extends 'conflict-current-changes'
		? MergeConflictCurrentChangesNode
		: T extends 'conflict-file'
		? MergeConflictFileNode
		: T extends 'conflict-files'
		? MergeConflictFilesNode
		: T extends 'conflict-incoming-changes'
		? MergeConflictIncomingChangesNode
		: T extends 'contributor'
		? ContributorNode
		: T extends 'contributors'
		? ContributorsNode
		: T extends 'draft'
		? DraftNode
		: T extends 'drafts'
		? DraftsViewNode
		: T extends 'drafts-code-suggestions'
		? CodeSuggestionsNode
		: T extends 'file-commit'
		? FileRevisionAsCommitNode
		: T extends 'file-history'
		? FileHistoryNode
		: T extends 'file-history-tracker'
		? FileHistoryTrackerNode
		: T extends 'folder'
		? FolderNode
		: T extends 'grouping'
		? GroupingNode
		: T extends 'launchpad'
		? LaunchpadViewNode
		: T extends 'launchpad-item'
		? LaunchpadItemNode
		: T extends 'line-history'
		? LineHistoryNode
		: T extends 'line-history-tracker'
		? LineHistoryTrackerNode
		: T extends 'message'
		? MessageNode
		: T extends 'pager'
		? PagerNode
		: T extends 'paused-operation-status'
		? PausedOperationStatusNode
		: T extends 'pullrequest'
		? PullRequestNode
		: T extends 'reflog'
		? ReflogNode
		: T extends 'reflog-record'
		? ReflogRecordNode
		: T extends 'remote'
		? RemoteNode
		: T extends 'remotes'
		? RemotesNode
		: T extends 'repositories'
		? RepositoriesNode
		: T extends 'repository'
		? RepositoryNode
		: T extends 'repo-folder'
		? RepositoryFolderNode
		: T extends 'results-commits'
		? ResultsCommitsNode
		: T extends 'results-file'
		? ResultsFileNode
		: T extends 'results-files'
		? ResultsFilesNode
		: T extends 'search-compare'
		? SearchAndCompareViewNode
		: T extends 'search-results'
		? SearchResultsNode
		: T extends 'stash'
		? StashNode
		: T extends 'stash-file'
		? StashFileNode
		: T extends 'stashes'
		? StashesNode
		: T extends 'status-file'
		? StatusFileNode
		: T extends 'status-files'
		? StatusFilesNode
		: T extends 'tag'
		? TagNode
		: T extends 'tags'
		? TagsNode
		: T extends 'tracking-status'
		? BranchTrackingStatusNode
		: T extends 'tracking-status-files'
		? BranchTrackingStatusFilesNode
		: T extends 'uncommitted-file'
		? UncommittedFileNode
		: T extends 'uncommitted-files'
		? UncommittedFilesNode
		: T extends 'workspace'
		? WorkspaceNode
		: T extends 'workspace-missing-repository'
		? WorkspaceMissingRepositoryNode
		: T extends 'workspaces'
		? WorkspacesViewNode
		: T extends 'worktree'
		? WorktreeNode
		: T extends 'worktrees'
		? WorktreesNode
		: ViewNode<T>;
};

type FilterNodesByType<T extends keyof TreeViewNodesByType | (keyof TreeViewNodesByType)[]> =
	T extends keyof TreeViewNodesByType
		? TreeViewNodesByType[T]
		: T extends (keyof TreeViewNodesByType)[]
			? TreeViewNodesByType[T[number]]
			: never;

export const markers: [number, string][] = [
	[0, 'Less than a week ago'],
	[7, 'Over a week ago'],
	[25, 'Over a month ago'],
	[77, 'Over 3 months ago'],
];

export function* insertDateMarkers<T extends ViewNode & { commit: GitCommit }>(
	iterable: Iterable<T>,
	parent: ViewNode,
	skip?: number,
	{ show }: { show: boolean } = { show: true },
): Iterable<ViewNode> {
	if (!parent.view.config.showRelativeDateMarkers || !show) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return yield* iterable;
	}

	let index = skip ?? 0;
	let time = undefined;
	const now = Date.now();

	let first = true;

	for (const node of iterable) {
		if (index < markers.length) {
			let [daysAgo, marker] = markers[index];
			if (time === undefined) {
				const date = new Date(now);
				time = date.setDate(date.getDate() - daysAgo);
			}

			const date = new Date(node.commit.committer.date).setUTCHours(0, 0, 0, 0);
			if (date <= time) {
				while (index < markers.length - 1) {
					[daysAgo] = markers[index + 1];
					const nextDate = new Date(now);
					const nextTime = nextDate.setDate(nextDate.getDate() - daysAgo);

					if (date > nextTime) break;

					index++;
					time = undefined;
					[, marker] = markers[index];
				}

				// Don't show the marker if it is the first node
				if (!first) {
					yield new MessageNode(
						parent.view,
						parent,
						'',
						marker,
						undefined,
						undefined,
						ContextValues.DateMarker,
					);
				}

				index++;
				time = undefined;
			}
		}

		first = false;
		yield node;
	}

	return undefined;
}

export function isViewNode(node: unknown): node is ViewNode;
export function isViewNode<T extends keyof TreeViewNodesByType | (keyof TreeViewNodesByType)[]>(
	node: unknown,
	type: T,
): node is FilterNodesByType<T>;
export function isViewNode<T extends keyof TreeViewNodesByType>(node: unknown, type?: T | T[]): node is ViewNode {
	if (node == null || !(node instanceof ViewNode)) return false;

	if (type == null) return true;
	if (Array.isArray(type)) {
		return type.includes(node.type);
	}
	return node.type === type;
}

export function isViewFileNode(node: unknown): node is FilterNodesByType<typeof treeViewFileNodeTypes> {
	return isViewNode(node, treeViewFileNodeTypes);
}

export function isViewFileOrFolderNode(
	node: unknown,
): node is FilterNodesByType<'folder' | (typeof treeViewFileNodeTypes)[number]> {
	return isViewNode(node, 'folder') || isViewNode(node, treeViewFileNodeTypes);
}

export function isViewRefFileNode(node: unknown): node is FilterNodesByType<typeof treeViewRefFileNodeTypes> {
	return isViewNode(node, treeViewRefFileNodeTypes);
}

export function isViewRefNode(node: unknown): node is FilterNodesByType<typeof treeViewRefNodeTypes> {
	return isViewNode(node, treeViewRefNodeTypes);
}
