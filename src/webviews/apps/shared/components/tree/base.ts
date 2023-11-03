import type { GitFileChangeShape, GitFileStatus } from '../../../../../git/models/file';

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

export interface TreeItemDecoratorBase {
	type: string;
	label: string;
}

export interface TreeItemDecoratorIcon extends TreeItemDecoratorBase {
	type: 'icon';
	icon: string;
}

export interface TreeItemDecoratorText extends TreeItemDecoratorBase {
	type: 'text';
}

export interface TreeItemDecoratorStatus extends TreeItemDecoratorBase {
	type: 'indicator' | 'badge';
	status: string;
}

export type TreeItemDecorator = TreeItemDecoratorText | TreeItemDecoratorIcon | TreeItemDecoratorStatus;

interface TreeModelBase<Context = any[]> extends TreeItemBase {
	label: string;
	icon?: string | { type: 'status'; name: GitFileStatus };
	description?: string;
	context?: Context;
	actions?: TreeItemAction[];
	decorators?: TreeItemDecorator[];
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
	context?: GitFileChangeShape[];
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
