import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import type { DraftPatchFileChange } from '../../../../../plus/drafts/models/drafts.js';

export interface TreeItemBase {
	// node properties
	branch: boolean;
	expanded: boolean;
	path: string;

	// parent
	parentPath?: string;
	parentExpanded?: boolean;

	// depth
	level: number;

	// checkbox
	checkable: boolean;
	checked?: boolean | 'indeterminate';
	disableCheck?: boolean;
	checkableTooltip?: string;

	/**
	 * Indicates the file has hunks in BOTH staged and unstaged. Set by gl-wip-tree-pane
	 * during deduplication so per-file action callbacks can offer Stage AND Unstage actions
	 * for mixed files instead of the single direction inferred from `file.staged`.
	 */
	mixed?: boolean;
}

export interface TreeItemAction {
	icon: string;
	label: string;
	action: string;
	arguments?: any[];

	altIcon?: string;
	altLabel?: string;
	altAction?: string;
}

export interface TreeItemDecorationBase {
	type: string;
	label: string;
	/** Which slot to render in: `'before'` renders before actions, `'after'` (default) renders after */
	position?: 'before' | 'after';
}

export interface TreeItemDecorationIcon extends TreeItemDecorationBase {
	type: 'icon';
	icon: string;
}

export interface TreeItemDecorationText extends TreeItemDecorationBase {
	type: 'text';
	tooltip?: string;
	color?: string;
}

export interface TreeItemDecorationStatus extends TreeItemDecorationBase {
	type: 'indicator' | 'badge';
	status: string;
}

export interface TreeItemDecorationTracking extends TreeItemDecorationBase {
	type: 'tracking';
	ahead: number;
	behind: number;
	missingUpstream?: boolean;
}

export interface TreeItemDecorationConflict extends TreeItemDecorationBase {
	type: 'conflict';
	count: number;
	tooltip?: string;
	color?: string;
}

export type TreeItemDecoration =
	| TreeItemDecorationText
	| TreeItemDecorationIcon
	| TreeItemDecorationStatus
	| TreeItemDecorationTracking
	| TreeItemDecorationConflict;

interface TreeModelBase<Context = any[]> extends TreeItemBase {
	label: string;
	icon?:
		| string
		| { type: 'status'; name: GitFileStatus }
		| { type: 'branch'; status?: string; worktree?: boolean; hasChanges?: boolean }
		| { type: 'file-icon'; filename: string };
	description?: string;
	context?: Context;
	actions?: TreeItemAction[];
	decorations?: TreeItemDecoration[];
	contextData?: unknown;
	tooltip?: string;
	filterText?: string;
	matched?: boolean;
}

export interface TreeModel<Context = any[]> extends TreeModelBase<Context> {
	children?: TreeModel<Context>[];
}

export interface TreeModelFlat extends TreeModelBase {
	size: number;
	position: number;
}

export interface TreeItemSelectionDetail {
	node: TreeItemBase;
	context?: DraftPatchFileChange[];
	dblClick: boolean;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
}

export interface TreeItemActionDetail extends TreeItemSelectionDetail {
	action: TreeItemAction;
}

export interface TreeItemCheckedDetail {
	node: TreeItemBase;
	context?: string[];
	checked: boolean;
}

// export function toStashTree(files: GitFileChangeShape[]): TreeModel {}
// export function toWipTrees(files: GitFileChangeShape[]): TreeModel[] {}
