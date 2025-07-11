export type CustomEditorTypes = 'rebase';
export type CustomEditorIds = `gitlens.${CustomEditorTypes}`;

export type TreeViewTypes =
	| 'branches'
	| 'commits'
	| 'contributors'
	| 'drafts'
	| 'fileHistory'
	| 'scm.grouped'
	| 'launchpad'
	| 'lineHistory'
	| 'pullRequest'
	| 'remotes'
	| 'repositories'
	| 'searchAndCompare'
	| 'stashes'
	| 'tags'
	| 'workspaces'
	| 'worktrees';
export type TreeViewIds<T extends TreeViewTypes = TreeViewTypes> = `gitlens.views.${T}`;
export type TreeViewTypeFromId<T extends TreeViewIds> = T extends `gitlens.views.${infer U}` ? U : never;

export type GroupableTreeViewTypes = Extract<
	TreeViewTypes,
	| 'branches'
	| 'commits'
	| 'contributors'
	| 'fileHistory'
	| 'launchpad'
	| 'remotes'
	| 'repositories'
	| 'searchAndCompare'
	| 'stashes'
	| 'tags'
	| 'worktrees'
>;
export type GroupableTreeViewIds<T extends GroupableTreeViewTypes = GroupableTreeViewTypes> = TreeViewIds<T>;

export type WebviewTypes = 'composer' | 'graph' | 'patchDetails' | 'settings' | 'timeline';
export type WebviewIds = `gitlens.${WebviewTypes}`;

export type WebviewViewTypes = 'commitDetails' | 'graph' | 'graphDetails' | 'home' | 'patchDetails' | 'timeline';
export type WebviewViewIds<T extends WebviewViewTypes = WebviewViewTypes> = `gitlens.views.${T}`;

export type ViewTypes = TreeViewTypes | WebviewViewTypes;
export type ViewIds = TreeViewIds | WebviewViewIds;

export type ViewContainerTypes = 'gitlens' | 'gitlensInspect' | 'gitlensPanel';
export type ViewContainerIds = `workbench.view.extension.${ViewContainerTypes}`;

export type CoreViewContainerTypes = 'scm';
export type CoreViewContainerIds = `workbench.view.${CoreViewContainerTypes}`;

// export const viewTypes: ViewTypes[] = [
// 	'account',
// 	'branches',
// 	'commits',
// 	'commitDetails',
// 	'contributors',
// 	'fileHistory',
// 	'graph',
// 	'graphDetails',
// 	'home',
// 	'lineHistory',
// 	'remotes',
// 	'repositories',
// 	'searchAndCompare',
// 	'stashes',
// 	'tags',
// 	'timeline',
// 	'workspaces',
// 	'worktrees',
// ];

export const viewIdsByDefaultContainerId = new Map<ViewContainerIds | CoreViewContainerIds, ViewTypes[]>([
	[
		'workbench.view.scm',
		['branches', 'commits', 'remotes', 'repositories', 'stashes', 'tags', 'worktrees', 'contributors'],
	],
	['workbench.view.extension.gitlensPanel', ['graph', 'graphDetails']],
	[
		'workbench.view.extension.gitlensInspect',
		['commitDetails', 'fileHistory', 'lineHistory', 'timeline', 'searchAndCompare'],
	],
	['workbench.view.extension.gitlens', ['home', 'workspaces']],
]);

export type TreeViewRefNodeTypes = 'branch' | 'commit' | 'stash' | 'tag';
export const treeViewRefNodeTypes: TreeViewRefNodeTypes[] = ['branch', 'commit', 'stash', 'tag'];
export type TreeViewRefFileNodeTypes = 'commit-file' | 'file-commit' | 'results-file' | 'stash-file';
export const treeViewRefFileNodeTypes: TreeViewRefFileNodeTypes[] = [
	'commit-file',
	'file-commit',
	'results-file',
	'stash-file',
];
export type TreeViewFileNodeTypes =
	| TreeViewRefFileNodeTypes
	| 'conflict-file'
	// | 'folder'
	| 'status-file'
	| 'uncommitted-file';
export const treeViewFileNodeTypes: TreeViewFileNodeTypes[] = [
	...treeViewRefFileNodeTypes,
	'conflict-file',
	// 'folder',
	'status-file',
	'uncommitted-file',
];
export type TreeViewSubscribableNodeTypes =
	| 'autolinks'
	| 'commits-current-branch'
	| 'compare-branch'
	| 'compare-results'
	| 'file-history'
	| 'file-history-tracker'
	| 'line-history'
	| 'line-history-tracker'
	| 'repositories'
	| 'repository'
	| 'repo-folder'
	| 'search-results'
	| 'workspace';
export type TreeViewNodeTypes =
	| TreeViewRefNodeTypes
	| TreeViewFileNodeTypes
	| TreeViewSubscribableNodeTypes
	| 'autolink'
	| 'branch-tag-folder'
	| 'branches'
	| 'compare-picker'
	| 'contributor'
	| 'contributors'
	| 'conflict-files'
	| 'conflict-current-changes'
	| 'conflict-incoming-changes'
	| 'draft'
	| 'drafts'
	| 'drafts-code-suggestions'
	| 'folder'
	| 'grouping'
	| 'launchpad'
	| 'launchpad-item'
	| 'message'
	| 'pager'
	| 'paused-operation-status'
	| 'pullrequest'
	| 'reflog'
	| 'reflog-record'
	| 'remote'
	| 'remotes'
	| 'results-commits'
	| 'results-files'
	| 'search-compare'
	| 'stashes'
	| 'status-files'
	| 'tags'
	| 'tracking-status'
	| 'tracking-status-files'
	| 'uncommitted-files'
	| 'workspace-missing-repository'
	| 'workspaces'
	| 'worktree'
	| 'worktrees';
