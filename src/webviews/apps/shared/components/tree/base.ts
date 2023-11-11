import type { GitFileStatus } from '../../../../../git/models/file';
import type { DraftPatchFileChange } from '../../../../../gk/models/drafts';

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
	checked?: boolean;
	disableCheck?: boolean;
}

// TODO: add support for modifiers (ctrl, alt, shift, meta)
export interface TreeItemAction {
	icon: string;
	label: string;
	action: string;
	arguments?: any[];
}

export interface TreeItemDecorationBase {
	type: string;
	label: string;
}

export interface TreeItemDecorationIcon extends TreeItemDecorationBase {
	type: 'icon';
	icon: string;
}

export interface TreeItemDecorationText extends TreeItemDecorationBase {
	type: 'text';
}

export interface TreeItemDecorationStatus extends TreeItemDecorationBase {
	type: 'indicator' | 'badge';
	status: string;
}

export type TreeItemDecoration = TreeItemDecorationText | TreeItemDecorationIcon | TreeItemDecorationStatus;

interface TreeModelBase<Context = any[]> extends TreeItemBase {
	label: string;
	icon?: string | { type: 'status'; name: GitFileStatus };
	description?: string;
	context?: Context;
	actions?: TreeItemAction[];
	decorations?: TreeItemDecoration[];
	contextData?: unknown;
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
