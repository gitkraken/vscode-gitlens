import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import { basename, joinPaths } from '@gitlens/utils/path.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { WorkingFileSorting } from '../../../../commitDetails/protocol.js';
import type { TreeItemAction, TreeItemBase, TreeItemDecorationKind, TreeModel } from './base.js';
import '../chips/action-chip.js';

/**
 * Determines whether the file tree should use tree layout based on the
 * user's preference and file count.
 */
export function isTreeLayout(layout: ViewFilesLayout, count: number, threshold: number): boolean {
	if (layout === 'auto') {
		return count > threshold;
	}
	return layout === 'tree';
}

/**
 * Cycles context-match visibility: off → mixed → matched → off.
 */
export function nextContextMatchVisibility(current: 'off' | 'mixed' | 'matched'): 'off' | 'mixed' | 'matched' {
	switch (current) {
		case 'off':
			return 'mixed';
		case 'mixed':
			return 'matched';
		case 'matched':
			return 'off';
	}
}

/**
 * Returns the next layout value and its display metadata for the layout toggle action.
 */
export function getLayoutInfo(layout: ViewFilesLayout): { value: string; icon: string; label: string } {
	switch (layout) {
		case 'auto':
			return { value: 'list', icon: 'gl-list-auto', label: 'View as List' };
		case 'list':
			return { value: 'tree', icon: 'list-flat', label: 'View as Tree' };
		case 'tree':
			return { value: 'auto', icon: 'list-tree', label: 'View as Auto' };
	}
}

export function renderContextMatchVisibilityAction(
	contextMatchVisibility: 'off' | 'mixed' | 'matched',
	matchCount: number,
	totalCount: number,
	onToggle: (e: Event) => void,
): TemplateResult<1> | typeof nothing {
	if (matchCount === 0 && totalCount === 0) return nothing;

	let icon: string;
	let label: string;

	switch (contextMatchVisibility) {
		case 'off':
			icon = 'filter';
			label = `Search matched ${matchCount} of ${totalCount} files\nClick to highlight matching files`;
			break;
		case 'mixed':
			icon = 'gl-filter-mixed';
			label = `Search matched ${matchCount} of ${totalCount} files\nClick to show only matching files`;
			break;
		case 'matched':
			icon = 'filter-filled';
			label = `Showing ${matchCount} of ${totalCount} files\nClick to show all files`;
			break;
	}

	return html`<gl-action-chip
		data-action="context-match-visibility"
		label="${label}"
		icon="${icon}"
		@click="${onToggle}"
	></gl-action-chip>`;
}

export function renderLayoutAction(layout: ViewFilesLayout, onToggle: (e: Event) => void): TemplateResult<1> {
	const { value, icon, label } = getLayoutInfo(layout);

	return html`<gl-action-chip
		data-action="files-layout"
		data-files-layout="${value}"
		label="${label}"
		icon="${icon}"
		@click="${onToggle}"
	></gl-action-chip>`;
}

/** Renders the shared "Copy Changes (Patch)" action chip — dispatches `copy-commit-patch` with the diff refs. */
export function renderCopyChangesAction(options: {
	repoPath: string;
	to: string;
	from?: string;
	slot?: string;
}): TemplateResult<1> {
	return html`<gl-action-chip
		slot=${options.slot ?? nothing}
		icon="copy"
		label="Copy Changes (Patch)"
		@click=${(e: MouseEvent) =>
			(e.currentTarget as HTMLElement).dispatchEvent(
				new CustomEvent('copy-commit-patch', {
					detail: { repoPath: options.repoPath, to: options.to, from: options.from },
					bubbles: true,
					composed: true,
				}),
			)}
	></gl-action-chip>`;
}

/** Renders the shared "Open Changes" action chip: ≥2 selected → "Open Selected Changes" (Alt/Shift opens all). */
export function renderOpenChangesAction(options: {
	label?: string;
	altLabel?: string;
	selectedCount: number;
	slot?: string;
	onOpenAll: (altKey: boolean) => void;
	onOpenSelected: () => void;
}): TemplateResult<1> {
	const label = options.label ?? 'Open All Changes';
	if (options.selectedCount > 1) {
		return html`<gl-action-chip
			slot=${options.slot ?? nothing}
			data-action="open-selected"
			icon="diff-multiple"
			label="Open Selected Changes"
			alt-label=${label}
			@click=${(e: MouseEvent) => (e.altKey || e.shiftKey ? options.onOpenAll(false) : options.onOpenSelected())}
		></gl-action-chip>`;
	}

	return html`<gl-action-chip
		slot=${options.slot ?? nothing}
		data-action="multi-diff"
		icon="diff-multiple"
		label=${label}
		alt-label=${options.altLabel ?? nothing}
		@click=${(e: MouseEvent) => options.onOpenAll(e.altKey)}
	></gl-action-chip>`;
}

// Approximates VS Code's SCM "status" sort ordering for working changes. Conflicts are floated
// first separately (see `compareWorkingFiles`), so they're omitted here.
const workingFileStatusOrder: Record<string, number> = {
	M: 1, // modified
	T: 2, // type changed
	A: 3, // added
	D: 4, // deleted
	R: 5, // renamed
	C: 6, // copied
	'?': 7, // untracked
};

const emptyPathSet: ReadonlySet<string> = new Set<string>();

/** Ranks non-conflict working files by stage for the `stage` sort: staged-only → mixed → unstaged-only. */
function workingStageRank(file: GitFileChangeShape, mixedPaths: ReadonlySet<string>): number {
	if (mixedPaths.has(file.path)) return 1; // mixed (both staged + unstaged hunks)
	return file.staged ? 0 : 2; // staged-only : unstaged-only
}

/**
 * Orders working (WIP) files per VS Code's `scm.defaultViewSortKey` (`name`/`path`/`status`).
 * Unresolved conflicts always lead regardless of the key — preserving the conflicts-first behavior
 * `sortTreeChildren` provides via `priority` for the ungrouped (checkbox) list.
 *
 * When `stage` is provided (the `gitlens.sortWorkingChangesBy: stage` mode), non-conflict files are
 * floated staged → mixed → unstaged ahead of the sort key.
 */
export function compareWorkingFiles(
	orderBy: WorkingFileSorting,
	a: GitFileChangeShape,
	b: GitFileChangeShape,
	stage?: { mixedPaths: ReadonlySet<string> },
): number {
	const conflictA = isConflictStatus(a.status) ? 0 : 1;
	const conflictB = isConflictStatus(b.status) ? 0 : 1;
	if (conflictA !== conflictB) return conflictA - conflictB;

	// Stage sort applies only to non-conflict files (conflicts already lead, above; among themselves
	// they keep the plain sort-key order).
	if (stage != null && conflictA === 1) {
		const rankA = workingStageRank(a, stage.mixedPaths);
		const rankB = workingStageRank(b, stage.mixedPaths);
		if (rankA !== rankB) return rankA - rankB;
	}

	switch (orderBy) {
		case 'path':
			return a.path.localeCompare(b.path) || basename(a.path).localeCompare(basename(b.path));
		case 'status': {
			const statusA = workingFileStatusOrder[a.status] ?? 99;
			const statusB = workingFileStatusOrder[b.status] ?? 99;
			if (statusA !== statusB) return statusA - statusB;
			return basename(a.path).localeCompare(basename(b.path)) || a.path.localeCompare(b.path);
		}
		case 'name':
		default:
			return basename(a.path).localeCompare(basename(b.path)) || a.path.localeCompare(b.path);
	}
}

export function sortTreeChildren(
	children: TreeModel[],
	fileCompare?: (a: TreeModel, b: TreeModel) => number,
): TreeModel[] {
	children.sort((a, b) => {
		const pa = a.priority ?? 0;
		const pb = b.priority ?? 0;
		if (pa !== pb) return pa - pb;

		if (a.branch && !b.branch) return -1;
		if (!a.branch && b.branch) return 1;

		// Order sibling files (not folders) by the working comparator when provided — lets the WIP tree
		// honor the stage + sort-key order within each folder; folders keep the alphabetical order below.
		if (fileCompare != null && !a.branch && !b.branch) {
			const result = fileCompare(a, b);
			if (result !== 0) return result;
		}

		if (a.label < b.label) return -1;
		if (a.label > b.label) return 1;

		return 0;
	});

	return children;
}

export function folderToTreeModel(name: string, relativePath: string, options?: Partial<TreeItemBase>): TreeModel {
	return {
		branch: false,
		expanded: true,
		path: relativePath,
		level: 1,
		checked: false,
		icon: 'folder',
		label: name,
		tooltip: relativePath,
		...options,
		// Folders should never be checkable — only individual files
		checkable: false,
	};
}

export function buildFileTooltip(file: GitFileChangeShape): string {
	const status = getStatusDecoration(file.status)?.tooltip;
	const fullPath = file.repoPath ? joinPaths(file.repoPath, file.path) : file.path;
	const lines = [`${fullPath}${file.submodule != null ? ' (submodule)' : ''}`];
	if (status) {
		lines.push(status);
	}
	if (file.status === 'R' && file.originalPath) {
		lines.push(`← ${file.originalPath}`);
	}
	return lines.join('\n');
}

export function walkFileTree<T extends GitFileChangeShape>(
	item: HierarchicalItem<T>,
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel,
	options: Partial<TreeItemBase> = { level: 1 },
	repoPath?: string,
	folderToContextData?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined,
	fileCompare?: (a: TreeModel, b: TreeModel) => number,
): TreeModel {
	options.level ??= 1;

	let model: TreeModel;
	if (item.value == null) {
		model = folderToTreeModel(item.name, item.relativePath, options);
		if (repoPath) {
			model.tooltip = joinPaths(repoPath, item.relativePath);
		}
		if (folderToContextData != null) {
			model.contextData = folderToContextData({
				name: item.name,
				relativePath: item.relativePath,
				repoPath: repoPath,
			});
		}
	} else {
		model = fileToModel(item.value, options, false);
	}

	if (item.children != null) {
		const children = [];
		for (const child of item.children.values()) {
			const childModel = walkFileTree(
				child,
				fileToModel,
				{ ...options, level: options.level + 1 },
				repoPath,
				folderToContextData,
				fileCompare,
			);
			children.push(childModel);
		}

		if (children.length > 0) {
			sortTreeChildren(children, fileCompare);
			model.branch = true;
			model.children = children;

			// If any child is matched, mark this parent as matched too
			if (children.some(child => child.matched)) {
				model.matched = true;
			}
		}
	}

	return model;
}

export function buildFileTree<T extends GitFileChangeShape>(
	files: T[],
	isTree: boolean,
	compact: boolean,
	contextMatchVisibility: 'off' | 'mixed' | 'matched',
	searchContext: { matchedFiles?: readonly { readonly path: string }[] } | null | undefined,
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel,
	options: Partial<TreeItemBase> = { level: 1 },
	folderToContextData?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined,
	orderBy?: WorkingFileSorting,
	sortByStage?: boolean,
	mixedPaths?: ReadonlySet<string>,
): TreeModel[] {
	options.level ??= 1;

	// Filter files if context-match visibility is 'matched' and we have search context
	let filteredFiles = files;
	if (contextMatchVisibility === 'matched' && searchContext?.matchedFiles != null) {
		const matchedPaths = new Set(searchContext.matchedFiles.map(f => f.path));
		filteredFiles = files.filter(f => matchedPaths.has(f.path));
	}

	if (!filteredFiles.length) return [];

	// Working-files order (VS Code's `scm.defaultViewSortKey`), optionally floating staged → mixed →
	// unstaged first (`gitlens.sortWorkingChangesBy: stage`). Built once so the comparator doesn't
	// allocate a fallback set per comparison. In tree layout this orders the files *within* each folder
	// (`fileCompare`); in list layout it orders the flat list directly.
	const stage = sortByStage ? { mixedPaths: mixedPaths ?? emptyPathSet } : undefined;
	const fileCompare =
		orderBy != null
			? (a: TreeModel, b: TreeModel): number => {
					const fa = a.context?.[0] as GitFileChangeShape | undefined;
					const fb = b.context?.[0] as GitFileChangeShape | undefined;
					if (fa?.path == null || fb?.path == null) return 0;
					return compareWorkingFiles(orderBy, fa, fb, stage);
				}
			: undefined;

	const repoPath = filteredFiles[0]?.repoPath;
	const children: TreeModel[] = [];
	if (isTree) {
		const fileTree = makeHierarchical(
			filteredFiles,
			n => n.path.split('/'),
			(...parts: string[]) => parts.join('/'),
			compact,
		);
		if (fileTree.children != null) {
			for (const child of fileTree.children.values()) {
				const childModel = walkFileTree(
					child,
					fileToModel,
					options,
					repoPath,
					folderToContextData,
					fileCompare,
				);
				children.push(childModel);
			}
		}
	} else {
		const orderedFiles =
			orderBy != null
				? filteredFiles.toSorted((a, b) => compareWorkingFiles(orderBy, a, b, stage))
				: filteredFiles;
		for (const file of orderedFiles) {
			const child = fileToModel(file, { ...options, branch: false }, true);
			children.push(child);
		}
	}

	// Tree layout keeps folders first/alphabetical but orders sibling files via `fileCompare` (the
	// stage + sort-key order, within each folder). The default flat list (no `orderBy`) keeps the
	// alphabetical-by-label sort; an explicit-`orderBy` list is already ordered above, so skip it.
	if (isTree || orderBy == null) {
		sortTreeChildren(children, fileCompare);
	}

	return children;
}

export type FileGroup = { key: string; label: string; actions?: TreeItemAction[] };

export interface GroupedTreeOptions<T extends GitFileChangeShape> {
	files: T[];
	isTree: boolean;
	compact: boolean;
	grouping?: { getGroup: (file: T) => string; groups: FileGroup[] };
	checkable: boolean;
	contextMatchVisibility: 'off' | 'mixed' | 'matched';
	searchContext?: { matchedFiles?: readonly { readonly path: string }[] } | null;
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel;
	folderToContextData?: (folder: { name: string; relativePath: string; repoPath?: string }) => string | undefined;
	/** Working-files sort order (VS Code's `scm.defaultViewSortKey`); applied to list layout only. */
	orderBy?: WorkingFileSorting;
	/** Float staged → mixed → unstaged ahead of `orderBy` (`gitlens.sortWorkingChangesBy: stage`). List layout only. */
	sortByStage?: boolean;
	/** Paths with both staged + unstaged hunks, used by the stage sort to rank a file as "mixed". */
	mixedPaths?: ReadonlySet<string>;
}

/**
 * Stamps a unique {@link TreeItemBase.key} on every node in a grouped subtree so the same
 * folder/file `path` appearing under multiple groups (e.g. `src` under both Staged and Unstaged)
 * doesn't collide in the tree's path-keyed machinery. `path` is left untouched (real file path).
 */
function applyKeyPrefix(nodes: TreeModel[], prefix: string): void {
	for (const node of nodes) {
		node.key = `${prefix}${node.path}`;
		if (node.children != null) {
			applyKeyPrefix(node.children, prefix);
		}
	}
}

export function buildGroupedTree<T extends GitFileChangeShape>(opts: GroupedTreeOptions<T>): TreeModel[] {
	const {
		files,
		isTree,
		compact,
		contextMatchVisibility,
		searchContext,
		fileToModel,
		folderToContextData,
		orderBy,
		sortByStage,
		mixedPaths,
	} = opts;

	if (!opts.grouping) {
		return buildFileTree(
			files,
			isTree,
			compact,
			contextMatchVisibility,
			searchContext,
			fileToModel,
			{
				level: 1,
				...(opts.checkable ? { checkable: true } : {}),
			},
			folderToContextData,
			orderBy,
			sortByStage,
			mixedPaths,
		);
	}

	// Group files using the provided grouping function
	const buckets = new Map<string, T[]>();
	for (const f of files) {
		const key = opts.grouping.getGroup(f);
		let bucket = buckets.get(key);
		if (!bucket) {
			bucket = [];
			buckets.set(key, bucket);
		}
		bucket.push(f);
	}

	const children: TreeModel[] = [];
	for (const groupDef of opts.grouping.groups) {
		const groupFiles = buckets.get(groupDef.key);
		if (!groupFiles?.length) continue;

		// Each group builds its own folder hierarchy, so the same folder/file `path` can recur across
		// groups. Stamp a group-scoped `key` on every node so the tree's path-keyed identity (node map,
		// virtualizer, selection, expansion) stays collision-free — `path` remains the real file path.
		const groupChildren = buildFileTree(
			groupFiles,
			isTree,
			compact,
			contextMatchVisibility,
			searchContext,
			fileToModel,
			{ level: 2 },
			folderToContextData,
			orderBy,
			sortByStage,
			mixedPaths,
		);
		applyKeyPrefix(groupChildren, `${groupDef.key}:`);

		children.push({
			label: groupDef.label,
			path: `/:${groupDef.key}:/`,
			level: 1,
			branch: true,
			checkable: false,
			expanded: true,
			checked: false,
			context: [groupDef.key],
			children: groupChildren,
			actions: groupDef.actions,
		});
	}

	if (children.length === 0) {
		return buildFileTree(
			files,
			isTree,
			compact,
			contextMatchVisibility,
			searchContext,
			fileToModel,
			undefined,
			folderToContextData,
			orderBy,
			sortByStage,
			mixedPaths,
		);
	}

	return children;
}

export function getStatusDecoration(
	status: GitFileStatus | (string & {}),
): { letter: string; tooltip: string; kind: TreeItemDecorationKind } | undefined {
	switch (status) {
		case 'A':
			return { letter: 'A', tooltip: 'Added', kind: 'added' };
		case '?':
			return { letter: 'U', tooltip: 'Untracked', kind: 'untracked' };
		case 'M':
			return { letter: 'M', tooltip: 'Modified', kind: 'modified' };
		case 'D':
			return { letter: 'D', tooltip: 'Deleted', kind: 'deleted' };
		case 'R':
			return { letter: 'R', tooltip: 'Renamed', kind: 'renamed' };
		case 'C':
			return { letter: 'C', tooltip: 'Copied', kind: 'renamed' };
		case 'T':
			return { letter: 'T', tooltip: 'Type Changed', kind: 'modified' };
		case 'U':
		case 'AA':
		case 'AU':
		case 'UA':
		case 'DD':
		case 'DU':
		case 'UD':
		case 'UU':
			return { letter: '!', tooltip: 'Conflict', kind: 'conflict' };
		default:
			return undefined;
	}
}
