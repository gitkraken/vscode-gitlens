import type {
	AdornmentState,
	ColumnNumberBySha,
	CommitType,
	CssVariables,
	ExcludeRefsById,
	ExternalIconKeys,
	GetExternalIcon,
	GraphColumnSetting,
	GraphColumnsSettings,
	GraphContainerProps,
	GraphPlatform,
	GraphRef,
	GraphRefGroup,
	GraphRefOptData,
	GraphRow,
	GraphSelectionState,
	GraphZoneType,
	OnFormatCommitDateTime,
	ReadonlyGraphRow,
	RowAdornment,
	RowAdornmentProvider,
} from '@gitkraken/gitkraken-components';
import GraphContainer, {
	CommitDateTimeSources,
	emptySetMarker,
	refZone,
	RowAdornmentInvalidateEvent,
} from '@gitkraken/gitkraken-components';
import type { ReactElement, ReactNode } from 'react';
import React, { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getAltKeySymbol, getPlatform } from '@env/platform.js';
import type { GitGraphRowHead } from '@gitlens/git/models/graph.js';
import { splitCommitMessage } from '@gitlens/git/utils/commit.utils.js';
import type { DateTimeFormat } from '@gitlens/utils/date.js';
import { formatDate, fromNow } from '@gitlens/utils/date.js';
import { groupByFilterMap } from '@gitlens/utils/iterable.js';
import { hasKeys } from '@gitlens/utils/object.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { DateStyle } from '../../../../../config.js';
import type {
	GraphAvatars,
	GraphColumnName,
	GraphColumnsConfig,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphItemContext,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	RowAction,
	State,
	UpdateGraphConfigurationParams,
} from '../../../../plus/graph/protocol.js';
import { isSecondaryWipSha } from '../../../../plus/graph/protocol.js';
import type { GlButton } from '../../../shared/components/button.js';
import type { CodeIcon } from '../../../shared/components/code-icon.js';
import { GlMarkdown } from '../../../shared/components/markdown/markdown.react.jsx';
import type { RunningOperationBucket } from '../components/detailsState.js';
import { rowAdornmentTooltipFor, statusIconFor } from '../components/runningOperationStatus.js';
import type { WipRowAgentStatus } from '../components/wipRowAgentStatus.js';
import { agentIndicatorTooltipFor, agentSuffixIconFor } from '../components/wipRowAgentStatus.js';
import type { GraphStateProvider } from '../stateProvider.js';
import { getCommitDateFromRow, pickRowUndoTarget } from '../utils/row.utils.js';
import {
	buildRowCommitContext,
	isUniqueToBranchRow,
	needsDynamicRowContext,
	reduceCommonWebviewItemsContext,
	rowHasChildren,
} from '../utils/rowContext.utils.js';
import '../../../shared/components/button.js';
import '../../../shared/components/code-icon.js';

export type GraphWrapperProps = Pick<
	State,
	| 'avatars'
	| 'columns'
	| 'context'
	| 'config'
	| 'downstreams'
	| 'rows'
	| 'excludeRefs'
	| 'excludeTypes'
	| 'nonce'
	| 'paging'
	| 'loading'
	| 'selectedRows'
	| 'windowFocused'
	| 'refsMetadata'
	| 'includeOnlyRefs'
	| 'pinnedRef'
	| 'rowsStats'
	| 'rowsStatsLoading'
	| 'workingTreeStats'
> &
	Pick<
		GraphStateProvider,
		'activeFilterColumns' | 'activeRow' | 'scope' | 'searchMode' | 'searchResults' | 'wipMetadataBySha'
	> & {
		/** Cross-pane signal projection: maps a graph row's `sha` (the synthetic value, e.g.
		 *  `work-dir-changes` for the primary WIP or `worktree-wip::<path>` for secondaries)
		 *  to the running compose/review mode for that anchor when one exists. Owned by
		 *  `graphCrossPaneContext`; the graph-wrapper Lit element translates the canonical
		 *  anchor-keyed map into this row-keyed shape so the React render is a plain
		 *  prop comparison and the React layer doesn't have to know about anchor-key
		 *  derivation. */
		runningOperationByRowSha?: ReadonlyMap<string, RunningOperationBucket>;
		/** Per-WIP-row agent status — same anchor-keying scheme as `runningOperationByRowSha`,
		 *  resolved from `agentSessions × wipMetadataBySha` in the Lit wrapper so the React render
		 *  is a plain prop comparison. `undefined` when no WIP row has a surfacing agent. */
		agentStatusByRowSha?: ReadonlyMap<string, WipRowAgentStatus>;
		/** Set of commit SHAs reachable from HEAD but not from HEAD's upstream — drives the
		 *  always-visible Push to Commit badge + hover-revealed push button on those rows. The
		 *  Lit wrapper projects this from `state.rows[].isUnpushed` (the gitkraken-components
		 *  library doesn't preserve custom fields on the row objects it hands to
		 *  `provideAdornments`). `undefined` when no commits are ahead of upstream. */
		unpublishedShas?: ReadonlySet<string>;
		theming?: GraphWrapperTheming;
		/** Selected repository's filesystem path, used to rebuild lean commit rows' `contexts.row` on
		 *  demand for the multi-select right-click context. */
		repoPath?: string;
		wipShasSettleDelayMs?: number;
		/**
		 * Controls whether the GK component auto-injects the primary "Working Changes" row.
		 * `'always'` is the default (matches previous behavior); `'auto'` defers to
		 * `workingTreeStats` (and shows nothing when those are undefined) so the host can
		 * suppress the primary row when the current branch is out of scope.
		 */
		wipVisibility?: 'always' | 'auto';
	};

export interface GraphWrapperEvents {
	onChangeColumns?: (columns: GraphColumnsConfig) => void;
	onChangeRefsVisibility?: (detail: { refs: GraphExcludedRef[]; visible: boolean }) => void;
	onChangeSelection?: (
		rows: ReadonlyGraphRow[],
		focusedRow: ReadonlyGraphRow | undefined,
		state: GraphSelectionState,
	) => void;
	onChangeVisibleDays?: (detail: { top: number; bottom: number }) => void;
	onFilterColumn?: (detail: { zone: GraphZoneType }) => void;
	onMissingAvatars?: (emails: Record<string, string>) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onRefDoubleClick?: (detail: { ref: GraphRef; metadata?: GraphRefMetadataItem }) => void;
	onMouseLeave?: () => void;
	onRowAction?: (detail: { action: RowAction; row: GraphRow; worktreePath?: string }) => void;
	onWipRowOpen?: (detail: { target: 'compose' | 'review' | 'agents'; row: GraphRow }) => void;
	onRowContextMenu?: (detail: { graphZoneType: GraphZoneType; graphRow: GraphRow; isAvatar: boolean }) => void;
	onRowDoubleClick?: (detail: { row: GraphRow; preserveFocus?: boolean }) => void;
	onRowHover?: (detail: {
		clientX: number;
		currentTarget: HTMLElement;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}) => void;
	onRowUnhover?: (detail: {
		relatedTarget: EventTarget | null;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}) => void;
	onRowActionHover?: () => void;
	onScopeAnchorsUnreachable?: (unreachableAnchors: Set<string>) => void;
	onWipShasMissingStats?: (shas: Record<string, true>) => void;
	onVisibleWipShasChanged?: (shas: Record<string, true>) => void;
	onColumnsCalculated?: (columnsBySha: ColumnNumberBySha) => void;
}

const getGraphDateFormatter = (config: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number, source?: CommitDateTimeSources) =>
		formatCommitDateTime(commitDateTime, config.dateStyle, config.dateFormat, source);
};

const createIconElements = (): Record<ExternalIconKeys | 'undefined-icon', ReactElement> => {
	const iconList = [
		'head',
		'filter',
		'remote',
		'remote-github',
		'remote-githubEnterprise',
		'remote-gitlab',
		'remote-gitlabSelfHosted',
		'remote-bitbucket',
		'remote-bitbucketServer',
		'remote-azureDevops',
		'tag',
		'stash',
		'check',
		'loading',
		'warning',
		'added',
		'modified',
		'deleted',
		'renamed',
		'resolved',
		'pull-request',
		'show',
		'hide',
		'branch',
		'graph',
		'commit',
		'author',
		'datetime',
		'message',
		'changes',
		'files',
		'worktree',
		'pin',
		'issue-github',
		'issue-githubEnterprise',
		'issue-gitlab',
		'issue-gitlabSelfHosted',
		'issue-jiraCloud',
		'issue-jiraServer',
		'issue-linear',
		'issue-azureDevops',
		'issue-bitbucket',
		'undefined-icon',
	];

	const miniIconList = ['upstream-ahead', 'upstream-behind'];

	const elementLibrary: Record<string, ReactElement> = {};
	iconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `graph-icon icon--${iconKey}` });
	});
	miniIconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `graph-icon mini-icon icon--${iconKey}` });
	});
	//TODO: fix this once the styling is properly configured component-side
	elementLibrary.settings = createElement('span', {
		className: 'graph-icon icon--settings',
		style: { fontSize: '1.1rem', right: '0px', top: '-1px' },
	});
	return elementLibrary;
};

const iconElementLibrary = createIconElements();

const getIconElementLibrary: GetExternalIcon = (iconKey: ExternalIconKeys) => {
	const icon = iconKey in iconElementLibrary ? iconKey : 'undefined-icon';
	return iconElementLibrary[icon];
};

const getClientPlatform = (): GraphPlatform => {
	switch (getPlatform()) {
		case 'web-macOS':
			return 'darwin';
		case 'web-windows':
			return 'win32';
		case 'web-linux':
		default:
			return 'linux';
	}
};

const clientPlatform = getClientPlatform();

interface SelectionContext {
	listDoubleSelection?: boolean;
	listMultiSelection?: boolean;
	listContiguousSelection?: boolean;
	listUniqueBranchSelection?: boolean;
	webviewItems?: string;
	webviewItemsValues?: GraphItemContext[];
}

interface SelectionContexts {
	contexts: Map<CommitType, SelectionContext>;
	selectedShas: Set<string>;
}

const emptySelectionContext: SelectionContext = {
	listDoubleSelection: false,
	listMultiSelection: false,
	listContiguousSelection: false,
	listUniqueBranchSelection: false,
	webviewItems: undefined,
	webviewItemsValues: undefined,
};

interface GraphWrapperAPI {
	setRef: (refObject: GraphContainer) => void;
}

export type GraphWrapperTheming = { cssVariables: CssVariables; themeOpacityFactor: number };

export type GraphWrapperSubscriberProps = GraphWrapperProps & GraphWrapperAPI;
export type GraphWrapperInitProps = GraphWrapperProps &
	GraphWrapperEvents &
	GraphWrapperAPI & {
		subscriber?: (updater: (props: Partial<GraphWrapperSubscriberProps>) => void) => void;
	};

const emptyRows: GraphRow[] = [];

// Note: `statusIconFor` extracted to `../components/runningOperationStatus.ts` so the details
// header (Lit) and the WIP-row adornment (React) share one mapping. Imported above.

function checkUniqueBranchSelection(selectedRows: GraphRow[]): boolean {
	if (selectedRows.length === 0) return false;

	const branchNames = new Set<string>();

	for (const row of selectedRows) {
		// `+unique` (reachable from exactly one local branch) comes from the row's `contexts.flags` bit.
		// Read it directly via `isUniqueToBranchRow` — lean commit rows no longer carry a serialized
		// `contexts.row` string to substring-match against.
		if (!isUniqueToBranchRow(row)) return false;

		if (row.heads && row.heads.length > 0) {
			for (const head of row.heads) {
				branchNames.add(head.name);
			}
		}
	}

	return branchNames.size <= 1;
}

export const GlGraphReact = memo((initProps: GraphWrapperInitProps) => {
	const [graph, _graphRef] = useState<GraphContainer | null>(null);
	const [context, setContext] = useState(initProps.context);
	const [props, setProps] = useState(initProps);
	const [selectionContexts, setSelectionContexts] = useState<SelectionContexts | undefined>();

	// Cache for parsed row contexts to avoid repeated JSON.parse calls
	const parsedSelectionContextCache = useRef<WeakMap<GraphRow, GraphItemContext>>(new WeakMap());

	/**
	 * Gets the parsed context for a row, using a WeakMap cache to avoid repeated JSON.parse calls.
	 * The cache is keyed by the row object reference, so if rows are recreated, they will be re-parsed.
	 */
	const repoPath = props.repoPath;
	const getParsedSelectionContext = useCallback(
		(row: GraphRow): GraphItemContext | undefined => {
			const cache = parsedSelectionContextCache.current;
			const cached = cache.get(row);
			if (cached !== undefined) return cached;

			let parsed: GraphItemContext | undefined;
			if (row.contexts?.row != null) {
				const rawContext = row.contexts.row;
				parsed = (typeof rawContext === 'string' ? JSON.parse(rawContext) : rawContext) as GraphItemContext;
			} else if (repoPath != null && needsDynamicRowContext(row)) {
				// Lean commit rows ship only `contexts.flags` (no serialized `contexts.row`); reconstruct
				// the context on demand so multi-select right-click can still boil down a common context.
				parsed = buildRowCommitContext(row, repoPath);
			}
			if (parsed === undefined) return undefined;

			cache.set(row, parsed);
			return parsed;
		},
		[repoPath],
	);

	// Register the state updater function with the subscriber if provided
	useEffect(
		() =>
			props.subscriber?.(newProps => {
				// Update state based on new props
				// if (newProps.context !== context) {
				// 	setContext(newProps.context);
				// }
				setProps(currentProps => ({ ...currentProps, ...newProps }));
			}),
		[props.subscriber],
	);

	useEffect(() => {
		setContext(props.context);
	}, [props.context]);

	const graphRef = useCallback(
		(graph: GraphContainer) => {
			_graphRef(graph);
			props.setRef(graph);
		},
		[props.setRef],
	);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				const sha = getActiveRowInfo(props.activeRow)?.id;
				if (sha == null) return;

				// TODO@eamodio a bit of a hack since the graph container ref isn't exposed in the types
				const _graph = (graph as any)?.graphContainerRef.current;
				if (!e.composedPath().some(el => el === _graph)) return;

				const row = props.rows?.find(r => r.sha === sha);
				if (row == null) return;

				initProps.onRowDoubleClick?.({ row: row, preserveFocus: e.key !== 'Enter' });
			}
		},
		[graph, props.activeRow, props.rows, initProps.onRowDoubleClick],
	);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [handleKeyDown]);

	const stopColumnResize = useCallback(() => {
		const activeResizeElement = document.querySelector('.graph-header .resizable.resizing');
		if (!activeResizeElement) return;

		// Trigger a mouseup event to reset the column resize state
		document.dispatchEvent(
			new MouseEvent('mouseup', {
				view: window,
				bubbles: true,
				cancelable: true,
			}),
		);
	}, []);

	const handleOnGraphMouseLeave = useCallback(
		(_event: React.MouseEvent<any>) => {
			initProps.onMouseLeave?.();
			stopColumnResize();
		},
		[initProps.onMouseLeave, stopColumnResize],
	);

	const handleMissingAvatars = useCallback(
		(emails: GraphAvatars) => {
			initProps.onMissingAvatars?.(emails);
		},
		[initProps.onMissingAvatars],
	);

	const handleMissingRefsMetadata = useCallback(
		(metadata: GraphMissingRefsMetadata) => {
			initProps.onMissingRefsMetadata?.(metadata);
		},
		[initProps.onMissingRefsMetadata],
	);

	const handleToggleColumnSettings = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
		const e = event.nativeEvent;
		const evt = new MouseEvent('contextmenu', {
			bubbles: true,
			clientX: e.clientX,
			clientY: e.clientY,
		});
		e.target?.dispatchEvent(evt);
		e.stopImmediatePropagation();
	}, []);

	const handleMoreCommits = useCallback(() => {
		initProps.onMoreRows?.();
	}, [initProps.onMoreRows]);

	const handleOnColumnResized = useCallback(
		(columnName: GraphColumnName, columnSettings: GraphColumnSetting) => {
			if (columnSettings.width) {
				initProps.onChangeColumns?.({
					[columnName]: {
						width: columnSettings.width,
						isHidden: columnSettings.isHidden,
						mode: columnSettings.mode,
						order: columnSettings.order,
					},
				});
			}
		},
		[initProps.onChangeColumns],
	);

	// Mirror `props.rows` into a ref so the visible-rows handler can resolve WIP rows against the
	// LIVE rows array without re-creating the handler each time rows change. Recreating the handler
	// on every rows update churns the GK component's event-binding cache, which has been observed to
	// call back with a stale handler closure during the WIP→commit scroll transition.
	const rowsRef = useRef(props.rows);
	rowsRef.current = props.rows;

	const handleOnGraphVisibleRowsChanged = useCallback(
		(top: GraphRow, bottom: GraphRow) => {
			// Synthetic WIP rows use `Date.now()` as their commit date and aren't real points on the
			// timeline, so they shouldn't expand the visible-window range. Resolve a visible WIP to
			// the nearest real row INSIDE the viewport: walk forward for `top` (newer edge → toward
			// older), walk backward for `bottom` (older edge → toward newer). Either direction lands
			// on the adjacent non-WIP row that's still inside the viewport, so the overlay reflects
			// only the REAL commits actually visible — never spilling past WIPs sitting at either
			// edge of the viewport.
			const dateForRow = (row: GraphRow, step: 1 | -1): number => {
				if (row.type === 'work-dir-changes') {
					const rows = rowsRef.current;
					if (rows != null) {
						// The GK component wraps incoming rows into processed objects pushed into its
						// internal `orderedGraphRows`, so the row reference passed to this callback is
						// NOT the same instance as our decorated rows. Look up by `sha`, which is
						// invariant across the wrap.
						const sha = row.sha;
						const idx = rows.findIndex(r => r.sha === sha);
						if (idx !== -1) {
							for (let i = idx + step; i >= 0 && i < rows.length; i += step) {
								if (rows[i].type !== 'work-dir-changes') {
									return getCommitDateFromRow(rows[i]);
								}
							}
						}
					}
				}
				return getCommitDateFromRow(row);
			};
			initProps.onChangeVisibleDays?.({
				top: new Date(dateForRow(top, 1)).setHours(23, 59, 59, 999),
				bottom: new Date(dateForRow(bottom, -1)).setHours(0, 0, 0, 0),
			});
		},
		[initProps.onChangeVisibleDays],
	);

	const handleOnGraphColumnsReOrdered = useCallback(
		(columnsSettings: GraphColumnsSettings) => {
			const graphColumnsConfig: GraphColumnsConfig = {};
			for (const [columnName, config] of Object.entries(columnsSettings as GraphColumnsConfig)) {
				graphColumnsConfig[columnName] = { ...config };
			}
			initProps.onChangeColumns?.(graphColumnsConfig);
		},
		[initProps.onChangeColumns],
	);

	// dirty trick to avoid mutations on the GraphContainer side
	const fixedExcludeRefsById = useMemo(
		(): ExcludeRefsById | undefined => (props.excludeRefs ? { ...props.excludeRefs } : undefined),
		[props.excludeRefs],
	);
	const handleOnToggleRefsVisibilityClick = useCallback(
		(_event: any, refs: GraphRefOptData[], visible: boolean) => {
			if (!visible) {
				document.getElementById('hiddenRefs')?.animate(
					[
						{ offset: 0, background: 'transparent' },
						{
							offset: 0.4,
							background: 'var(--vscode-statusBarItem-warningBackground)',
						},
						{ offset: 1, background: 'transparent' },
					],
					{
						duration: 1000,
						iterations: !hasKeys(fixedExcludeRefsById) ? 2 : 1,
					},
				);
			}
			initProps.onChangeRefsVisibility?.({ refs: refs, visible: visible });
		},
		[fixedExcludeRefsById, initProps.onChangeRefsVisibility],
	);

	const handleOnDoubleClickRef = useCallback(
		(
			_event: React.MouseEvent<HTMLButtonElement>,
			refGroup: GraphRefGroup,
			_row: GraphRow,
			metadata?: GraphRefMetadataItem,
		) => {
			if (refGroup.length > 0) {
				initProps.onRefDoubleClick?.({ ref: refGroup[0], metadata: metadata });
			}
		},
		[initProps.onRefDoubleClick],
	);

	const handleOnDoubleClickRow = useCallback(
		(_event: React.MouseEvent<HTMLButtonElement>, graphZoneType: GraphZoneType, row: GraphRow) => {
			if (graphZoneType === refZone) return;

			initProps.onRowDoubleClick?.({ row: row, preserveFocus: true });
		},
		[initProps.onRowDoubleClick],
	);

	/**
	 * Computes the selection context for VS Code context menu integration.
	 * This MUST be synchronous as context is needed immediately for right-click menus.
	 *
	 * Performance optimizations:
	 * 1. Uses cached parsed contexts (WeakMap) to avoid repeated JSON.parse calls
	 * 2. Optimized algorithm for finding common context denominators
	 * 3. Computed imperatively when selection changes for immediate availability
	 */
	const computeSelectionContext = useCallback(
		(rows: GraphRow[], _focusedRow: GraphRow | undefined, state: GraphSelectionState) => {
			// Early exit: check if we have at least 2 selected rows
			if (rows.length <= 1) return undefined;

			const selectedShas = new Set<string>();
			const selectedShasList: string[] = [];
			for (const row of rows) {
				selectedShas.add(row.sha);
				selectedShasList.push(row.sha);
			}

			const isContiguous = state.isContiguous;
			const isUniqueBranch = checkUniqueBranchSelection(rows);

			// Group the selected rows by their type and only include ones that have row context
			// Use cached parsing to avoid repeated JSON.parse calls
			const grouped = groupByFilterMap(rows, r => r.type, getParsedSelectionContext);

			const contexts: SelectionContexts['contexts'] = new Map<CommitType, SelectionContext>();

			for (const [type, items] of grouped) {
				// Boil the rows' contexts down to a least-common-denominator `webviewItems` (shared base type +
				// the additions common to every row). `undefined` means the group mixed base types (a context
				// setup error that should NOT happen at runtime) — drop it so we don't surface a misleading
				// combined context.
				const webviewItems = reduceCommonWebviewItemsContext(items.map(item => item.webviewItem));

				const count = webviewItems != null ? items.length : 0;
				contexts.set(type, {
					listDoubleSelection: count === 2,
					listMultiSelection: count > 1,
					listContiguousSelection: isContiguous,
					listUniqueBranchSelection: isUniqueBranch,
					webviewItems: webviewItems,
					webviewItemsValues: count > 1 ? items : undefined,
				});
			}

			return { contexts: contexts, selectedShas: selectedShas };
		},
		// Depends only on `getParsedSelectionContext` — operates on the `rows` PARAMETER, never
		// `props.rows`; the stale dep recreated this (and downstream handlers) on every rows change.
		[getParsedSelectionContext],
	);

	const handleSelectGraphRows = useCallback(
		(rows: ReadonlyGraphRow[], focusedRow: ReadonlyGraphRow | undefined, state: GraphSelectionState) => {
			// Compute context synchronously when selection changes
			const newContext = rows.length > 1 ? computeSelectionContext(rows, focusedRow, state) : undefined;
			setSelectionContexts(newContext);

			initProps.onChangeSelection?.(rows, focusedRow, state);
		},
		[computeSelectionContext, initProps.onChangeSelection],
	);

	const handleRowContextMenu = useCallback(
		(event: React.MouseEvent<any>, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
			if (graphZoneType === refZone) return;

			// The avatar, the bare commit node, and the lane lines all live in the same `graph` zone, so
			// `graphZoneType` can't tell them apart. Detect an avatar right-click from the event target
			// (GK applies the `avatar` class to the contributor-avatar element) so the host builds the
			// contributor context for the avatar and the commit context for the node/lanes.
			const isAvatar = (event.target as HTMLElement | null)?.closest?.('.avatar') != null;

			// If the row is in the current selection, use the typed selection context, otherwise clear it
			const newSelectionContext = selectionContexts?.selectedShas.has(graphRow.sha)
				? selectionContexts.contexts.get(graphRow.type)
				: emptySelectionContext;

			setContext({
				...context,
				graph: {
					...(context?.graph != null && typeof context.graph === 'string'
						? JSON.parse(context.graph)
						: context?.graph),
					...newSelectionContext,
				},
			});

			initProps.onRowContextMenu?.({ graphZoneType: graphZoneType, graphRow: graphRow, isAvatar: isAvatar });
		},
		[selectionContexts, context, initProps.onRowContextMenu],
	);

	const emptyConfig = useMemo(() => ({}) as unknown as NonNullable<typeof props.config>, []);
	const config = useMemo(() => props.config ?? emptyConfig, [props.config, emptyConfig]);

	// Augment the host-supplied columns with client-side `isFilterActive` flags derived from
	// the current search query. The host config stays unaware of search state.
	const columnsSettings = useMemo<GraphColumnsSettings | undefined>(() => {
		const columns = props.columns;
		if (columns == null) return undefined;

		const active = props.activeFilterColumns;
		if (active == null || active.size === 0) return columns;

		const result: GraphColumnsSettings = { ...columns };
		for (const [name, setting] of Object.entries(columns) as [GraphColumnName, GraphColumnSetting][]) {
			if (active.has(name)) {
				result[name] = { ...setting, isFilterActive: true };
			}
		}
		return result;
	}, [props.columns, props.activeFilterColumns]);

	// In filter mode, once the search result set is fully loaded there's nothing more for commit
	// paging to surface — stop the GK component's `loadMoreCommitsIfNecessary` loop from paging
	// through the entire history to "fill" the viewport. (For `type:wip` the synthetic result set
	// is always reported as fully loaded, so this short-circuits immediately.)
	const hasMoreCommits = useMemo(() => {
		const results = props.searchResults;
		if (
			props.searchMode === 'filter' &&
			results != null &&
			!results.hasMore &&
			results.commitsLoaded.count === results.count
		) {
			return false;
		}
		return props.paging?.hasMore;
	}, [props.searchMode, props.searchResults, props.paging?.hasMore]);

	// Memoize highlightedShas to avoid creating new object references
	const highlightedShas = useMemo(() => {
		if (props.searchResults == null) return undefined;
		// Forces the graph to show no commits, because this set will never match any commits
		if (!props.searchResults.count) return { [emptySetMarker]: true };

		// Cast the { [id: string]: number } object to { [id: string]: boolean } for performance
		return props.searchResults.ids as GraphContainerProps['highlightedShas'];
	}, [props.searchResults]);

	const formatCommitMessage = (commitMessage: string) => {
		const { summary, body } = splitCommitMessage(commitMessage);

		return {
			summary: <GlMarkdown markdown={summary} inline></GlMarkdown>,
			body: body ? <GlMarkdown markdown={body} inline></GlMarkdown> : undefined,
		};
	};

	const renderFooter = useCallback((): ReactElement | undefined => {
		// No results found
		if (props.searchResults?.count === 0) {
			return <span>No results found</span>;
		}

		// Only show footer when we have results AND not currently loading
		if (!props.searchResults?.count || props.loading) {
			return undefined;
		}

		// All search results are loaded and visible OR no more commits available
		if (
			props.searchMode === 'filter' &&
			!props.searchResults.hasMore &&
			(props.searchResults.commitsLoaded.count === props.searchResults.count || !props.paging?.hasMore)
		) {
			return (
				<span className="graph-footer__message">
					{`Showing all ${pluralize('result', props.searchResults.count)}`}
				</span>
			);
		}

		// We have search results but all commits aren't loaded yet
		return (
			<>
				<span className="graph-footer__message">
					{`Showing ${pluralize('result', props.searchResults.commitsLoaded.count)} of ${pluralize(
						'result',
						props.searchResults.count,
					)}${props.searchResults.hasMore ? '+' : ''}`}
				</span>
				<a
					className="graph-footer__link"
					onClick={e => {
						e.preventDefault();
						handleMoreCommits();
					}}
					role="button"
					tabIndex={0}
					onKeyDown={e => {
						if (e.key === 'Enter' || e.key === ' ') {
							e.preventDefault();
							handleMoreCommits();
						}
					}}
				>
					{props.searchMode === 'filter' ? 'Load more results...' : 'Load more commits...'}
				</a>
			</>
		);
	}, [props.searchResults, props.loading, props.searchMode, props.paging?.hasMore, handleMoreCommits]);

	const footer = renderFooter();

	const handleJumpToPinnedBranch = useCallback(() => {
		const pinnedRef = props.pinnedRef;
		if (pinnedRef?.sha == null) return;

		document.dispatchEvent(new CustomEvent('gl-jump-to-pinned-branch', { detail: { sha: pinnedRef.sha } }));
	}, [props.pinnedRef]);

	const headerZoneActions = useMemo((): Partial<Record<GraphZoneType, ReactNode>> | undefined => {
		if (props.pinnedRef?.sha == null) return undefined;
		return {
			graph: (
				<gl-button
					className="jump-to-pinned-branch"
					appearance="toolbar"
					tooltip="Jump to Pinned Branch"
					onClick={handleJumpToPinnedBranch}
				>
					<code-icon icon="pinned"></code-icon>
				</gl-button>
			),
		};
	}, [props.pinnedRef, handleJumpToPinnedBranch]);

	// Stable EventTarget across renders — the gitkraken graph subscribes once and listens for
	// `invalidate` events to drop cached adornments. A fresh target per render would leave
	// the graph subscribed to a target nobody dispatches on.
	const invalidateTarget = useMemo(() => new EventTarget(), []);

	// Bust the adornment cache when the row-keyed running-modes OR agent-status maps change.
	// Must dispatch a RowAdornmentInvalidateEvent (a CustomEvent carrying `detail.type`) — the
	// graph's `onInvalidate` handler destructures `e.detail`, so a plain `Event` throws there
	// and the cache never clears. `'all'` re-runs BOTH `provideAdornments` (visibility —
	// secondary WIPs pin their adornment visible when an operation or agent attaches to the
	// row) AND `resolveAdornment` (the overlay icons).
	useEffect(() => {
		invalidateTarget.dispatchEvent(new RowAdornmentInvalidateEvent('all'));
	}, [props.runningOperationByRowSha, props.agentStatusByRowSha, props.unpublishedShas, invalidateTarget]);

	const rowAdornmentProvider: RowAdornmentProvider = {
		invalidate: invalidateTarget,
		provideAdornments: (
			rows: readonly ReadonlyGraphRow[],
			cancellation: AbortSignal,
		): Record<string, RowAdornment> | Promise<Record<string, RowAdornment>> => {
			const adornments: Record<string, RowAdornment> = {};
			for (const row of rows) {
				if (cancellation.aborted) return {};

				switch (row.type) {
					case 'work-dir-changes': {
						const isSecondaryWip = isSecondaryWipSha(row.sha);
						// Secondary WIPs default to hover/focus/selected to keep the graph quiet, but
						// pin them visible whenever a review/compose operation OR an agent is attached
						// to the row so the status overlay stays readable without requiring hover.
						const hasOperation = props.runningOperationByRowSha?.get(row.sha) != null;
						const hasAgent = props.agentStatusByRowSha?.get(row.sha) != null;
						adornments[row.sha] = {
							visibility:
								!isSecondaryWip || hasOperation || hasAgent ? true : ['hover', 'focus', 'selected'],
							// Compose/Review buttons are full-strength only while their operation is active;
							// otherwise they reveal on interaction — so resolve must re-run on hover/focus/
							// selected changes.
							dynamic: 'interaction',
						};
						break;
					}
					case 'stash-node':
						adornments[row.sha] = { visibility: ['hover', 'focus', 'selected'] };
						break;
					case 'commit-node':
					case 'merge-node':
						// Unpushed rows keep the overlay always-rendered for the at-rest unpushed indicator;
						// that indicator becomes the Push to Commit action — and Undo/diff appear — on
						// interaction, so resolve must re-run on hover/focus/selected changes. Pushed rows use
						// the plain hover-only slot (resolve only runs while interacting, so no `dynamic`).
						adornments[row.sha] = props.unpublishedShas?.has(row.sha)
							? { visibility: true, dynamic: 'interaction' }
							: { visibility: ['hover', 'focus', 'selected'] };
						break;
				}
			}

			return adornments;
		},

		resolveAdornment: (
			row: ReadonlyGraphRow,
			_context: undefined,
			state?: AdornmentState,
		): ReactNode | null | Promise<ReactNode | null> => {
			// Live interaction state (hover/focus/selected) for adornments marked `dynamic: 'interaction'`,
			// without depending on the library's internal CSS state classes. Drives the at-rest → revealed
			// transition for idle WIP compose/review buttons and for unpushed commits' Undo/diff actions.
			const interacting = state?.isHovered === true || state?.isFocused === true || state?.isSelected === true;
			switch (row.type) {
				case 'work-dir-changes': {
					const bucket = props.runningOperationByRowSha?.get(row.sha);
					const composeHasResult = bucket?.compose?.result != null;
					const reviewHasResult = bucket?.review?.result != null;
					const composeStatusIcon =
						bucket?.compose != null ? statusIconFor(bucket.compose.execState, composeHasResult) : null;
					const reviewStatusIcon =
						bucket?.review != null ? statusIconFor(bucket.review.execState, reviewHasResult) : null;
					const composeTooltip = rowAdornmentTooltipFor(
						'compose',
						bucket?.compose?.execState,
						composeHasResult,
					);
					const reviewTooltip = rowAdornmentTooltipFor('review', bucket?.review?.execState, reviewHasResult);

					// Compose/Review are "active" while their operation is pending or done (a bucket entry
					// exists). Active buttons stay full-strength at rest so their status icon is readable;
					// idle buttons reveal on interaction (hover/focus/selection, via `interacting`) and hide
					// otherwise to keep the WIP row quiet. Note: the primary WIP row is auto-selected on load,
					// so its idle buttons show until the user navigates to another row.
					const composeActive = bucket?.compose != null;
					const reviewActive = bucket?.review != null;

					const agentStatus = props.agentStatusByRowSha?.get(row.sha);
					const agentSuffix = agentStatus != null ? agentSuffixIconFor(agentStatus.category) : undefined;
					const agentTooltip =
						agentStatus != null ? agentIndicatorTooltipFor(agentStatus.category) : undefined;

					return (
						<div className="graph-row-actions" onMouseOver={() => initProps.onRowActionHover?.()}>
							{agentStatus != null && (
								<gl-button
									className={`agent-indicator agent-indicator--${agentStatus.category}`}
									appearance="toolbar"
									onClick={() => initProps.onWipRowOpen?.({ target: 'agents', row: row })}
									tooltip={agentTooltip}
									aria-label={agentTooltip}
								>
									<code-icon icon="robot"></code-icon>
									{agentSuffix != null && (
										<code-icon
											slot="suffix"
											icon={agentSuffix}
											modifier={agentStatus.category === 'working' ? 'spin' : ''}
										></code-icon>
									)}
								</gl-button>
							)}
							{(composeActive || interacting) && (
								<gl-button
									onClick={() => initProps.onWipRowOpen?.({ target: 'compose', row: row })}
									tooltip={composeTooltip}
									aria-label={composeTooltip}
								>
									<code-icon icon="wand"></code-icon>
									{composeStatusIcon != null && (
										<code-icon
											slot="suffix"
											icon={composeStatusIcon}
											modifier={composeStatusIcon === 'loading' ? 'spin' : ''}
										></code-icon>
									)}
								</gl-button>
							)}
							{(reviewActive || interacting) && (
								<gl-button
									onClick={() => initProps.onWipRowOpen?.({ target: 'review', row: row })}
									tooltip={reviewTooltip}
									aria-label={reviewTooltip}
								>
									<code-icon icon="checklist"></code-icon>
									{reviewStatusIcon != null && (
										<code-icon
											slot="suffix"
											icon={reviewStatusIcon}
											modifier={reviewStatusIcon === 'loading' ? 'spin' : ''}
										></code-icon>
									)}
								</gl-button>
							)}
							<div>
								<gl-button
									appearance="toolbar"
									onClick={() => initProps.onRowAction?.({ action: 'stash-save', row: row })}
									tooltip="Stash All Changes..."
									aria-label="Stash All Changes..."
								>
									<code-icon icon="gl-stash-save"></code-icon>
								</gl-button>
							</div>
						</div>
					);
				}
				case 'stash-node':
					return (
						<div className="graph-row-actions" onMouseOver={() => initProps.onRowActionHover?.()}>
							<gl-button
								appearance="toolbar"
								onClick={() => initProps.onRowAction?.({ action: 'stash-apply', row: row })}
								tooltip="Apply / Pop Stash..."
								aria-label="Apply / Pop Stash..."
							>
								<code-icon icon="git-stash-apply"></code-icon>
							</gl-button>
							<gl-button
								appearance="toolbar"
								onClick={() => initProps.onRowAction?.({ action: 'stash-drop', row: row })}
								tooltip="Drop Stash..."
								aria-label="Drop Stash..."
							>
								<code-icon icon="trash"></code-icon>
							</gl-button>
						</div>
					);
				case 'commit-node':
				case 'merge-node': {
					// If the row is the leaf HEAD of a worktree, surface an inline Undo affordance that
					// routes to that worktree's working copy. `pickRowUndoTarget` is shared with the host's
					// right-click context builder so the button and the menu apply the same rules: undo is
					// withheld for commits with children (leaf-only — see `HasChildren`); the active worktree
					// wins (no worktreePath → host uses primary repoPath); otherwise it shows only when
					// exactly one worktree owns this tip (multiple is ambiguous → hidden).
					const { currentHead, worktreeHead } = pickRowUndoTarget(
						row.heads as ReadonlyArray<GitGraphRowHead> | undefined,
						rowHasChildren(row),
					);
					const showUndo = currentHead != null || worktreeHead != null;
					const undoWorktreePath = worktreeHead?.worktree?.path;
					const undoBranchName = worktreeHead?.name;
					const undoLabel = undoBranchName != null ? `Undo Commit on ${undoBranchName}` : 'Undo Commit';

					const isUnpushed = props.unpublishedShas?.has(row.sha) === true;
					// Pushed rows render in a hover-only overlay (resolve runs only while interacting), so
					// their actions always show when present. Unpushed rows render an always-present overlay
					// (for the at-rest unpushed indicator), so their actions appear only while interacting —
					// at rest only the indicator shows.
					const showActions = isUnpushed ? interacting : true;

					return (
						<div className="graph-row-actions" onMouseOver={() => initProps.onRowActionHover?.()}>
							{showUndo && showActions && (
								<gl-button
									appearance="toolbar"
									onClick={() =>
										initProps.onRowAction?.({
											action: 'undo-commit',
											row: row,
											worktreePath: undoWorktreePath,
										})
									}
									tooltip={undoLabel}
									aria-label={undoLabel}
								>
									<code-icon icon="discard"></code-icon>
								</gl-button>
							)}
							{showActions && (
								<gl-button
									appearance="toolbar"
									onClick={e =>
										initProps.onRowAction?.({
											action: e.altKey ? 'open-changes-with-working' : 'open-changes',
											row: row,
										})
									}
									tooltip={`Open All Changes\n[${getAltKeySymbol()}] Open All Changes with Working Tree)`}
									aria-label="Open All Changes"
								>
									<code-icon icon="diff-multiple"></code-icon>
								</gl-button>
							)}
							{/* The unpushed indicator IS the Push to Commit action: one cloud-upload button,
							    colorized so it reads as an "ahead" badge at rest, that pushes on click.
							    Always present (not gated by `interacting`) and rendered last so it stays
							    pinned to the overlay's fixed right edge — hover-only actions grow leftward
							    and never shift it. */}
							{isUnpushed ? (
								<gl-button
									appearance="toolbar"
									className="unpushed-push-button"
									onClick={() => initProps.onRowAction?.({ action: 'push-to-commit', row: row })}
									tooltip="Push to Commit..."
									aria-label="Push to Commit..."
								>
									<code-icon icon="cloud-upload"></code-icon>
								</gl-button>
							) : null}
						</div>
					);
				}
			}
			return null;
		},
	};

	return (
		<GraphContainer
			ref={graphRef}
			rowAdornmentProvider={rowAdornmentProvider}
			avatarUrlByEmail={props.avatars}
			columnsSettings={columnsSettings}
			contexts={context}
			formatCommitMessage={formatCommitMessage}
			cssVariables={props.theming?.cssVariables}
			customFooterRow={footer}
			headerZoneActions={headerZoneActions}
			dimMergeCommits={config.dimMergeCommits}
			onlyFirstParent={props.scope != null ? true : Boolean(config.onlyFollowFirstParent)}
			downstreamsByUpstream={props.downstreams}
			enabledRefMetadataTypes={config.enabledRefMetadataTypes}
			enabledScrollMarkerTypes={config.scrollMarkerTypes}
			enableShowHideRefsOptions
			enableMultiSelection={config.multiSelectionMode !== false}
			excludeRefsById={props.excludeRefs}
			excludeByType={props.excludeTypes}
			formatCommitDateTime={getGraphDateFormatter(config)}
			getExternalIcon={getIconElementLibrary}
			graphRows={props.rows ?? emptyRows}
			hasMoreCommits={hasMoreCommits}
			hasMoreSearchResults={props.searchResults?.hasMore}
			highlightedShas={highlightedShas}
			highlightRowsOnRefHover={config.highlightRowsOnRefHover}
			includeOnlyRefsById={props.includeOnlyRefs}
			scrollRowPadding={config.scrollRowPadding}
			showGhostRefsOnRowHover={config.showGhostRefsOnRowHover}
			showRemoteNamesOnRefs={config.showRemoteNamesOnRefs}
			isContainerWindowFocused={props.windowFocused}
			isLoadingRows={props.loading}
			isSelectedBySha={props.selectedRows}
			nonce={props.nonce}
			pinnedBranchFullName={props.pinnedRef?.id ?? null}
			onColumnResized={handleOnColumnResized}
			onDoubleClickGraphRow={handleOnDoubleClickRow}
			onDoubleClickGraphRef={handleOnDoubleClickRef}
			onGraphColumnsReOrdered={handleOnGraphColumnsReOrdered}
			onGraphMouseLeave={handleOnGraphMouseLeave}
			onGraphRowHovered={(e, graphZoneType, graphRow) =>
				initProps.onRowHover?.({
					clientX: e.clientX,
					currentTarget: e.currentTarget,
					graphRow: graphRow,
					graphZoneType: graphZoneType,
				})
			}
			onGraphRowUnhovered={(e, graphZoneType, graphRow) =>
				initProps.onRowUnhover?.({
					relatedTarget: e.nativeEvent.relatedTarget ?? e.relatedTarget,
					graphRow: graphRow,
					graphZoneType: graphZoneType,
				})
			}
			onFilterColumnClick={(_e, graphZoneType) => initProps.onFilterColumn?.({ zone: graphZoneType })}
			onRowContextMenu={handleRowContextMenu}
			onSettingsClick={handleToggleColumnSettings}
			onSelectGraphRows={handleSelectGraphRows}
			onToggleRefsVisibilityClick={handleOnToggleRefsVisibilityClick}
			onEmailsMissingAvatarUrls={handleMissingAvatars}
			onRefsMissingMetadata={handleMissingRefsMetadata}
			onShowMoreCommits={handleMoreCommits}
			onGraphVisibleRowsChanged={handleOnGraphVisibleRowsChanged}
			platform={clientPlatform}
			refMetadataById={props.refsMetadata}
			rowsStats={props.rowsStats}
			rowsStatsLoading={props.rowsStatsLoading}
			searchMode={props.searchMode ?? 'normal'}
			shaLength={config.idLength}
			shiftSelectMode={config.multiSelectionMode === 'topological' ? 'topological' : 'simple'}
			stickyTimeline={config.stickyTimeline}
			suppressNonRefRowTooltips
			themeOpacityFactor={props.theming?.themeOpacityFactor}
			useAuthorInitialsForAvatars={!config.avatars}
			workDirStats={props.workingTreeStats}
			wipVisibility={props.wipVisibility ?? 'always'}
			wipNodeMetadataBySha={props.wipMetadataBySha}
			wipShasSettleDelayMs={props.wipShasSettleDelayMs}
			scope={props.scope}
			onScopeAnchorsUnreachable={initProps.onScopeAnchorsUnreachable}
			onWipShasMissingStats={initProps.onWipShasMissingStats}
			onVisibleWipShasChanged={initProps.onVisibleWipShasChanged}
			onColumnsCalculated={initProps.onColumnsCalculated}
		/>
	);
});

function formatCommitDateTime(
	date: number,
	style: DateStyle = 'absolute',
	format: DateTimeFormat | string = 'short+short',
	source?: CommitDateTimeSources,
): string {
	switch (source) {
		case CommitDateTimeSources.Tooltip:
			return `${formatDate(date, format)} (${fromNow(date)})`;
		case CommitDateTimeSources.RowEntry:
		default:
			return style === 'relative' ? fromNow(date) : formatDate(date, format);
	}
}

function getActiveRowInfo(activeRow: string | undefined): { id: string; date: number } | undefined {
	if (activeRow == null) return undefined;

	const [id, date] = activeRow.split('|');
	return {
		id: id,
		date: Number(date),
	};
}

type LitElementProps<T> = React.HTMLAttributes<T> & Partial<Omit<T, keyof HTMLElement>>;

declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace React.JSX {
		interface IntrinsicElements {
			'gl-button': LitElementProps<GlButton>;
			'code-icon': LitElementProps<CodeIcon>;
		}
	}

	interface GlobalEventHandlersEventMap {
		// event map from react wrapped component
		'graph-changecolumns': CustomEvent<{ settings: GraphColumnsConfig }>;
		'graph-changegraphconfiguration': CustomEvent<UpdateGraphConfigurationParams['changes']>;
		'graph-changerefsvisibility': CustomEvent<{ refs: GraphExcludedRef[]; visible: boolean }>;
		'graph-changeselection': CustomEvent<{
			rows: ReadonlyGraphRow[];
			focusedRow: ReadonlyGraphRow | undefined;
			state: GraphSelectionState;
		}>;
		'graph-doubleclickref': CustomEvent<{ ref: GraphRef; metadata?: GraphRefMetadataItem }>;
		'graph-doubleclickrow': CustomEvent<{ row: GraphRow; preserveFocus?: boolean }>;
		'graph-filtercolumn': CustomEvent<{ zone: GraphZoneType }>;
		'graph-missingavatars': CustomEvent<GraphAvatars>;
		'graph-missingrefsmetadata': CustomEvent<GraphMissingRefsMetadata>;
		'graph-morerows': CustomEvent<string | undefined>;
		'graph-changevisibledays': CustomEvent<{ top: number; bottom: number }>;
		'graph-graphrowhovered': CustomEvent<{
			clientX: number;
			currentTarget: HTMLElement;
			graphZoneType: GraphZoneType;
			graphRow: GraphRow;
		}>;
		'graph-graphrowunhovered': CustomEvent<{
			relatedTarget: HTMLElement;
			graphZoneType: GraphZoneType;
			graphRow: GraphRow;
		}>;
		'graph-rowcontextmenu': CustomEvent<{ graphZoneType: GraphZoneType; graphRow: GraphRow; isAvatar: boolean }>;
		'graph-graphmouseleave': CustomEvent<void>;
	}
}
