import type {
	CommitType,
	CssVariables,
	ExcludeRefsById,
	ExternalIconKeys,
	GetExternalIcon,
	GraphColumnMode,
	GraphColumnSetting,
	GraphColumnsSettings,
	GraphContainerProps,
	GraphPlatform,
	GraphRef,
	GraphRefGroup,
	GraphRefOptData,
	GraphRow,
	GraphZoneType,
	OnFormatCommitDateTime,
} from '@gitkraken/gitkraken-components';
import GraphContainer, { CommitDateTimeSources, noShaHighlightedSha, refZone } from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import type { DateStyle } from '../../../../../config';
import { splitCommitMessage } from '../../../../../git/utils/commit.utils';
import type { DateTimeFormat } from '../../../../../system/date';
import { formatDate, fromNow } from '../../../../../system/date';
import { first, groupByFilterMap } from '../../../../../system/iterable';
import { hasKeys } from '../../../../../system/object';
import type {
	GraphAvatars,
	GraphColumnName,
	GraphColumnsConfig,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphItemContext,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	State,
	UpdateGraphConfigurationParams,
} from '../../../../plus/graph/protocol';
import { GlMarkdown } from '../../../shared/components/markdown/markdown.react';
import type { GraphStateProvider } from '../stateProvider';

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
	| 'rowsStats'
	| 'rowsStatsLoading'
	| 'workingTreeStats'
> &
	Pick<GraphStateProvider, 'activeRow' | 'searchMode' | 'searchResults'> & { theming?: GraphWrapperTheming };

export interface GraphWrapperEvents {
	onChangeColumns?: (columns: GraphColumnsConfig) => void;
	onChangeRefsVisibility?: (detail: { refs: GraphExcludedRef[]; visible: boolean }) => void;
	onChangeSelection?: (rows: GraphRow[]) => void;
	onChangeVisibleDays?: (detail: { top: number; bottom: number }) => void;
	onMissingAvatars?: (emails: Record<string, string>) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onRefDoubleClick?: (detail: { ref: GraphRef; metadata?: GraphRefMetadataItem }) => void;
	onMouseLeave?: () => void;
	onRowContextMenu?: (detail: { graphZoneType: GraphZoneType; graphRow: GraphRow }) => void;
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
	const getParsedSelectionContext = useCallback((row: GraphRow): GraphItemContext | undefined => {
		if (row.contexts?.row == null) return undefined;

		const cache = parsedSelectionContextCache.current;
		let parsed = cache.get(row);
		if (parsed === undefined) {
			const rawContext = row.contexts.row;
			parsed = (typeof rawContext === 'string' ? JSON.parse(rawContext) : rawContext) as GraphItemContext;
			cache.set(row, parsed);
		}
		return parsed;
	}, []);

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
						mode: columnSettings.mode as GraphColumnMode,
						order: columnSettings.order,
					},
				});
			}
		},
		[initProps.onChangeColumns],
	);

	const handleOnGraphVisibleRowsChanged = useCallback(
		(top: GraphRow, bottom: GraphRow) => {
			initProps.onChangeVisibleDays?.({
				top: new Date(top.date).setHours(23, 59, 59, 999),
				bottom: new Date(bottom.date).setHours(0, 0, 0, 0),
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
		(rows: GraphRow[]) => {
			// Early exit: check if we have at least 2 selected rows
			if (rows.length <= 1) return undefined;

			const selectedShas = new Set<string>();
			for (const row of rows) {
				selectedShas.add(row.sha);
			}

			// Group the selected rows by their type and only include ones that have row context
			// Use cached parsing to avoid repeated JSON.parse calls
			const grouped = groupByFilterMap(rows, r => r.type, getParsedSelectionContext);

			const contexts: SelectionContexts['contexts'] = new Map<CommitType, SelectionContext>();

			for (let [type, items] of grouped) {
				let webviewItems: string | undefined;

				// Collect unique context values
				const contextValues = new Set<string>();
				for (const item of items) {
					contextValues.add(item.webviewItem);
				}

				if (contextValues.size === 1) {
					webviewItems = first(contextValues);
				} else if (contextValues.size > 1) {
					// If there are multiple contexts, see if they can be boiled down into a least common denominator set
					// Contexts are of the form `gitlens:<type>+<additional-context-1>+<additional-context-2>...`, <type> can also contain multiple `:`, but assume the whole thing is the type

					// Pre-split all contexts once to avoid repeated splitting
					const splitContexts: Array<{ baseType: string; additions: string[] }> = [];
					for (const context of contextValues) {
						const parts = context.split('+');
						splitContexts.push({ baseType: parts[0], additions: parts.slice(1) });
					}

					// Check if all contexts have the same base type
					const firstBaseType = splitContexts[0].baseType;
					const hasSameBaseType = splitContexts.every(sc => sc.baseType === firstBaseType);

					if (hasSameBaseType) {
						webviewItems = firstBaseType;

						// If any context has no additional parts, we can only use the base type
						const hasEmptyAdditions = splitContexts.some(sc => sc.additions.length === 0);

						if (!hasEmptyAdditions) {
							// Build frequency map for additional contexts in a single pass
							const additionFrequency = new Map<string, number>();
							for (const sc of splitContexts) {
								for (const add of sc.additions) {
									additionFrequency.set(add, (additionFrequency.get(add) ?? 0) + 1);
								}
							}

							// Find common additions that appear in all items (not just unique contexts)
							const commonAdditions: string[] = [];
							for (const [addition, count] of additionFrequency) {
								if (count === items.length) {
									commonAdditions.push(addition);
								}
							}

							if (commonAdditions.length > 0) {
								webviewItems += `+${commonAdditions.join('+')}`;
							}
						}
					} else {
						// If we have more than one type, something is wrong with our context key setup -- should NOT happen at runtime
						debugger;
						webviewItems = undefined;
						items = [];
					}
				}

				const count = items.length;
				contexts.set(type, {
					listDoubleSelection: count === 2,
					listMultiSelection: count > 1,
					webviewItems: webviewItems,
					webviewItemsValues: count > 1 ? items : undefined,
				});
			}

			return { contexts: contexts, selectedShas: selectedShas };
		},
		[getParsedSelectionContext],
	);

	const handleSelectGraphRows = useCallback(
		(rows: GraphRow[]) => {
			// Compute context synchronously when selection changes
			const newContext = rows.length > 1 ? computeSelectionContext(rows) : undefined;
			setSelectionContexts(newContext);

			initProps.onChangeSelection?.(rows);
		},
		[computeSelectionContext, initProps.onChangeSelection],
	);

	const handleRowContextMenu = useCallback(
		(_event: React.MouseEvent<any>, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
			if (graphZoneType === refZone) return;

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

			initProps.onRowContextMenu?.({ graphZoneType: graphZoneType, graphRow: graphRow });
		},
		[selectionContexts, context, initProps.onRowContextMenu],
	);

	const emptyConfig = useMemo(() => ({}) as unknown as NonNullable<typeof props.config>, []);
	const config = useMemo(() => props.config ?? emptyConfig, [props.config, emptyConfig]);

	const formatCommitMessage = (commitMessage: string) => {
		const { summary, body } = splitCommitMessage(commitMessage);

		return {
			summary: <GlMarkdown markdown={summary} inline></GlMarkdown>,
			body: body ? <GlMarkdown markdown={body} inline></GlMarkdown> : undefined,
		};
	};

	let footer;
	if (props.searchResults?.count === 0) {
		footer = <>No results found</>;
	} else if (props.searchResults?.count && !props.searchResults.paging?.hasMore && !props.loading) {
		footer = <>No more results found</>;
	}

	return (
		<GraphContainer
			ref={graphRef}
			avatarUrlByEmail={props.avatars}
			columnsSettings={props.columns}
			contexts={context}
			formatCommitMessage={formatCommitMessage}
			cssVariables={props.theming?.cssVariables}
			dimMergeCommits={config.dimMergeCommits}
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
			hasMoreCommits={props.paging?.hasMore}
			// Just cast the { [id: string]: number } object to { [id: string]: boolean } for performance
			highlightedShas={
				props.searchResults?.count === 0
					? { [noShaHighlightedSha]: true }
					: (props.searchResults?.ids as GraphContainerProps['highlightedShas'])
			}
			highlightRowsOnRefHover={config.highlightRowsOnRefHover}
			includeOnlyRefsById={props.includeOnlyRefs}
			scrollRowPadding={config.scrollRowPadding}
			showGhostRefsOnRowHover={config.showGhostRefsOnRowHover}
			showRemoteNamesOnRefs={config.showRemoteNamesOnRefs}
			isContainerWindowFocused={props.windowFocused}
			isLoadingRows={props.loading}
			isSelectedBySha={props.selectedRows}
			nonce={props.nonce}
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
			suppressNonRefRowTooltips
			themeOpacityFactor={props.theming?.themeOpacityFactor}
			useAuthorInitialsForAvatars={!config.avatars}
			workDirStats={props.workingTreeStats}
			customFooterRow={footer}
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

declare global {
	interface GlobalEventHandlersEventMap {
		// event map from react wrapped component
		'graph-changecolumns': CustomEvent<{ settings: GraphColumnsConfig }>;
		'graph-changegraphconfiguration': CustomEvent<UpdateGraphConfigurationParams['changes']>;
		'graph-changerefsvisibility': CustomEvent<{ refs: GraphExcludedRef[]; visible: boolean }>;
		'graph-changeselection': CustomEvent<GraphRow[]>;
		'graph-doubleclickref': CustomEvent<{ ref: GraphRef; metadata?: GraphRefMetadataItem }>;
		'graph-doubleclickrow': CustomEvent<{ row: GraphRow; preserveFocus?: boolean }>;
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
		'graph-rowcontextmenu': CustomEvent<{ graphZoneType: GraphZoneType; graphRow: GraphRow }>;
		'graph-graphmouseleave': CustomEvent<void>;
	}
}
