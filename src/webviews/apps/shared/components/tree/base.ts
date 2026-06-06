import type { TemplateResult } from 'lit';
import type { AgentSessionPhase } from '@gitlens/agents/types.js';
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
	/** Alt-action tooltip — surfaced only when the checkbox has a distinct alt+click behavior
	 *  (currently set by `gl-file-tree-pane` for mixed-state files where alt+click flips to
	 *  unstage). When set, `tree-item` adds an alt-key hint line and swaps to this label while
	 *  the user holds Alt. */
	checkableAltTooltip?: string;

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
	altArguments?: any[];

	/**
	 * How the action applies when clicked on a row that's part of a multi-selection (VS Code SCM
	 * inline-action behavior). `'fanOut'` (default) repeats the action per selected file (for ops that
	 * apply to any row, e.g. Open File); `'batch'` dispatches a single event carrying the whole
	 * selection (`detail.files`) so ops like stage/unstage/discard act once; `'single'` ignores the
	 * selection and acts only on the clicked row — for row-specific actions (conflict Open Current/
	 * Incoming, a staged-changes diff) that would open wrong/empty content if fanned out.
	 */
	multiBehavior?: 'fanOut' | 'batch' | 'single';
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

export type TreeItemDecorationKind =
	| 'added'
	| 'deleted'
	| 'modified'
	| 'untracked'
	| 'renamed'
	| 'conflict'
	| 'muted'
	| 'agent-working'
	| 'agent-waiting'
	| 'agent-idle';

export interface TreeItemDecorationText extends TreeItemDecorationBase {
	type: 'text';
	tooltip?: string;
	kind?: TreeItemDecorationKind;
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
	kind?: TreeItemDecorationKind;
}

export interface TreeItemDecorationAgent extends TreeItemDecorationBase {
	type: 'agent';
	phase: AgentSessionPhase;
	tooltip?: string;
}

export interface TreeItemDecorationWip extends TreeItemDecorationBase {
	type: 'wip';
	hasChanges: boolean;
	added?: number;
	changed?: number;
	deleted?: number;
}

export type TreeItemDecoration =
	| TreeItemDecorationText
	| TreeItemDecorationIcon
	| TreeItemDecorationStatus
	| TreeItemDecorationTracking
	| TreeItemDecorationConflict
	| TreeItemDecorationAgent
	| TreeItemDecorationWip;

interface TreeModelBase<Context = any[]> extends TreeItemBase {
	label: string;
	icon?:
		| string
		| { type: 'status'; name: GitFileStatus }
		| { type: 'branch'; status?: string; worktree?: boolean; hasChanges?: boolean }
		| { type: 'file-icon'; filename: string }
		| { type: 'agent'; phase: AgentSessionPhase };
	description?: string;
	context?: Context;
	actions?: TreeItemAction[];
	decorations?: TreeItemDecoration[];
	contextData?: unknown;
	/** Hover tooltip. A `string` is rendered as markdown (via `gl-markdown`); a Lit `TemplateResult`
	 *  is rendered directly, bypassing markdown — letting callers produce richer layouts with
	 *  their own scoped styles when a markdown string would be too constrained. */
	tooltip?: string | TemplateResult;
	filterText?: string;
	matched?: boolean;
	/** Lower sorts first within its parent; treated as `0` when unset. */
	priority?: number;
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
	/** Optional so existing synthetic-detail constructors (keyboard activation, branch toggle, host
	 *  re-dispatch) need no change; absence is treated as "shift not held". */
	shiftKey?: boolean;
}

/**
 * Emitted by a multi-selectable `gl-tree-view` whenever the selected set changes. Carries the full
 * ordered selection (leaf rows) so hosts can act on the batch. Empty `nodes` means selection cleared.
 */
export interface TreeSelectionChangedDetail {
	nodes: TreeModelFlat[];
	paths: string[];
	contexts: unknown[];
	/** The id that most recently changed the selection (anchor / last-clicked), if any. */
	lastPath: string | undefined;
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
