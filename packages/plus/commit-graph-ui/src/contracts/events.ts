import type { ChangesColumnMode } from '@gitkraken/commit-graph/stats.js';
import type { ZoneId } from '@gitkraken/commit-graph/zones.js';
import type {
	GraphContextMenuDetail,
	GraphContextMenuRef,
	GraphCopyRequestDetail,
	GraphHeaderMenuDetail,
} from './contributions.js';
import type { CommitGraphSourceRow } from './rows.js';
import type { GraphMissingRefsMetadata, GraphRefMetadataItem } from './state.js';

/** `content` is the message/author/date/sha cells; `graph` is the lanes column, which only tracks. */
export type GraphRowHoverZone = 'content' | 'graph';

/** Avatars that failed to load, batched over ~150ms; the host can re-serve them via `avatars`. */
export interface GraphAvatarLoadErrorDetail {
	/** Email → the URL that failed. */
	readonly avatars: Record<string, string>;
}

/** Emails the host hasn't supplied an avatar for; each is asked for once per element connection. */
export interface GraphMissingAvatarsDetail {
	/** Email → the sha of a visible row that shows it. */
	readonly avatars: Record<string, string>;
}

/** A ref-pill click pins the ref and reports `open`; a click that drops the pin reports `{ open: false }` alone. */
export type GraphOpenBranchDetail =
	| {
			readonly name: string;
			readonly refType: string;
			readonly remote: string | null;
			readonly sha: string | undefined;
			readonly vscodeContext?: string;
			readonly open: boolean;
	  }
	| { readonly open: false };

export interface GraphJumpToCommitDetail {
	readonly sha: string;
	readonly focus: boolean;
	readonly flash: boolean;
}

/** `target: 'primary'` asks for the host's own working tree; `'nearest'` or absent for the one on `fromSha`'s lane. */
export interface GraphJumpToNearestWipDetail {
	readonly fromSha: string;
	readonly focus: boolean;
	readonly flash: boolean;
	readonly target?: 'primary' | 'nearest';
}

/** Re-sent when the set changes or more rows load without reaching them. */
export interface GraphScopeAnchorsUnreachableDetail {
	readonly shas: readonly string[];
}

export { pickScopePageTarget } from '../scope/paging.js';

/** The tip sha of the lane segment that collapsed or expanded. */
export interface GraphLaneToggleDetail {
	readonly tipSha: string;
}

export interface GraphLaneToggleAllDetail {
	readonly collapsed: boolean;
}

/** The pointer settled on a row (debounced 250ms). */
export interface GraphRowHoverDetail {
	readonly sha: string;
	readonly clientX: number;
	readonly currentTarget: HTMLElement;
	readonly zone: GraphRowHoverZone;
}

/** Undebounced: fires as the pointer moves onto a row or into another zone of it. */
export interface GraphRowHoverTrackDetail {
	readonly sha: string;
	readonly zone: GraphRowHoverZone;
}

export interface GraphRowUnhoverDetail {
	readonly sha: string;
	readonly zone?: GraphRowHoverZone;
	readonly relatedTarget: EventTarget | null;
}

/** `open` is an out parameter the host writes back synchronously; it is the graph's only view of whether the card is
 *  up. */
export type GraphRowPeekRequest =
	| { action: 'toggle' | 'reanchor'; sha: string; anchor: HTMLElement; open: boolean }
	| { action: 'close' };

export interface GraphRowActionDetail {
	/** A `GraphBuiltInRowAction`, or `open-changes-with-working` for Alt+Open Changes. */
	readonly action: string;
	readonly sha: string;
	readonly type: CommitGraphSourceRow['kind'];
	/** The worktree owning the row's tip, when it isn't the primary one. */
	readonly worktreePath?: string;
}

export interface GraphWipRowOpenDetail {
	readonly target: string;
	readonly sha: string;
	readonly altKey: boolean;
}

/** Also fires for a single click on a pill's PR/issue chip, with `metadata` naming the chip. */
export interface GraphRefDoubleClickDetail extends GraphContextMenuRef {
	readonly metadata?: GraphRefMetadataItem;
}

/** `sha: null` clears the selection. */
export interface GraphChangeSelectionDetail {
	readonly sha: string | null;
	readonly mode: 'replace' | 'toggle' | 'range';
	readonly rangeShas?: readonly string[];
}

export interface GraphRowDoubleClickDetail {
	readonly sha: string;
	readonly type: CommitGraphSourceRow['kind'];
}

/** Reports `started`, then exactly one of `found`, `exhausted` or `cancelled`. */
export interface GraphEdgeSearchDetail {
	readonly kind: 'forkPoint' | 'refRow';
	readonly status: 'started' | 'found' | 'exhausted' | 'cancelled';
}

/** Present only for a request the user made explicitly (and in debug builds). */
export interface GraphMoreRowsDetail {
	readonly displayRows: number;
	/** The user asked (the results bar), as opposed to the viewport filling itself. */
	readonly explicit: boolean;
}

/** The newest and oldest commit timestamps (ms) in view. */
export interface GraphVisibleDaysDetail {
	readonly top: number;
	readonly bottom: number;
}

/** Working-changes row ids, each once, in no particular order. */
export interface GraphWipShasDetail {
	readonly shas: readonly string[];
}

export interface GraphFilterColumnDetail {
	readonly zone: ZoneId;
}

export interface GraphChangeColumnModeDetail {
	readonly name: 'changes';
	readonly mode: ChangesColumnMode;
}

/** Every event `gl-commit-graph` dispatches; all bubble and are composed, and a missing detail is `null`. */
export interface CommitGraphEventMap {
	'gl-graph-avatarloaderror': CustomEvent<GraphAvatarLoadErrorDetail>;
	'gl-graph-changecolumnmode': CustomEvent<GraphChangeColumnModeDetail>;
	'gl-graph-changeselection': CustomEvent<GraphChangeSelectionDetail>;
	'gl-graph-changevisibledays': CustomEvent<GraphVisibleDaysDetail>;
	/** Cancelable. */
	'gl-graph-contextmenu': CustomEvent<GraphContextMenuDetail>;
	/** Cancelable. */
	'gl-graph-copyrequest': CustomEvent<GraphCopyRequestDetail>;
	'gl-graph-edgesearch': CustomEvent<GraphEdgeSearchDetail>;
	'gl-graph-enablechangescolumn': CustomEvent<void>;
	'gl-graph-filtercolumn': CustomEvent<GraphFilterColumnDetail>;
	/** Cancelable. */
	'gl-graph-headermenu': CustomEvent<GraphHeaderMenuDetail>;
	/** Cancelable. */
	'gl-graph-jumptocommit': CustomEvent<GraphJumpToCommitDetail>;
	'gl-graph-jumptonearestwip': CustomEvent<GraphJumpToNearestWipDetail>;
	'gl-graph-lanetoggle': CustomEvent<GraphLaneToggleDetail>;
	'gl-graph-lanetoggleall': CustomEvent<GraphLaneToggleAllDetail>;
	'gl-graph-missingavatars': CustomEvent<GraphMissingAvatarsDetail>;
	'gl-graph-missingrefsmetadata': CustomEvent<GraphMissingRefsMetadata>;
	'gl-graph-morerows': CustomEvent<GraphMoreRowsDetail | null>;
	'gl-graph-mouseleave': CustomEvent<void>;
	'gl-graph-openbranch': CustomEvent<GraphOpenBranchDetail>;
	'gl-graph-refdoubleclick': CustomEvent<GraphRefDoubleClickDetail>;
	'gl-graph-retryload': CustomEvent<void>;
	'gl-graph-rowaction': CustomEvent<GraphRowActionDetail>;
	'gl-graph-rowdoubleclick': CustomEvent<GraphRowDoubleClickDetail>;
	'gl-graph-rowhover': CustomEvent<GraphRowHoverDetail>;
	'gl-graph-rowhoverstart': CustomEvent<void>;
	'gl-graph-rowhovertrack': CustomEvent<GraphRowHoverTrackDetail>;
	'gl-graph-rowpeek': CustomEvent<GraphRowPeekRequest>;
	'gl-graph-rowunhover': CustomEvent<GraphRowUnhoverDetail>;
	'gl-graph-scopeanchorsunreachable': CustomEvent<GraphScopeAnchorsUnreachableDetail>;
	'gl-graph-unpinref': CustomEvent<void>;
	'gl-graph-visiblewipshaschanged': CustomEvent<GraphWipShasDetail>;
	'gl-graph-wipshasmissingstats': CustomEvent<GraphWipShasDetail>;
	'gl-graph-wiprowopen': CustomEvent<GraphWipRowOpenDetail>;
}
