import type { TemplateResult } from 'lit';
import { html, nothing } from 'lit';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { HierarchicalItem } from '@gitlens/utils/array.js';
import { makeHierarchical } from '@gitlens/utils/array.js';
import type { ViewFilesLayout } from '../../../../../config.js';
import type { TreeItemAction, TreeItemBase, TreeModel } from './base.js';

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
 * Cycles the filter mode: off → mixed → matched → off.
 */
export function nextFilterMode(current: 'off' | 'mixed' | 'matched'): 'off' | 'mixed' | 'matched' {
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

export function renderFilterAction(
	filterMode: 'off' | 'mixed' | 'matched',
	matchCount: number,
	totalCount: number,
	onToggle: (e: Event) => void,
): TemplateResult<1> | typeof nothing {
	if (matchCount === 0 && totalCount === 0) return nothing;

	let icon: string;
	let outlineIcon: string | undefined;
	let label: string;
	let className: string | undefined;

	switch (filterMode) {
		case 'off':
			icon = 'filter';
			label = `Search matched ${matchCount} of ${totalCount} files\nClick to highlight matching files`;
			break;
		case 'mixed':
			icon = 'filter-filled';
			outlineIcon = 'filter';
			label = `Search matched ${matchCount} of ${totalCount} files\nClick to show only matching files`;
			className = 'filter-mode-mixed';
			break;
		case 'matched':
			icon = 'filter-filled';
			label = `Showing ${matchCount} of ${totalCount} files\nClick to show all files`;
			break;
	}

	return html`<action-item
		data-action="filter-mode"
		class="${className ?? ''}"
		label="${label}"
		icon="${icon}"
		outline-icon="${outlineIcon ?? nothing}"
		@click="${onToggle}"
	></action-item>`;
}

export function renderLayoutAction(layout: ViewFilesLayout, onToggle: (e: Event) => void): TemplateResult<1> {
	const { value, icon, label } = getLayoutInfo(layout);

	return html`<action-item
		data-action="files-layout"
		data-files-layout="${value}"
		label="${label}"
		icon="${icon}"
		@click="${onToggle}"
	></action-item>`;
}

export function sortTreeChildren(children: TreeModel[]): TreeModel[] {
	children.sort((a, b) => {
		if (a.branch && !b.branch) return -1;
		if (!a.branch && b.branch) return 1;

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
		...options,
		// Folders should never be checkable — only individual files
		checkable: false,
	};
}

export function walkFileTree<T extends GitFileChangeShape>(
	item: HierarchicalItem<T>,
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel,
	options: Partial<TreeItemBase> = { level: 1 },
): TreeModel {
	if (options.level === undefined) {
		options.level = 1;
	}

	let model: TreeModel;
	if (item.value == null) {
		model = folderToTreeModel(item.name, item.relativePath, options);
	} else {
		model = fileToModel(item.value, options, false);
	}

	if (item.children != null) {
		const children = [];
		for (const child of item.children.values()) {
			const childModel = walkFileTree(child, fileToModel, { ...options, level: options.level + 1 });
			children.push(childModel);
		}

		if (children.length > 0) {
			sortTreeChildren(children);
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
	filterMode: 'off' | 'mixed' | 'matched',
	searchContext: { matchedFiles?: readonly { readonly path: string }[] } | null | undefined,
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel,
	options: Partial<TreeItemBase> = { level: 1 },
): TreeModel[] {
	if (options.level === undefined) {
		options.level = 1;
	}

	// Filter files if filterMode is 'matched' and we have search context
	let filteredFiles = files;
	if (filterMode === 'matched' && searchContext?.matchedFiles != null) {
		const matchedPaths = new Set(searchContext.matchedFiles.map(f => f.path));
		filteredFiles = files.filter(f => matchedPaths.has(f.path));
	}

	if (!filteredFiles.length) return [];

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
				const childModel = walkFileTree(child, fileToModel, options);
				children.push(childModel);
			}
		}
	} else {
		for (const file of filteredFiles) {
			const child = fileToModel(file, { ...options, branch: false }, true);
			children.push(child);
		}
	}

	sortTreeChildren(children);

	return children;
}

export type FileGroup = { key: string; label: string; actions?: TreeItemAction[] };

export interface GroupedTreeOptions<T extends GitFileChangeShape> {
	files: T[];
	isTree: boolean;
	compact: boolean;
	grouping?: { getGroup: (file: T) => string; groups: FileGroup[] };
	checkable: boolean;
	filterMode: 'off' | 'mixed' | 'matched';
	searchContext?: { matchedFiles?: readonly { readonly path: string }[] } | null;
	fileToModel: (file: T, options: Partial<TreeItemBase>, flat: boolean) => TreeModel;
}

export function buildGroupedTree<T extends GitFileChangeShape>(opts: GroupedTreeOptions<T>): TreeModel[] {
	const { files, isTree, compact, filterMode, searchContext, fileToModel } = opts;

	if (!opts.grouping) {
		return buildFileTree(files, isTree, compact, filterMode, searchContext, fileToModel, {
			level: 1,
			...(opts.checkable ? { checkable: true } : {}),
		});
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

		children.push({
			label: groupDef.label,
			path: `/:${groupDef.key}:/`,
			level: 1,
			branch: true,
			checkable: false,
			expanded: true,
			checked: false,
			context: [groupDef.key],
			children: buildFileTree(groupFiles, isTree, compact, filterMode, searchContext, fileToModel, { level: 2 }),
			actions: groupDef.actions,
		});
	}

	if (children.length === 0) {
		return buildFileTree(files, isTree, compact, filterMode, searchContext, fileToModel);
	}

	return children;
}

export function getStatusDecoration(
	status: GitFileStatus | (string & {}),
): { letter: string; tooltip: string; color: string } | undefined {
	switch (status) {
		case 'A':
		case '?':
			return {
				letter: 'A',
				tooltip: 'Added',
				color: 'var(--vscode-gitDecoration-addedResourceForeground)',
			};
		case 'M':
			return {
				letter: 'M',
				tooltip: 'Modified',
				color: 'var(--vscode-gitDecoration-modifiedResourceForeground)',
			};
		case 'D':
			return {
				letter: 'D',
				tooltip: 'Deleted',
				color: 'var(--vscode-gitDecoration-deletedResourceForeground)',
			};
		case 'R':
			return {
				letter: 'R',
				tooltip: 'Renamed',
				color: 'var(--vscode-gitDecoration-renamedResourceForeground)',
			};
		case 'C':
			return {
				letter: 'C',
				tooltip: 'Copied',
				color: 'var(--vscode-gitDecoration-renamedResourceForeground)',
			};
		case 'T':
			return {
				letter: 'T',
				tooltip: 'Type Changed',
				color: 'var(--vscode-gitDecoration-modifiedResourceForeground)',
			};
		case 'U':
		case 'AA':
		case 'AU':
		case 'UA':
		case 'DD':
		case 'DU':
		case 'UD':
		case 'UU':
			return {
				letter: 'U',
				tooltip: 'Conflict',
				color: 'var(--vscode-gitDecoration-conflictingResourceForeground)',
			};
		default:
			return undefined;
	}
}
