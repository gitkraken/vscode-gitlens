import type {
	CommitType,
	ExcludeRefsById,
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
import GraphContainer, { CommitDateTimeSources, refZone } from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import { getPlatform } from '@env/platform';
import type { DateStyle } from '../../../../../config';
import type { DateTimeFormat } from '../../../../../system/date';
import { formatDate, fromNow } from '../../../../../system/date';
import { filterMap, first, groupByFilterMap, join } from '../../../../../system/iterable';
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
import type { GraphAppState } from '../stateProvider';

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
	Pick<GraphAppState, 'activeRow' | 'theming' | 'searchResults' | 'filter'>;

export interface GraphWrapperEvents {
	onGraphMouseLeave?: () => void;
	onChangeColumns?: (colsSettings: GraphColumnsConfig) => void;
	onChangeRefsVisibility?: (args: { refs: GraphExcludedRef[]; visible: boolean }) => void;
	onChangeSelection?: (rows: GraphRow[]) => void;
	onDoubleClickRef?: (args: { ref: GraphRef; metadata?: GraphRefMetadataItem }) => void;
	onDoubleClickRow?: (args: { row: GraphRow; preserveFocus?: boolean }) => void;
	onMissingAvatars?: (emails: Record<string, string>) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onChangeVisibleDays?: (args: any) => void;
	onGraphRowHovered?: (args: {
		clientX: number;
		currentTarget: HTMLElement;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}) => void;
	onGraphRowUnhovered?: (args: {
		relatedTarget: EventTarget | null;
		graphZoneType: GraphZoneType;
		graphRow: GraphRow;
	}) => void;
	onRowContextMenu?: (args: { graphZoneType: GraphZoneType; graphRow: GraphRow }) => void;
}

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number, source?: CommitDateTimeSources) =>
		formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat, source);
};

const createIconElements = () => {
	const iconList = [
		'head',
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
		'issue-gitlab',
		'issue-jiraCloud',
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

const getIconElementLibrary: GetExternalIcon = (iconKey: string) => {
	return iconElementLibrary[iconKey];
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

export type GraphWrapperSubscriberProps = GraphWrapperProps & GraphWrapperAPI;
export type GraphWrapperInitProps = GraphWrapperProps &
	GraphWrapperEvents &
	GraphWrapperAPI & {
		subscriber?: (updater: (props: Partial<GraphWrapperSubscriberProps>) => void) => void;
	};

const emptyRows: GraphRow[] = [];
// eslint-disable-next-line @typescript-eslint/naming-convention
export function GraphWrapperReact(initProps: GraphWrapperInitProps) {
	const [graph, _graphRef] = useState<GraphContainer | null>(null);
	const [context, setContext] = useState(initProps.context);
	const [props, setProps] = useState(initProps);
	const [selectionContexts, setSelectionContexts] = useState<SelectionContexts | undefined>();

	// Register the state updater function with the subscriber if provided
	useEffect(() => {
		if (props.subscriber) {
			props.subscriber(newProps => {
				// Update state based on new props
				// if (newProps.context !== context) {
				// 	setContext(newProps.context);
				// }
				setProps({ ...props, ...newProps });
				// Other state updates can be added here as needed
			});
		}
	}, [props.subscriber]);

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

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			const sha = getActiveRowInfo(props.activeRow)?.id;
			if (sha == null) return;

			// TODO@eamodio a bit of a hack since the graph container ref isn't exposed in the types
			const _graph = (graph as any)?.graphContainerRef.current;
			if (!e.composedPath().some(el => el === _graph)) return;

			const row = props.rows?.find(r => r.sha === sha);
			if (row == null) return;

			initProps.onDoubleClickRow?.({ row: row, preserveFocus: e.key !== 'Enter' });
		}
	};

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [props.activeRow]);

	const stopColumnResize = () => {
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
	};

	const handleOnGraphMouseLeave = (_event: React.MouseEvent<any>) => {
		initProps.onGraphMouseLeave?.();
		stopColumnResize();
	};

	const handleMissingAvatars = (emails: GraphAvatars) => {
		initProps.onMissingAvatars?.(emails);
	};

	const handleMissingRefsMetadata = (metadata: GraphMissingRefsMetadata) => {
		initProps.onMissingRefsMetadata?.(metadata);
	};

	const handleToggleColumnSettings = (event: React.MouseEvent<HTMLButtonElement>) => {
		const e = event.nativeEvent;
		const evt = new MouseEvent('contextmenu', {
			bubbles: true,
			clientX: e.clientX,
			clientY: e.clientY,
		});
		e.target?.dispatchEvent(evt);
		e.stopImmediatePropagation();
	};

	const handleMoreCommits = () => {
		initProps.onMoreRows?.();
	};

	const handleOnColumnResized = (columnName: GraphColumnName, columnSettings: GraphColumnSetting) => {
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
	};

	const handleOnGraphVisibleRowsChanged = (top: GraphRow, bottom: GraphRow) => {
		initProps.onChangeVisibleDays?.({
			top: new Date(top.date).setHours(23, 59, 59, 999),
			bottom: new Date(bottom.date).setHours(0, 0, 0, 0),
		});
	};

	const handleOnGraphColumnsReOrdered = (columnsSettings: GraphColumnsSettings) => {
		const graphColumnsConfig: GraphColumnsConfig = {};
		for (const [columnName, config] of Object.entries(columnsSettings as GraphColumnsConfig)) {
			graphColumnsConfig[columnName] = { ...config };
		}
		initProps.onChangeColumns?.(graphColumnsConfig);
	};

	// dirty trick to avoid mutations on the GraphContainer side
	const fixedExcludeRefsById = useMemo(
		(): ExcludeRefsById | undefined => (props.excludeRefs ? { ...props.excludeRefs } : undefined),
		[props.excludeRefs],
	);
	const handleOnToggleRefsVisibilityClick = (_event: any, refs: GraphRefOptData[], visible: boolean) => {
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
					iterations: !Object.keys(fixedExcludeRefsById ?? {}).length ? 2 : 1,
				},
			);
		}
		initProps.onChangeRefsVisibility?.({ refs: refs, visible: visible });
	};

	const handleOnDoubleClickRef = (
		_event: React.MouseEvent<HTMLButtonElement>,
		refGroup: GraphRefGroup,
		_row: GraphRow,
		metadata?: GraphRefMetadataItem,
	) => {
		if (refGroup.length > 0) {
			initProps.onDoubleClickRef?.({ ref: refGroup[0], metadata: metadata });
		}
	};

	const handleOnDoubleClickRow = (
		_event: React.MouseEvent<HTMLButtonElement>,
		graphZoneType: GraphZoneType,
		row: GraphRow,
	) => {
		if (graphZoneType === refZone) return;

		initProps.onDoubleClickRow?.({ row: row, preserveFocus: true });
	};

	const computeSelectionContext = (_active: GraphRow, rows: GraphRow[]) => {
		if (rows.length <= 1) {
			setSelectionContexts(undefined);
			return;
		}

		const selectedShas = new Set<string>();
		for (const row of rows) {
			selectedShas.add(row.sha);
		}

		// Group the selected rows by their type and only include ones that have row context
		const grouped = groupByFilterMap(
			rows,
			r => r.type,
			r =>
				r.contexts?.row != null
					? ((typeof r.contexts.row === 'string'
							? JSON.parse(r.contexts.row)
							: r.contexts.row) as GraphItemContext)
					: undefined,
		);

		const contexts: SelectionContexts['contexts'] = new Map<CommitType, SelectionContext>();

		for (let [type, items] of grouped) {
			let webviewItems: string | undefined;

			const contextValues = new Set<string>();
			for (const item of items) {
				contextValues.add(item.webviewItem);
			}

			if (contextValues.size === 1) {
				webviewItems = first(contextValues);
			} else if (contextValues.size > 1) {
				// If there are multiple contexts, see if they can be boiled down into a least common denominator set
				// Contexts are of the form `gitlens:<type>+<additional-context-1>+<additional-context-2>...`, <type> can also contain multiple `:`, but assume the whole thing is the type

				const itemTypes = new Map<string, Map<string, number>>();

				for (const context of contextValues) {
					const [type, ...adds] = context.split('+');

					let additionalContext = itemTypes.get(type);
					if (additionalContext == null) {
						additionalContext ??= new Map<string, number>();
						itemTypes.set(type, additionalContext);
					}

					// If any item has no additional context, then only the type is able to be used
					if (adds.length === 0) {
						additionalContext.clear();
						break;
					}

					for (const add of adds) {
						additionalContext.set(add, (additionalContext.get(add) ?? 0) + 1);
					}
				}

				if (itemTypes.size === 1) {
					let additionalContext;
					[webviewItems, additionalContext] = first(itemTypes)!;

					if (additionalContext.size > 0) {
						const commonContexts = join(
							filterMap(additionalContext, ([context, count]) =>
								count === items.length ? context : undefined,
							),
							'+',
						);

						if (commonContexts) {
							webviewItems += `+${commonContexts}`;
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

		setSelectionContexts({ contexts: contexts, selectedShas: selectedShas });
	};

	const handleSelectGraphRows = (rows: GraphRow[]) => {
		const active = rows[rows.length - 1];
		computeSelectionContext(active, rows);

		initProps.onChangeSelection?.(rows);
	};

	const handleRowContextMenu = (_event: React.MouseEvent<any>, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
		if (graphZoneType === refZone) return;
		// initProps.onRowContextMenu?.({ graphZoneType: graphZoneType, graphRow: graphRow });
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
	};

	return (
		<GraphContainer
			ref={graphRef}
			avatarUrlByEmail={props.avatars}
			columnsSettings={props.columns}
			contexts={context}
			// @ts-expect-error returnType of formatCommitMessage callback expects to be string, but it works fine with react element
			formatCommitMessage={e => <GlMarkdown markdown={e}></GlMarkdown>}
			cssVariables={props.theming?.cssVariables}
			dimMergeCommits={props.config?.dimMergeCommits}
			downstreamsByUpstream={props.downstreams}
			enabledRefMetadataTypes={props.config?.enabledRefMetadataTypes}
			enabledScrollMarkerTypes={props.config?.scrollMarkerTypes}
			enableShowHideRefsOptions
			enableMultiSelection={props.config?.enableMultiSelection}
			excludeRefsById={props.excludeRefs}
			excludeByType={props.excludeTypes}
			formatCommitDateTime={getGraphDateFormatter(props.config)}
			getExternalIcon={getIconElementLibrary}
			graphRows={props.rows ?? emptyRows}
			hasMoreCommits={props.paging?.hasMore}
			// Just cast the { [id: string]: number } object to { [id: string]: boolean } for performance
			highlightedShas={props.searchResults?.ids as GraphContainerProps['highlightedShas']}
			highlightRowsOnRefHover={props.config?.highlightRowsOnRefHover}
			includeOnlyRefsById={props.includeOnlyRefs}
			scrollRowPadding={props.config?.scrollRowPadding}
			showGhostRefsOnRowHover={props.config?.showGhostRefsOnRowHover}
			showRemoteNamesOnRefs={props.config?.showRemoteNamesOnRefs}
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
				initProps.onGraphRowHovered?.({
					clientX: e.clientX,
					currentTarget: e.currentTarget,
					graphRow: graphRow,
					graphZoneType: graphZoneType,
				})
			}
			onGraphRowUnhovered={(e, graphZoneType, graphRow) =>
				initProps.onGraphRowUnhovered?.({
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
			searchMode={props.filter?.filter ? 'filter' : 'normal'}
			shaLength={props.config?.idLength}
			shiftSelectMode="simple"
			suppressNonRefRowTooltips
			themeOpacityFactor={props.theming?.themeOpacityFactor}
			useAuthorInitialsForAvatars={!props.config?.avatars}
			workDirStats={props.workingTreeStats}
		/>
	);
}

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
		'graph-rowcontextmenu': CustomEvent<void>;
		'graph-graphmouseleave': CustomEvent<void>;
	}
}
