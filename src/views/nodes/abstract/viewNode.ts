import type { CancellationToken, Command, Disposable, Event, TreeItem } from 'vscode';
import type { TreeViewNodeTypes } from '../../../constants.views';
import type { GitUri } from '../../../git/gitUri';
import type { GitBranch } from '../../../git/models/branch';
import type { GitCommit } from '../../../git/models/commit';
import type { GitContributor } from '../../../git/models/contributor';
import type { GitFile } from '../../../git/models/file';
import type { PullRequest } from '../../../git/models/pullRequest';
import type { GitReflogRecord } from '../../../git/models/reflog';
import type { GitRemote } from '../../../git/models/remote';
import type { Repository } from '../../../git/models/repository';
import type { GitTag } from '../../../git/models/tag';
import type { GitWorktree } from '../../../git/models/worktree';
import type { Draft } from '../../../gk/models/drafts';
import type { LaunchpadItem } from '../../../plus/launchpad/launchpadProvider';
import type { LaunchpadGroup } from '../../../plus/launchpad/models';
import {
	launchpadCategoryToGroupMap,
	sharedCategoryToLaunchpadActionCategoryMap,
} from '../../../plus/launchpad/models';
import type {
	CloudWorkspace,
	CloudWorkspaceRepositoryDescriptor,
	LocalWorkspace,
	LocalWorkspaceRepositoryDescriptor,
} from '../../../plus/workspaces/models';
import { gate } from '../../../system/decorators/gate';
import { debug, logName } from '../../../system/decorators/log';
import { is as isA } from '../../../system/function';
import { getLoggableName } from '../../../system/logger';
import type { LaunchpadItemNode } from '../../launchpadView';
import type { View } from '../../viewBase';
import type { BranchNode } from '../branchNode';
import type { BranchTrackingStatusFilesNode } from '../branchTrackingStatusFilesNode';
import type { BranchTrackingStatus, BranchTrackingStatusNode } from '../branchTrackingStatusNode';
import type { CodeSuggestionsNode } from '../codeSuggestionsNode';
import type { CommitFileNode } from '../commitFileNode';
import type { CommitNode } from '../commitNode';
import type { CompareBranchNode } from '../compareBranchNode';
import type { CompareResultsNode } from '../compareResultsNode';
import type { FileRevisionAsCommitNode } from '../fileRevisionAsCommitNode';
import type { FolderNode } from '../folderNode';
import type { LineHistoryTrackerNode } from '../lineHistoryTrackerNode';
import type { MergeConflictFileNode } from '../mergeConflictFileNode';
import type { PullRequestNode } from '../pullRequestNode';
import type { RepositoryNode } from '../repositoryNode';
import type { ResultsCommitsNode } from '../resultsCommitsNode';
import type { ResultsFileNode } from '../resultsFileNode';
import type { ResultsFilesNode } from '../resultsFilesNode';
import type { StashFileNode } from '../stashFileNode';
import type { StashNode } from '../stashNode';
import type { StatusFileNode } from '../statusFileNode';
import type { TagNode } from '../tagNode';
import type { UncommittedFileNode } from '../UncommittedFileNode';
import type { RepositoryFolderNode } from './repositoryFolderNode';

export const enum ContextValues {
	ActiveFileHistory = 'gitlens:history:active:file',
	ActiveLineHistory = 'gitlens:history:active:line',
	AutolinkedItems = 'gitlens:autolinked:items',
	AutolinkedItem = 'gitlens:autolinked:item',
	Branch = 'gitlens:branch',
	Branches = 'gitlens:branches',
	BranchStatusAheadOfUpstream = 'gitlens:status-branch:upstream:ahead',
	BranchStatusBehindUpstream = 'gitlens:status-branch:upstream:behind',
	BranchStatusMissingUpstream = 'gitlens:status-branch:upstream:missing',
	BranchStatusNoUpstream = 'gitlens:status-branch:upstream:none',
	BranchStatusSameAsUpstream = 'gitlens:status-branch:upstream:same',
	BranchStatusFiles = 'gitlens:status-branch:files',
	CodeSuggestions = 'gitlens:drafts:code-suggestions',
	Commit = 'gitlens:commit',
	Commits = 'gitlens:commits',
	CommitsCurrentBranch = 'gitlens:commits:current-branch',
	Compare = 'gitlens:compare',
	CompareBranch = 'gitlens:compare:branch',
	ComparePicker = 'gitlens:compare:picker',
	ComparePickerWithRef = 'gitlens:compare:picker:ref',
	CompareResults = 'gitlens:compare:results',
	CompareResultsCommits = 'gitlens:compare:results:commits',
	Contributor = 'gitlens:contributor',
	Contributors = 'gitlens:contributors',
	DateMarker = 'gitlens:date-marker',
	Draft = 'gitlens:draft',
	File = 'gitlens:file',
	FileHistory = 'gitlens:history:file',
	Folder = 'gitlens:folder',
	Grouping = 'gitlens:grouping',
	LaunchpadItem = 'gitlens:launchpad:item',
	LineHistory = 'gitlens:history:line',
	Merge = 'gitlens:merge',
	MergeConflictCurrentChanges = 'gitlens:merge-conflict:current',
	MergeConflictIncomingChanges = 'gitlens:merge-conflict:incoming',
	Message = 'gitlens:message',
	MessageSignIn = 'gitlens:message:signin',
	Pager = 'gitlens:pager',
	PullRequest = 'gitlens:pullrequest',
	Rebase = 'gitlens:rebase',
	Reflog = 'gitlens:reflog',
	ReflogRecord = 'gitlens:reflog-record',
	Remote = 'gitlens:remote',
	Remotes = 'gitlens:remotes',
	Repositories = 'gitlens:repositories',
	Repository = 'gitlens:repository',
	RepositoryFolder = 'gitlens:repo-folder',
	ResultsFile = 'gitlens:file:results',
	ResultsFiles = 'gitlens:results:files',
	SearchAndCompare = 'gitlens:searchAndCompare',
	SearchResults = 'gitlens:search:results',
	SearchResultsCommits = 'gitlens:search:results:commits',
	Stash = 'gitlens:stash',
	Stashes = 'gitlens:stashes',
	StatusFileCommits = 'gitlens:status:file:commits',
	StatusFiles = 'gitlens:status:files',
	StatusAheadOfUpstream = 'gitlens:status:upstream:ahead',
	StatusBehindUpstream = 'gitlens:status:upstream:behind',
	StatusMissingUpstream = 'gitlens:status:upstream:missing',
	StatusNoUpstream = 'gitlens:status:upstream:none',
	StatusSameAsUpstream = 'gitlens:status:upstream:same',
	Tag = 'gitlens:tag',
	Tags = 'gitlens:tags',
	UncommittedFiles = 'gitlens:uncommitted:files',
	Workspace = 'gitlens:workspace',
	WorkspaceMissingRepository = 'gitlens:workspaceMissingRepository',
	Workspaces = 'gitlens:workspaces',
	Worktree = 'gitlens:worktree',
	Worktrees = 'gitlens:worktrees',
}

export interface AmbientContext {
	readonly autolinksId?: string;
	readonly branch?: GitBranch;
	readonly branchStatus?: BranchTrackingStatus;
	readonly branchStatusUpstreamType?: 'ahead' | 'behind' | 'same' | 'missing' | 'none';
	readonly commit?: GitCommit;
	readonly comparisonId?: string;
	readonly comparisonFiltered?: boolean;
	readonly contributor?: GitContributor;
	readonly draft?: Draft;
	readonly file?: GitFile;
	readonly launchpadGroup?: LaunchpadGroup;
	readonly launchpadItem?: LaunchpadItem;
	readonly pullRequest?: PullRequest;
	readonly reflog?: GitReflogRecord;
	readonly remote?: GitRemote;
	readonly repository?: Repository;
	readonly root?: boolean;
	readonly searchId?: string;
	readonly status?: 'merging' | 'rebasing';
	readonly storedComparisonId?: string;
	readonly tag?: GitTag;
	readonly workspace?: CloudWorkspace | LocalWorkspace;
	readonly wsRepositoryDescriptor?: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor;
	readonly worktree?: GitWorktree;

	readonly worktreesByBranch?: Map<string, GitWorktree>;
}

export function getViewNodeId(type: string, context: AmbientContext): string {
	let uniqueness = '';
	if (context.root) {
		uniqueness += '/root';
	}
	if (context.workspace != null) {
		uniqueness += `/ws/${context.workspace.id}`;
	}
	if (context.wsRepositoryDescriptor != null) {
		uniqueness += `/wsrepo/${context.wsRepositoryDescriptor.id}`;
	}
	if (context.repository != null) {
		uniqueness += `/repo/${context.repository.id}`;
	}
	if (context.worktree != null) {
		uniqueness += `/worktree/${context.worktree.uri.path}`;
	}
	if (context.remote != null) {
		uniqueness += `/remote/${context.remote.name}`;
	}
	if (context.tag != null) {
		uniqueness += `/tag/${context.tag.id}`;
	}
	if (context.branch != null) {
		uniqueness += `/branch/${context.branch.id}`;
	}
	if (context.branchStatus != null) {
		uniqueness += `/branch-status/${context.branchStatus.upstream?.name ?? '-'}`;
	}
	if (context.branchStatusUpstreamType != null) {
		uniqueness += `/branch-status-direction/${context.branchStatusUpstreamType}`;
	}
	if (context.launchpadGroup != null) {
		uniqueness += `/lp/${context.launchpadGroup}`;
		if (context.launchpadItem != null) {
			uniqueness += `/${context.launchpadItem.type}/${context.launchpadItem.uuid}`;
		}
	} else if (context.launchpadItem != null) {
		uniqueness += `/lp/${launchpadCategoryToGroupMap.get(
			sharedCategoryToLaunchpadActionCategoryMap.get(context.launchpadItem.suggestedActionCategory)!,
		)}/${context.launchpadItem.type}/${context.launchpadItem.uuid}`;
	}
	if (context.pullRequest != null) {
		uniqueness += `/pr/${context.pullRequest.id}`;
	}
	if (context.status != null) {
		uniqueness += `/status/${context.status}`;
	}
	if (context.reflog != null) {
		uniqueness += `/reflog/${context.reflog.sha}+${context.reflog.selector}+${context.reflog.command}+${
			context.reflog.commandArgs ?? ''
		}+${context.reflog.date.getTime()}`;
	}
	if (context.contributor != null) {
		uniqueness += `/contributor/${
			context.contributor.id ??
			`${context.contributor.username}+${context.contributor.email}+${context.contributor.name}`
		}`;
	}
	if (context.autolinksId != null) {
		uniqueness += `/autolinks/${context.autolinksId}`;
	}
	if (context.comparisonId != null) {
		uniqueness += `/comparison/${context.comparisonId}`;
	}
	if (context.searchId != null) {
		uniqueness += `/search/${context.searchId}`;
	}
	if (context.commit != null) {
		uniqueness += `/commit/${context.commit.sha}`;
	}
	if (context.file != null) {
		uniqueness += `/file/${context.file.path}+${context.file.status}`;
	}
	if (context.draft != null) {
		uniqueness += `/draft/${context.draft.id}`;
	}

	return `gitlens://viewnode/${type}${uniqueness}`;
}

export type ClipboardType = 'text' | 'markdown';

@logName<ViewNode>((c, name) => `${name}${c.id != null ? `(${c.id})` : ''}`)
export abstract class ViewNode<
	Type extends TreeViewNodeTypes = TreeViewNodeTypes,
	TView extends View = View,
	State extends object = any,
> implements Disposable
{
	is<T extends keyof TreeViewNodesByType>(type: T): this is TreeViewNodesByType[T] {
		return this.type === (type as unknown as Type);
	}

	isAny<T extends (keyof TreeViewNodesByType)[]>(...types: T): this is TreeViewNodesByType[T[number]] {
		return types.includes(this.type as unknown as T[number]);
	}

	protected _uniqueId!: string;
	protected splatted = false;
	// NOTE: @eamodio uncomment to track node leaks
	// readonly uuid = uuid();

	constructor(
		public readonly type: Type,
		// public readonly id: string | undefined,
		uri: GitUri,
		public readonly view: TView,
		protected parent?: ViewNode,
	) {
		// NOTE: @eamodio uncomment to track node leaks
		// queueMicrotask(() => this.view.registerNode(this));
		this._uri = uri;
	}

	protected _disposed = false;
	// NOTE: @eamodio uncomment to track node leaks
	// @debug()
	dispose() {
		this._disposed = true;
		// NOTE: @eamodio uncomment to track node leaks
		// this.view.unregisterNode(this);
	}

	get id(): string | undefined {
		return this._uniqueId;
	}

	private _context: AmbientContext | undefined;
	protected get context(): AmbientContext {
		return this._context ?? this.parent?.context ?? {};
	}

	protected updateContext(context: AmbientContext, reset: boolean = false) {
		this._context = this.getNewContext(context, reset);
	}

	protected getNewContext(context: AmbientContext, reset: boolean = false) {
		return { ...(reset ? this.parent?.context : this.context), ...context };
	}

	getUrl?(): string | Promise<string | undefined> | undefined;
	toClipboard?(type?: ClipboardType): string | Promise<string>;

	toString(): string {
		return getLoggableName(this);
	}

	protected _uri: GitUri;
	get uri(): GitUri {
		return this._uri;
	}

	abstract getChildren(): ViewNode[] | Promise<ViewNode[]>;

	getParent(): ViewNode | undefined {
		// If this node's parent has been splatted (e.g. not shown itself, but its children are), then return its grandparent
		return this.parent?.splatted ? this.parent?.getParent() : this.parent;
	}

	abstract getTreeItem(): TreeItem | Promise<TreeItem>;

	resolveTreeItem?(item: TreeItem, token: CancellationToken): TreeItem | Promise<TreeItem>;

	getCommand(): Command | undefined {
		return undefined;
	}

	refresh?(reset?: boolean): boolean | void | Promise<void> | Promise<boolean>;

	@gate()
	@debug()
	triggerChange(reset: boolean = false, force: boolean = false, avoidSelf?: ViewNode): Promise<void> {
		if (this._disposed) return Promise.resolve();

		// If this node has been splatted (e.g. not shown itself, but its children are), then delegate the change to its parent
		if (this.splatted && this.parent != null && this.parent !== avoidSelf) {
			return this.parent.triggerChange(reset, force);
		}

		return this.view.refreshNode(this, reset, force);
	}

	getSplattedChild?(): Promise<ViewNode | undefined>;

	deleteState<T extends StateKey<State> = StateKey<State>>(key?: T): void {
		if (this.id == null) {
			debugger;
			throw new Error('Id is required to delete state');
		}
		this.view.nodeState.deleteState(this.id, key as string);
	}

	getState<T extends StateKey<State> = StateKey<State>>(key: T): StateValue<State, T> | undefined {
		if (this.id == null) {
			debugger;
			throw new Error('Id is required to get state');
		}
		return this.view.nodeState.getState(this.id, key as string);
	}

	storeState<T extends StateKey<State> = StateKey<State>>(
		key: T,
		value: StateValue<State, T>,
		sticky?: boolean,
	): void {
		if (this.id == null) {
			debugger;
			throw new Error('Id is required to store state');
		}
		this.view.nodeState.storeState(this.id, key as string, value, sticky);
	}
}

type StateKey<T> = keyof T;
type StateValue<T, P extends StateKey<T>> = P extends keyof T ? T[P] : never;

export interface PageableViewNode extends ViewNode {
	readonly id: string;
	limit?: number;
	readonly hasMore: boolean;
	loadMore(limit?: number | { until?: string | undefined }, context?: Record<string, unknown>): Promise<void>;
}

export function isPageableViewNode(node: ViewNode): node is ViewNode & PageableViewNode {
	return isA<ViewNode & PageableViewNode>(node, 'loadMore');
}

interface AutoRefreshableView {
	autoRefresh: boolean;
	onDidChangeAutoRefresh: Event<void>;
}

export function canAutoRefreshView(view: View): view is View & AutoRefreshableView {
	return isA<View & AutoRefreshableView>(view, 'onDidChangeAutoRefresh');
}

export function canEditNode(node: ViewNode): node is ViewNode & { edit(): void | Promise<void> } {
	return typeof (node as ViewNode & { edit(): void | Promise<void> }).edit === 'function';
}

export function canGetNodeRepoPath(node?: ViewNode): node is ViewNode & { repoPath: string | undefined } {
	return node != null && 'repoPath' in node && typeof node.repoPath === 'string';
}

export function canViewDismissNode(view: View): view is View & { dismissNode(node: ViewNode): void } {
	return typeof (view as View & { dismissNode(node: ViewNode): void }).dismissNode === 'function';
}

export function getNodeRepoPath(node?: ViewNode): string | undefined {
	return canGetNodeRepoPath(node) ? node.repoPath : undefined;
}

// prettier-ignore
type TreeViewNodesByType = {
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

export function isViewNode(node: unknown): node is ViewNode;
export function isViewNode<T extends keyof TreeViewNodesByType>(node: unknown, type: T): node is TreeViewNodesByType[T];
export function isViewNode<T extends keyof TreeViewNodesByType>(node: unknown, type?: T): node is ViewNode {
	if (node == null) return false;
	return node instanceof ViewNode ? type == null || node.type === type : false;
}
