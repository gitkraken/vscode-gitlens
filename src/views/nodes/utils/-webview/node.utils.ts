import type { TreeViewNodeTypes } from '../../../../constants.views';
import { treeViewFileNodeTypes, treeViewRefFileNodeTypes, treeViewRefNodeTypes } from '../../../../constants.views';
import type { LaunchpadItemNode } from '../../../launchpadView';
import type { RepositoryFolderNode } from '../../abstract/repositoryFolderNode';
import { ViewNode } from '../../abstract/viewNode';
import type { BranchNode } from '../../branchNode';
import type { BranchTrackingStatusFilesNode } from '../../branchTrackingStatusFilesNode';
import type { BranchTrackingStatusNode } from '../../branchTrackingStatusNode';
import type { CodeSuggestionsNode } from '../../codeSuggestionsNode';
import type { CommitFileNode } from '../../commitFileNode';
import type { CommitNode } from '../../commitNode';
import type { CompareBranchNode } from '../../compareBranchNode';
import type { CompareResultsNode } from '../../compareResultsNode';
import type { FileRevisionAsCommitNode } from '../../fileRevisionAsCommitNode';
import type { FolderNode } from '../../folderNode';
import type { LineHistoryTrackerNode } from '../../lineHistoryTrackerNode';
import type { MergeConflictFileNode } from '../../mergeConflictFileNode';
import type { PullRequestNode } from '../../pullRequestNode';
import type { RepositoryNode } from '../../repositoryNode';
import type { ResultsCommitsNode } from '../../resultsCommitsNode';
import type { ResultsFileNode } from '../../resultsFileNode';
import type { ResultsFilesNode } from '../../resultsFilesNode';
import type { StashFileNode } from '../../stashFileNode';
import type { StashNode } from '../../stashNode';
import type { StatusFileNode } from '../../statusFileNode';
import type { TagNode } from '../../tagNode';
import type { UncommittedFileNode } from '../../UncommittedFileNode';

// prettier-ignore
export type TreeViewNodesByType = {
	[T in TreeViewNodeTypes]: T extends 'branch'
		? BranchNode
		: T extends 'commit'
		? CommitNode
		: T extends 'commit-file'
		? CommitFileNode
		: T extends 'compare-branch'
		? CompareBranchNode
		: T extends 'compare-results'
		? CompareResultsNode
		: T extends 'conflict-file'
		? MergeConflictFileNode
		: T extends 'drafts-code-suggestions'
		? CodeSuggestionsNode
		: T extends 'file-commit'
		? FileRevisionAsCommitNode
		: T extends 'folder'
		? FolderNode
		: T extends 'launchpad-item'
		? LaunchpadItemNode
		: T extends 'line-history-tracker'
		? LineHistoryTrackerNode
		: T extends 'pullrequest'
		? PullRequestNode
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
		: T extends 'stash'
		? StashNode
		: T extends 'stash-file'
		? StashFileNode
		: T extends 'status-file'
		? StatusFileNode
		: T extends 'tag'
		? TagNode
		: T extends 'tracking-status'
		? BranchTrackingStatusNode
		: T extends 'tracking-status-files'
		? BranchTrackingStatusFilesNode
		: T extends 'uncommitted-file'
		? UncommittedFileNode
		: ViewNode<T>;
};

type FilterNodesByType<T extends keyof TreeViewNodesByType | (keyof TreeViewNodesByType)[]> =
	T extends keyof TreeViewNodesByType
		? TreeViewNodesByType[T]
		: T extends (keyof TreeViewNodesByType)[]
		  ? TreeViewNodesByType[T[number]]
		  : never;

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
