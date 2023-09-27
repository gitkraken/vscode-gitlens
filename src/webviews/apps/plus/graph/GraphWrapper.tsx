import type {
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
import { VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup } from '@vscode/webview-ui-toolkit/react';
import type { FormEvent, ReactElement } from 'react';
import React, { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import type { DateStyle } from '../../../../config';
import type { SearchQuery } from '../../../../git/search';
import type {
	DidEnsureRowParams,
	DidSearchParams,
	GraphAvatars,
	GraphColumnName,
	GraphColumnsConfig,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMinimapMarkerTypes,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	GraphRepository,
	GraphSearchResults,
	GraphSearchResultsError,
	InternalNotificationType,
	State,
	UpdateGraphConfigurationParams,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeRowsStatsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWindowFocusNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidFetchNotificationType,
	DidSearchNotificationType,
} from '../../../../plus/webviews/graph/protocol';
import type { Subscription } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import { createWebviewCommandLink } from '../../../../system/webview';
import type { IpcNotificationType } from '../../../protocol';
import { MenuDivider, MenuItem, MenuLabel, MenuList } from '../../shared/components/menu/react';
import { PopMenu } from '../../shared/components/overlays/pop-menu/react';
import { PopOver } from '../../shared/components/overlays/react';
import { FeatureGate } from '../../shared/components/react/feature-gate';
import { FeatureGateBadge } from '../../shared/components/react/feature-gate-badge';
import { SearchBox } from '../../shared/components/search/react';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-box';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';
import type {
	GraphMinimapDaySelectedEventDetail,
	GraphMinimapMarker,
	GraphMinimapSearchResultMarker,
	GraphMinimapStats,
	GraphMinimap as GraphMinimapType,
	StashMarker,
} from './minimap/minimap';
import { GraphMinimap } from './minimap/react';

export interface GraphWrapperProps {
	nonce?: string;
	state: State;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onChooseRepository?: () => void;
	onColumnsChange?: (colsSettings: GraphColumnsConfig) => void;
	onDimMergeCommits?: (dim: boolean) => void;
	onDoubleClickRef?: (ref: GraphRef, metadata?: GraphRefMetadataItem) => void;
	onDoubleClickRow?: (row: GraphRow, preserveFocus?: boolean) => void;
	onMissingAvatars?: (emails: Record<string, string>) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onRefsVisibilityChange?: (refs: GraphExcludedRef[], visible: boolean) => void;
	onSearch?: (search: SearchQuery | undefined, options?: { limit?: number }) => void;
	onSearchPromise?: (
		search: SearchQuery,
		options?: { limit?: number; more?: boolean },
	) => Promise<DidSearchParams | undefined>;
	onSearchOpenInView?: (search: SearchQuery) => void;
	onSelectionChange?: (rows: GraphRow[]) => void;
	onEnsureRowPromise?: (id: string, select: boolean) => Promise<DidEnsureRowParams | undefined>;
	onExcludeType?: (key: keyof GraphExcludeTypes, value: boolean) => void;
	onIncludeOnlyRef?: (all: boolean) => void;
	onUpdateGraphConfiguration?: (changes: UpdateGraphConfigurationParams['changes']) => void;
}

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number, source?: CommitDateTimeSources) =>
		formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat, source);
};

const createIconElements = (): Record<string, ReactElement> => {
	const iconList = [
		'head',
		'remote',
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

const getIconElementLibrary = (iconKey: string) => {
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

// eslint-disable-next-line @typescript-eslint/naming-convention
export function GraphWrapper({
	subscriber,
	nonce,
	state,
	onChooseRepository,
	onColumnsChange,
	onDimMergeCommits,
	onDoubleClickRef,
	onDoubleClickRow,
	onEnsureRowPromise,
	onMissingAvatars,
	onMissingRefsMetadata,
	onMoreRows,
	onRefsVisibilityChange,
	onSearch,
	onSearchPromise,
	onSearchOpenInView,
	onSelectionChange,
	onExcludeType,
	onIncludeOnlyRef,
	onUpdateGraphConfiguration,
}: GraphWrapperProps) {
	const graphRef = useRef<GraphContainer>(null);

	const [rows, setRows] = useState(state.rows ?? []);
	const [rowsStats, setRowsStats] = useState(state.rowsStats);
	const [rowsStatsLoading, setRowsStatsLoading] = useState(state.rowsStatsLoading);
	const [avatars, setAvatars] = useState(state.avatars);
	const [downstreams, setDownstreams] = useState(state.downstreams ?? {});
	const [refsMetadata, setRefsMetadata] = useState(state.refsMetadata);
	const [repos, setRepos] = useState(state.repositories ?? []);
	const [repo, setRepo] = useState<GraphRepository | undefined>(
		repos.find(item => item.path === state.selectedRepository),
	);
	const [branchState, setBranchState] = useState(state.branchState);
	const [selectedRows, setSelectedRows] = useState(state.selectedRows);
	const [activeRow, setActiveRow] = useState(state.activeRow);
	const [activeDay, setActiveDay] = useState(state.activeDay);
	const [visibleDays, setVisibleDays] = useState(state.visibleDays);
	const [graphConfig, setGraphConfig] = useState(state.config);
	// const [graphDateFormatter, setGraphDateFormatter] = useState(getGraphDateFormatter(config));
	const [columns, setColumns] = useState(state.columns);
	const [excludeRefsById, setExcludeRefsById] = useState(state.excludeRefs);
	const [excludeTypes, setExcludeTypes] = useState(state.excludeTypes);
	const [includeOnlyRefsById, setIncludeOnlyRefsById] = useState(state.includeOnlyRefs);
	const [context, setContext] = useState(state.context);
	const [pagingHasMore, setPagingHasMore] = useState(state.paging?.hasMore ?? false);
	const [isLoading, setIsLoading] = useState(state.loading);
	const [styleProps, setStyleProps] = useState(state.theming);
	const [branchName, setBranchName] = useState(state.branchName);
	const [lastFetched, setLastFetched] = useState(state.lastFetched);
	const [windowFocused, setWindowFocused] = useState(state.windowFocused);
	const [allowed, setAllowed] = useState(state.allowed ?? false);
	const [subscription, setSubscription] = useState<Subscription | undefined>(state.subscription);
	// search state
	const searchEl = useRef<any>(null);
	const [searchQuery, setSearchQuery] = useState<SearchQuery | undefined>(undefined);
	const { results, resultsError } = getSearchResultModel(state);
	const [searchResults, setSearchResults] = useState(results);
	const [searchResultsError, setSearchResultsError] = useState(resultsError);
	const [searchResultsHidden, setSearchResultsHidden] = useState(false);
	const [searching, setSearching] = useState(false);

	// working tree state
	const [workingTreeStats, setWorkingTreeStats] = useState(
		state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 },
	);

	const minimap = useRef<GraphMinimapType | undefined>(undefined);

	const ensuredIds = useRef<Set<string>>(new Set());
	const ensuredSkippedIds = useRef<Set<string>>(new Set());

	function updateState(
		state: State,
		type?: IpcNotificationType<any> | InternalNotificationType,
		themingChanged?: boolean,
	) {
		if (themingChanged) {
			setStyleProps(state.theming);
		}

		switch (type) {
			case 'didChangeTheme':
				if (!themingChanged) {
					setStyleProps(state.theming);
				}
				break;
			case DidChangeAvatarsNotificationType:
				setAvatars(state.avatars);
				break;
			case DidChangeWindowFocusNotificationType:
				setWindowFocused(state.windowFocused);
				break;
			case DidChangeRefsMetadataNotificationType:
				setRefsMetadata(state.refsMetadata);
				break;
			case DidChangeColumnsNotificationType:
				setColumns(state.columns);
				setContext(state.context);
				break;
			case DidChangeRowsNotificationType:
				setRows(state.rows ?? []);
				setRowsStats(state.rowsStats);
				setRowsStatsLoading(state.rowsStatsLoading);
				setSelectedRows(state.selectedRows);
				setAvatars(state.avatars);
				setDownstreams(state.downstreams ?? {});
				setRefsMetadata(state.refsMetadata);
				setPagingHasMore(state.paging?.hasMore ?? false);
				setIsLoading(state.loading);
				break;
			case DidChangeRowsStatsNotificationType:
				setRowsStats(state.rowsStats);
				setRowsStatsLoading(state.rowsStatsLoading);
				break;
			case DidSearchNotificationType: {
				const { results, resultsError } = getSearchResultModel(state);
				setSearchResultsError(resultsError);
				setSearchResults(results);
				setSelectedRows(state.selectedRows);
				setSearching(false);
				break;
			}
			case DidChangeGraphConfigurationNotificationType:
				setGraphConfig(state.config);
				break;
			case DidChangeSelectionNotificationType:
				setSelectedRows(state.selectedRows);
				break;
			case DidChangeRefsVisibilityNotificationType:
				setExcludeRefsById(state.excludeRefs);
				setExcludeTypes(state.excludeTypes);
				setIncludeOnlyRefsById(state.includeOnlyRefs);
				break;
			case DidChangeSubscriptionNotificationType:
				setAllowed(state.allowed ?? false);
				setSubscription(state.subscription);
				break;
			case DidChangeWorkingTreeNotificationType:
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				break;
			case DidFetchNotificationType:
				setLastFetched(state.lastFetched);
				break;
			default: {
				setAllowed(state.allowed ?? false);
				if (!themingChanged) {
					setStyleProps(state.theming);
				}
				setBranchName(state.branchName);
				setLastFetched(state.lastFetched);
				setColumns(state.columns);
				setRows(state.rows ?? []);
				setRowsStats(state.rowsStats);
				setRowsStatsLoading(state.rowsStatsLoading);
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				setGraphConfig(state.config);
				setSelectedRows(state.selectedRows);
				setExcludeRefsById(state.excludeRefs);
				setExcludeTypes(state.excludeTypes);
				setIncludeOnlyRefsById(state.includeOnlyRefs);
				setContext(state.context);
				setAvatars(state.avatars ?? {});
				setDownstreams(state.downstreams ?? {});
				setBranchState(state.branchState);
				setRefsMetadata(state.refsMetadata);
				setPagingHasMore(state.paging?.hasMore ?? false);
				setRepos(state.repositories ?? []);
				setRepo(repos.find(item => item.path === state.selectedRepository));
				// setGraphDateFormatter(getGraphDateFormatter(config));
				setSubscription(state.subscription);

				const { results, resultsError } = getSearchResultModel(state);
				setSearchResultsError(resultsError);
				setSearchResults(results);

				setIsLoading(state.loading);
				break;
			}
		}
	}

	useEffect(() => subscriber?.(updateState), []);

	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Enter' || e.key === ' ') {
			const sha = getActiveRowInfo(activeRow ?? state.activeRow)?.id;
			if (sha == null) return;

			// TODO@eamodio a bit of a hack since the graph container ref isn't exposed in the types
			const graph = (graphRef.current as any)?.graphContainerRef.current;
			if (!e.composedPath().some(el => el === graph)) return;

			const row = rows.find(r => r.sha === sha);
			if (row == null) return;

			onDoubleClickRow?.(row, e.key !== 'Enter');
		}
	};

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [activeRow]);

	const minimapData = useMemo(() => {
		if (!graphConfig?.minimap) return undefined;

		const showLinesChanged = (graphConfig?.minimapDataType ?? 'commits') === 'lines';
		if (showLinesChanged && rowsStats == null) return undefined;

		// Loops through all the rows and group them by day and aggregate the row.stats
		const statsByDayMap = new Map<number, GraphMinimapStats>();
		const markersByDay = new Map<number, GraphMinimapMarker[]>();
		const enabledMinimapMarkers: GraphMinimapMarkerTypes[] = graphConfig?.minimapMarkerTypes ?? [];

		let rankedShas: {
			head: string | undefined;
			branch: string | undefined;
			remote: string | undefined;
			tag: string | undefined;
		} = {
			head: undefined,
			branch: undefined,
			remote: undefined,
			tag: undefined,
		};

		let day;
		let prevDay;

		let markers;
		let headMarkers: GraphMinimapMarker[];
		let remoteMarkers: GraphMinimapMarker[];
		let stashMarker: StashMarker | undefined;
		let tagMarkers: GraphMinimapMarker[];
		let row: GraphRow;
		let stat;
		let stats;

		// Iterate in reverse order so that we can track the HEAD upstream properly
		for (let i = rows.length - 1; i >= 0; i--) {
			row = rows[i];

			day = getDay(row.date);
			if (day !== prevDay) {
				prevDay = day;
				rankedShas = {
					head: undefined,
					branch: undefined,
					remote: undefined,
					tag: undefined,
				};
			}

			if (
				row.heads?.length &&
				(enabledMinimapMarkers.includes('head') || enabledMinimapMarkers.includes('localBranches'))
			) {
				rankedShas.branch = row.sha;

				headMarkers = [];

				// eslint-disable-next-line no-loop-func
				row.heads.forEach(h => {
					if (h.isCurrentHead) {
						rankedShas.head = row.sha;
					}

					if (
						enabledMinimapMarkers.includes('localBranches') ||
						(enabledMinimapMarkers.includes('head') && h.isCurrentHead)
					) {
						headMarkers.push({
							type: 'branch',
							name: h.name,
							current: h.isCurrentHead && enabledMinimapMarkers.includes('head'),
						});
					}
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, headMarkers);
				} else {
					markers.push(...headMarkers);
				}
			}

			if (
				row.remotes?.length &&
				(enabledMinimapMarkers.includes('upstream') ||
					enabledMinimapMarkers.includes('remoteBranches') ||
					enabledMinimapMarkers.includes('localBranches'))
			) {
				rankedShas.remote = row.sha;

				remoteMarkers = [];

				// eslint-disable-next-line no-loop-func
				row.remotes.forEach(r => {
					let current = false;
					const hasDownstream = downstreams?.[`${r.owner}/${r.name}`]?.length;
					if (r.current) {
						rankedShas.remote = row.sha;
						current = true;
					}

					if (
						enabledMinimapMarkers.includes('remoteBranches') ||
						(enabledMinimapMarkers.includes('upstream') && current) ||
						(enabledMinimapMarkers.includes('localBranches') && hasDownstream)
					) {
						remoteMarkers.push({
							type: 'remote',
							name: `${r.owner}/${r.name}`,
							current: current && enabledMinimapMarkers.includes('upstream'),
						});
					}
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, remoteMarkers);
				} else {
					markers.push(...remoteMarkers);
				}
			}

			if (row.type === 'stash-node' && enabledMinimapMarkers.includes('stashes')) {
				stashMarker = { type: 'stash', name: row.message };
				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, [stashMarker]);
				} else {
					markers.push(stashMarker);
				}
			}

			if (row.tags?.length && enabledMinimapMarkers.includes('tags')) {
				rankedShas.tag = row.sha;

				tagMarkers = row.tags.map<GraphMinimapMarker>(t => ({
					type: 'tag',
					name: t.name,
				}));

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, tagMarkers);
				} else {
					markers.push(...tagMarkers);
				}
			}

			stat = statsByDayMap.get(day);
			if (stat == null) {
				if (showLinesChanged) {
					stats = rowsStats![row.sha];
					if (stats != null) {
						stat = {
							activity: { additions: stats.additions, deletions: stats.deletions },
							commits: 1,
							files: stats.files,
							sha: row.sha,
						};
						statsByDayMap.set(day, stat);
					}
				} else {
					stat = {
						commits: 1,
						sha: row.sha,
					};
					statsByDayMap.set(day, stat);
				}
			} else {
				stat.commits++;
				stat.sha = rankedShas.head ?? rankedShas.branch ?? rankedShas.remote ?? rankedShas.tag ?? stat.sha;
				if (showLinesChanged) {
					stats = rowsStats![row.sha];
					if (stats != null) {
						if (stat.activity == null) {
							stat.activity = { additions: stats.additions, deletions: stats.deletions };
						} else {
							stat.activity.additions += stats.additions;
							stat.activity.deletions += stats.deletions;
						}
						stat.files = (stat.files ?? 0) + stats.files;
					}
				}
			}
		}

		return { stats: statsByDayMap, markers: markersByDay };
	}, [
		rows,
		rowsStats,
		downstreams,
		graphConfig?.minimap,
		graphConfig?.minimapDataType,
		graphConfig?.minimapMarkerTypes,
	]);

	const minimapSearchResults = useMemo(() => {
		if (!graphConfig?.minimap || !graphConfig.minimapMarkerTypes?.includes('highlights')) {
			return undefined;
		}

		const searchResultsByDay = new Map<number, GraphMinimapSearchResultMarker>();

		if (searchResults?.ids != null) {
			let day;
			let sha;
			let r;
			let result;
			for ([sha, r] of Object.entries(searchResults.ids)) {
				day = getDay(r.date);

				result = searchResultsByDay.get(day);
				if (result == null) {
					searchResultsByDay.set(day, { type: 'search-result', sha: sha });
				}
			}
		}

		return searchResultsByDay;
	}, [searchResults, graphConfig?.minimap, graphConfig?.minimapMarkerTypes]);

	const handleOnMinimapDaySelected = (e: CustomEvent<GraphMinimapDaySelectedEventDetail>) => {
		let { sha } = e.detail;
		if (sha == null) {
			const date = e.detail.date?.getTime();
			if (date == null) return;

			// Find closest row to the date
			const closest = rows.reduce((prev, curr) =>
				Math.abs(curr.date - date) < Math.abs(prev.date - date) ? curr : prev,
			);
			sha = closest.sha;
		}

		graphRef.current?.selectCommits([sha], false, true);
	};

	const handleOnMinimapToggle = (_e: React.MouseEvent) => {
		onUpdateGraphConfiguration?.({ minimap: !graphConfig?.minimap });
	};

	// This can only be applied to one radio button for now due to a bug in the component: https://github.com/microsoft/fast/issues/6381
	const handleOnMinimapDataTypeChange = (e: Event | FormEvent<HTMLElement>) => {
		if (graphConfig == null) return;

		const $el = e.target as HTMLInputElement;
		if ($el.value === 'commits') {
			const minimapDataType = $el.checked ? 'commits' : 'lines';
			if (graphConfig.minimapDataType === minimapDataType) return;

			setGraphConfig({ ...graphConfig, minimapDataType: minimapDataType });
			onUpdateGraphConfiguration?.({ minimapDataType: minimapDataType });
		}
	};

	const handleOnMinimapAdditionalTypesChange = (e: Event | FormEvent<HTMLElement>) => {
		if (graphConfig?.minimapMarkerTypes == null) return;

		const $el = e.target as HTMLInputElement;
		const value = $el.value as GraphMinimapMarkerTypes;

		if ($el.checked) {
			if (!graphConfig.minimapMarkerTypes.includes(value)) {
				const minimapMarkerTypes = [...graphConfig.minimapMarkerTypes, value];
				setGraphConfig({ ...graphConfig, minimapMarkerTypes: minimapMarkerTypes });
				onUpdateGraphConfiguration?.({ minimapMarkerTypes: minimapMarkerTypes });
			}
		} else {
			const index = graphConfig.minimapMarkerTypes.indexOf(value);
			if (index !== -1) {
				const minimapMarkerTypes = [...graphConfig.minimapMarkerTypes];
				minimapMarkerTypes.splice(index, 1);
				setGraphConfig({ ...graphConfig, minimapMarkerTypes: minimapMarkerTypes });
				onUpdateGraphConfiguration?.({ minimapMarkerTypes: minimapMarkerTypes });
			}
		}
	};

	const handleOnGraphMouseLeave = (_event: any) => {
		minimap.current?.unselect(undefined, true);
	};

	const handleOnGraphRowHovered = (_event: any, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
		if (graphZoneType === refZone || minimap.current == null) return;

		minimap.current?.select(graphRow.date, true);
	};

	useEffect(() => {
		if (searchResultsError != null || searchResults == null || searchResults.count === 0 || searchQuery == null) {
			return;
		}

		searchEl.current?.logSearch(searchQuery);
	}, [searchResults]);

	const searchPosition: number = useMemo(() => {
		if (searchResults?.ids == null || !searchQuery?.query) return 0;

		const id = getActiveRowInfo(activeRow)?.id;
		let searchIndex = id ? searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			[searchIndex] = getClosestSearchResultIndex(searchResults, searchQuery, activeRow);
		}
		return searchIndex < 1 ? 1 : searchIndex + 1;
	}, [activeRow, searchResults]);

	const isAllBranches = useMemo(() => {
		if (includeOnlyRefsById == null) {
			return true;
		}
		return Object.keys(includeOnlyRefsById).length === 0;
	}, [includeOnlyRefsById]);

	const hasFilters = useMemo(() => {
		if (!isAllBranches) return true;
		if (excludeTypes == null) return false;
		return Object.values(excludeTypes).includes(true);
	}, [excludeTypes, isAllBranches, graphConfig?.dimMergeCommits]);

	const hasSpecialFilters = useMemo(() => {
		return !isAllBranches;
	}, [isAllBranches]);

	const handleSearchInput = (e: CustomEvent<SearchQuery>) => {
		const detail = e.detail;
		setSearchQuery(detail);

		const isValid = detail.query.length >= 3;
		setSearchResults(undefined);
		setSearchResultsError(undefined);
		setSearchResultsHidden(false);
		setSearching(isValid);
		onSearch?.(isValid ? detail : undefined);
	};

	const handleSearchOpenInView = () => {
		if (searchQuery == null) return;

		onSearchOpenInView?.(searchQuery);
	};

	const ensureSearchResultRow = async (id: string): Promise<string | undefined> => {
		if (onEnsureRowPromise == null) return id;
		if (ensuredIds.current.has(id)) return id;
		if (ensuredSkippedIds.current.has(id)) return undefined;

		let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
			timeout = undefined;
			setIsLoading(true);
		}, 500);

		const e = await onEnsureRowPromise(id, false);
		if (timeout == null) {
			setIsLoading(false);
		} else {
			clearTimeout(timeout);
		}

		if (e?.id === id) {
			ensuredIds.current.add(id);
			return id;
		}

		if (e != null) {
			ensuredSkippedIds.current.add(id);
		}
		return undefined;
	};

	const handleSearchNavigation = async (e: CustomEvent<SearchNavigationEventDetail>) => {
		if (searchResults == null) return;

		const direction = e.detail?.direction ?? 'next';

		let results = searchResults;
		let count = results.count;

		let searchIndex;
		let id: string | undefined;

		let next;
		if (direction === 'first') {
			next = false;
			searchIndex = 0;
		} else if (direction === 'last') {
			next = false;
			searchIndex = -1;
		} else {
			next = direction === 'next';
			[searchIndex, id] = getClosestSearchResultIndex(results, searchQuery, activeRow, next);
		}

		let iterations = 0;
		// Avoid infinite loops
		while (iterations < 1000) {
			iterations++;

			// Indicates a boundary and we need to load more results
			if (searchIndex == -1) {
				if (next) {
					if (searchQuery != null && results?.paging?.hasMore) {
						setSearching(true);
						let moreResults;
						try {
							moreResults = await onSearchPromise?.(searchQuery, { more: true });
						} finally {
							setSearching(false);
						}
						if (moreResults?.results != null && !('error' in moreResults.results)) {
							if (count < moreResults.results.count) {
								results = moreResults.results;
								searchIndex = count;
								count = results.count;
							} else {
								searchIndex = 0;
							}
						} else {
							searchIndex = 0;
						}
					} else {
						searchIndex = 0;
					}
				} else if (direction === 'last' && searchQuery != null && results?.paging?.hasMore) {
					setSearching(true);
					let moreResults;
					try {
						moreResults = await onSearchPromise?.(searchQuery, { limit: 0, more: true });
					} finally {
						setSearching(false);
					}
					if (moreResults?.results != null && !('error' in moreResults.results)) {
						if (count < moreResults.results.count) {
							results = moreResults.results;
							count = results.count;
						}
						searchIndex = count;
					}
				} else {
					searchIndex = count - 1;
				}
			}

			id = id ?? getSearchResultIdByIndex(results, searchIndex);
			if (id != null) {
				id = await ensureSearchResultRow(id);
				if (id != null) break;
			}

			setSearchResultsHidden(true);

			searchIndex = getNextOrPreviousSearchResultIndex(searchIndex, next, results, searchQuery);
		}

		if (id != null) {
			queueMicrotask(() => graphRef.current?.selectCommits([id!], false, true));
		}
	};

	const handleChooseRepository = () => {
		onChooseRepository?.();
	};

	const handleExcludeTypeChange = (e: Event | FormEvent<HTMLElement>) => {
		const $el = e.target as HTMLInputElement;

		const value = $el.value;
		const isLocalBranches = ['branch-all', 'branch-current'].includes(value);
		if (!isLocalBranches && !['remotes', 'stashes', 'tags', 'mergeCommits'].includes(value)) return;
		const isChecked = $el.checked;
		if (value === 'mergeCommits') {
			onDimMergeCommits?.(isChecked);
			return;
		}

		const key = value as keyof GraphExcludeTypes;
		const currentFilter = excludeTypes?.[key];
		if ((currentFilter == null && isChecked) || (currentFilter != null && currentFilter !== isChecked)) {
			setExcludeTypes({
				...excludeTypes,
				[key]: isChecked,
			});
			onExcludeType?.(key, isChecked);
		}
	};

	// This can only be applied to one radio button for now due to a bug in the component: https://github.com/microsoft/fast/issues/6381
	const handleLocalBranchFiltering = (e: Event | FormEvent<HTMLElement>) => {
		const $el = e.target as HTMLInputElement;
		const value = $el.value;
		const isChecked = $el.checked;
		const wantsAllBranches = value === 'branch-all' && isChecked;
		if (isAllBranches === wantsAllBranches) {
			return;
		}
		onIncludeOnlyRef?.(wantsAllBranches);
	};

	const handleMissingAvatars = (emails: GraphAvatars) => {
		onMissingAvatars?.(emails);
	};

	const handleMissingRefsMetadata = (metadata: GraphMissingRefsMetadata) => {
		onMissingRefsMetadata?.(metadata);
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
		setIsLoading(true);
		onMoreRows?.();
	};

	const handleOnColumnResized = (columnName: GraphColumnName, columnSettings: GraphColumnSetting) => {
		if (columnSettings.width) {
			onColumnsChange?.({
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
		setVisibleDays({
			top: new Date(top.date).setHours(23, 59, 59, 999),
			bottom: new Date(bottom.date).setHours(0, 0, 0, 0),
		});
	};

	const handleOnGraphColumnsReOrdered = (columnsSettings: GraphColumnsSettings) => {
		const graphColumnsConfig: GraphColumnsConfig = {};
		for (const [columnName, config] of Object.entries(columnsSettings as GraphColumnsConfig)) {
			graphColumnsConfig[columnName] = { ...config };
		}
		onColumnsChange?.(graphColumnsConfig);
	};

	const handleOnToggleRefsVisibilityClick = (_event: any, refs: GraphRefOptData[], visible: boolean) => {
		onRefsVisibilityChange?.(refs, visible);
	};

	const handleOnDoubleClickRef = (
		_event: React.MouseEvent<HTMLButtonElement>,
		refGroup: GraphRefGroup,
		_row: GraphRow,
		metadata?: GraphRefMetadataItem,
	) => {
		if (refGroup.length > 0) {
			onDoubleClickRef?.(refGroup[0], metadata);
		}
	};

	const handleOnDoubleClickRow = (
		_event: React.MouseEvent<HTMLButtonElement>,
		graphZoneType: GraphZoneType,
		row: GraphRow,
	) => {
		if (graphZoneType === refZone) return;

		onDoubleClickRow?.(row, true);
	};

	const handleSelectGraphRows = (rows: GraphRow[]) => {
		const active = rows[0];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		// HACK: Ensure the main state is updated since it doesn't come from the extension
		state.activeRow = activeKey;
		setActiveRow(activeKey);
		setActiveDay(active?.date);

		onSelectionChange?.(rows);
	};

	const renderFetchAction = () => {
		const lastFetchedDate = lastFetched && new Date(lastFetched);
		const fetchedText = lastFetchedDate && lastFetchedDate.getTime() !== 0 ? fromNow(lastFetchedDate) : undefined;

		let action: 'fetch' | 'pull' | 'push' = 'fetch';

		let icon = 'sync';
		let label = 'Fetch';
		let isBehind = false;
		let isAhead = false;

		let tooltip = '';
		let fetchTooltip = 'Fetch from';
		let remote = 'remote';
		if (branchState) {
			isBehind = branchState.behind > 0;
			isAhead = branchState.ahead > 0;
			const branchPrefix = `Branch ${branchName} is`;
			remote = `${branchState.upstream}${branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}`;
			if (isBehind) {
				action = 'pull';
				icon = 'arrow-down';
				label = 'Pull';
				tooltip = `Pull from ${remote}\n${branchPrefix} ${pluralize('commit', branchState.behind)} behind of`;
			} else if (isAhead) {
				action = 'push';
				icon = 'arrow-up';
				label = 'Push';
				tooltip = `Push to ${remote}\n${branchPrefix} ${pluralize('commit', branchState.ahead)} ahead of`;
			}
			tooltip += ` ${remote}`;
			fetchTooltip += ` ${remote}`;
		}

		if (fetchedText != null) {
			const lastFetchedText = `\nLast fetched ${fetchedText}`;
			tooltip += lastFetchedText;
			fetchTooltip += lastFetchedText;
		}

		return (
			<div className="titlebar__group">
				{(isBehind || isAhead) && (
					<a
						href={createWebviewCommandLink(`gitlens.graph.${action}`, state.webviewId)}
						className={`action-button${isBehind ? ' is-behind' : ''}${isAhead ? ' is-ahead' : ''}`}
						title={tooltip}
					>
						<span className={`codicon codicon-${icon} action-button__icon`}></span>
						{label}
						{(isAhead || isBehind) && (
							<span>
								<span className="pill action-button__pill">
									{isAhead && (
										<span>
											{branchState!.ahead} <span className="codicon codicon-arrow-up"></span>
										</span>
									)}
									{isBehind && (
										<span>
											{branchState!.behind} <span className="codicon codicon-arrow-down"></span>
										</span>
									)}
								</span>
							</span>
						)}
					</a>
				)}
				<a
					href={createWebviewCommandLink('gitlens.graph.fetch', state.webviewId)}
					className="action-button"
					title={fetchTooltip}
				>
					<span className="codicon codicon-sync action-button__icon"></span>
					Fetch
					{fetchedText && <span className="action-button__small">({fetchedText})</span>}
				</a>
			</div>
		);
	};

	return (
		<>
			<header className="titlebar graph-app__header">
				<div
					className={`titlebar__row titlebar__row--wrap${
						!allowed ? ' disallowed' : repo && branchState?.provider?.url ? '' : ' no-remote-provider'
					}`}
				>
					{repo && branchState?.provider?.url && (
						<a
							href={branchState.provider.url}
							className="action-button"
							style={{ marginRight: '-0.5rem' }}
							title={`Open Repository on ${branchState.provider.name}`}
							aria-label={`Open Repository on ${branchState.provider.name}`}
						>
							<span
								className={
									branchState.provider.icon === 'cloud'
										? 'codicon codicon-cloud action-button__icon'
										: `glicon glicon-provider-${branchState.provider.icon} action-button__icon`
								}
								aria-hidden="true"
							></span>
						</a>
					)}
					<button
						type="button"
						className="action-button"
						slot="trigger"
						title="Switch to Another Repository..."
						aria-label="Switch to Another Repository..."
						disabled={repos.length < 2}
						onClick={() => handleChooseRepository()}
					>
						{repo?.formattedName ?? 'none selected'}
						{repos.length > 1 && (
							<span
								className="codicon codicon-chevron-down action-button__more"
								aria-hidden="true"
							></span>
						)}
					</button>
					{allowed && repo && (
						<>
							<span>
								<span className="codicon codicon-chevron-right"></span>
							</span>
							<a
								href={createWebviewCommandLink('gitlens.graph.switchToAnotherBranch', state.webviewId)}
								className="action-button"
								title="Switch to Another Branch..."
								aria-label="Switch to Another Branch..."
							>
								{branchName}
								<span
									className="codicon codicon-chevron-down action-button__more"
									aria-hidden="true"
								></span>
							</a>
							<span>
								<span className="codicon codicon-chevron-right"></span>
							</span>
							{renderFetchAction()}
						</>
					)}
					<FeatureGateBadge subscription={subscription}></FeatureGateBadge>
					<div className="popover">
						<a href="command:gitlens.showFocusPage" className="action-button popover__trigger">
							Try the Focus Preview
						</a>
						<PopOver placement="top end" className="popover__content">
							Bring all of your GitHub pull requests and issues into a unified actionable to help to you
							more easily juggle work in progress, pending work, reviews, and more
						</PopOver>
					</div>
				</div>
				{allowed && (
					<div className="titlebar__row">
						<div className="titlebar__group">
							<PopMenu>
								<button type="button" className="action-button" slot="trigger" title="Filter Graph">
									<span className={`codicon codicon-filter${hasFilters ? '-filled' : ''}`}></span>
									{hasSpecialFilters && <span className="action-button__indicator"></span>}
									<span
										className="codicon codicon-chevron-down action-button__more"
										aria-hidden="true"
									></span>
								</button>
								<MenuList slot="content">
									<MenuLabel>Filter options</MenuLabel>
									<MenuItem role="none">
										<VSCodeRadioGroup
											orientation="vertical"
											value={
												isAllBranches && repo?.isVirtual !== true
													? 'branch-all'
													: 'branch-current'
											}
											readOnly={repo?.isVirtual === true}
										>
											{repo?.isVirtual !== true && (
												<VSCodeRadio
													name="branching-toggle"
													value="branch-all"
													onChange={handleLocalBranchFiltering}
												>
													Show All Branches
												</VSCodeRadio>
											)}
											<VSCodeRadio name="branching-toggle" value="branch-current">
												Show Current Branch Only
											</VSCodeRadio>
										</VSCodeRadioGroup>
									</MenuItem>
									<MenuDivider></MenuDivider>
									{repo?.isVirtual !== true && (
										<>
											<MenuItem role="none">
												<VSCodeCheckbox
													value="remotes"
													onChange={handleExcludeTypeChange}
													defaultChecked={excludeTypes?.remotes ?? false}
												>
													Hide Remote-only Branches
												</VSCodeCheckbox>
											</MenuItem>
											<MenuItem role="none">
												<VSCodeCheckbox
													value="stashes"
													onChange={handleExcludeTypeChange}
													defaultChecked={excludeTypes?.stashes ?? false}
												>
													Hide Stashes
												</VSCodeCheckbox>
											</MenuItem>
										</>
									)}
									<MenuItem role="none">
										<VSCodeCheckbox
											value="tags"
											onChange={handleExcludeTypeChange}
											defaultChecked={excludeTypes?.tags ?? false}
										>
											Hide Tags
										</VSCodeCheckbox>
									</MenuItem>
									<MenuDivider></MenuDivider>
									<MenuItem role="none">
										<VSCodeCheckbox
											value="mergeCommits"
											onChange={handleExcludeTypeChange}
											defaultChecked={graphConfig?.dimMergeCommits ?? false}
										>
											Dim Merge Commit Rows
										</VSCodeCheckbox>
									</MenuItem>
								</MenuList>
							</PopMenu>
							<span>
								<span className="action-divider"></span>
							</span>
							<SearchBox
								ref={searchEl}
								label="Search Commits"
								step={searchPosition}
								total={searchResults?.count ?? 0}
								valid={Boolean(searchQuery?.query && searchQuery.query.length > 2)}
								more={searchResults?.paging?.hasMore ?? false}
								searching={searching}
								value={searchQuery?.query ?? ''}
								errorMessage={searchResultsError?.error ?? ''}
								resultsHidden={searchResultsHidden}
								resultsLoaded={searchResults != null}
								onChange={e => handleSearchInput(e as CustomEvent<SearchQuery>)}
								onNavigate={e => handleSearchNavigation(e as CustomEvent<SearchNavigationEventDetail>)}
								onOpenInView={() => handleSearchOpenInView()}
							/>
							<span>
								<span className="action-divider"></span>
							</span>
							<span className="button-group">
								<button
									type="button"
									role="checkbox"
									className="action-button"
									title="Toggle Minimap"
									aria-label="Toggle Minimap"
									aria-checked={graphConfig?.minimap ?? false}
									onClick={handleOnMinimapToggle}
								>
									<span className="codicon codicon-graph-line action-button__icon"></span>
								</button>
								<PopMenu position="right">
									<button
										type="button"
										className="action-button"
										slot="trigger"
										title="Minimap Options"
									>
										<span
											className="codicon codicon-chevron-down action-button__more"
											aria-hidden="true"
										></span>
									</button>
									<MenuList slot="content">
										<MenuLabel>Chart</MenuLabel>
										<MenuItem role="none">
											<VSCodeRadioGroup
												orientation="vertical"
												value={graphConfig?.minimapDataType ?? 'commits'}
											>
												<VSCodeRadio
													name="minimap-datatype"
													value="commits"
													onChange={handleOnMinimapDataTypeChange}
												>
													Commits
												</VSCodeRadio>
												<VSCodeRadio name="minimap-datatype" value="lines">
													Lines Changed
												</VSCodeRadio>
											</VSCodeRadioGroup>
										</MenuItem>
										<MenuDivider></MenuDivider>
										<MenuLabel>Markers</MenuLabel>
										<MenuItem role="none">
											<VSCodeCheckbox
												value="localBranches"
												onChange={handleOnMinimapAdditionalTypesChange}
												defaultChecked={
													graphConfig?.minimapMarkerTypes?.includes('localBranches') ?? false
												}
											>
												<span
													className="minimap-marker-swatch"
													data-marker="localBranches"
												></span>
												Local Branches
											</VSCodeCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<VSCodeCheckbox
												value="remoteBranches"
												onChange={handleOnMinimapAdditionalTypesChange}
												defaultChecked={
													graphConfig?.minimapMarkerTypes?.includes('remoteBranches') ?? true
												}
											>
												<span
													className="minimap-marker-swatch"
													data-marker="remoteBranches"
												></span>
												Remote Branches
											</VSCodeCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<VSCodeCheckbox
												value="stashes"
												onChange={handleOnMinimapAdditionalTypesChange}
												defaultChecked={
													graphConfig?.minimapMarkerTypes?.includes('stashes') ?? false
												}
											>
												<span className="minimap-marker-swatch" data-marker="stashes"></span>
												Stashes
											</VSCodeCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<VSCodeCheckbox
												value="tags"
												onChange={handleOnMinimapAdditionalTypesChange}
												defaultChecked={
													graphConfig?.minimapMarkerTypes?.includes('tags') ?? true
												}
											>
												<span className="minimap-marker-swatch" data-marker="tags"></span>
												Tags
											</VSCodeCheckbox>
										</MenuItem>
									</MenuList>
								</PopMenu>
							</span>
						</div>
					</div>
				)}
				<div
					className={`progress-container infinite${isLoading || rowsStatsLoading ? ' active' : ''}`}
					role="progressbar"
				>
					<div className="progress-bar"></div>
				</div>
			</header>
			<FeatureGate className="graph-app__gate" appearance="alert" state={subscription?.state} visible={!allowed}>
				<p slot="feature">
					Helps you easily visualize your repository and keep track of all work in progress.
					<br />
					<br />
					Use the rich commit search to find exactly what you're looking for. It's powerful filters allow you
					to search by a specific commit, message, author, a changed file or files, or even a specific code
					change.
				</p>
			</FeatureGate>
			{graphConfig?.minimap && (
				<GraphMinimap
					ref={minimap as any}
					activeDay={activeDay}
					data={minimapData?.stats}
					dataType={graphConfig?.minimapDataType ?? 'commits'}
					markers={minimapData?.markers}
					searchResults={minimapSearchResults}
					visibleDays={visibleDays}
					onSelected={e => handleOnMinimapDaySelected(e as CustomEvent<GraphMinimapDaySelectedEventDetail>)}
				></GraphMinimap>
			)}
			<main id="main" className="graph-app__main" aria-hidden={!allowed}>
				{repo !== undefined ? (
					<>
						<GraphContainer
							ref={graphRef}
							avatarUrlByEmail={avatars}
							columnsSettings={columns}
							contexts={context}
							cssVariables={styleProps?.cssVariables}
							dimMergeCommits={graphConfig?.dimMergeCommits}
							downstreamsByUpstream={downstreams}
							enabledRefMetadataTypes={graphConfig?.enabledRefMetadataTypes}
							enabledScrollMarkerTypes={graphConfig?.scrollMarkerTypes}
							enableShowHideRefsOptions
							enableMultiSelection={graphConfig?.enableMultiSelection}
							excludeRefsById={excludeRefsById}
							excludeByType={excludeTypes}
							formatCommitDateTime={getGraphDateFormatter(graphConfig)}
							getExternalIcon={getIconElementLibrary}
							graphRows={rows}
							hasMoreCommits={pagingHasMore}
							// Just cast the { [id: string]: number } object to { [id: string]: boolean } for performance
							highlightedShas={searchResults?.ids as GraphContainerProps['highlightedShas']}
							highlightRowsOnRefHover={graphConfig?.highlightRowsOnRefHover}
							includeOnlyRefsById={includeOnlyRefsById}
							scrollRowPadding={graphConfig?.scrollRowPadding}
							showGhostRefsOnRowHover={graphConfig?.showGhostRefsOnRowHover}
							showRemoteNamesOnRefs={graphConfig?.showRemoteNamesOnRefs}
							isContainerWindowFocused={windowFocused}
							isLoadingRows={isLoading}
							isSelectedBySha={selectedRows}
							nonce={nonce}
							onColumnResized={handleOnColumnResized}
							onDoubleClickGraphRow={handleOnDoubleClickRow}
							onDoubleClickGraphRef={handleOnDoubleClickRef}
							onGraphColumnsReOrdered={handleOnGraphColumnsReOrdered}
							onGraphMouseLeave={minimap.current ? handleOnGraphMouseLeave : undefined}
							onGraphRowHovered={minimap.current ? handleOnGraphRowHovered : undefined}
							onSettingsClick={handleToggleColumnSettings}
							onSelectGraphRows={handleSelectGraphRows}
							onToggleRefsVisibilityClick={handleOnToggleRefsVisibilityClick}
							onEmailsMissingAvatarUrls={handleMissingAvatars}
							onRefsMissingMetadata={handleMissingRefsMetadata}
							onShowMoreCommits={handleMoreCommits}
							onGraphVisibleRowsChanged={minimap.current ? handleOnGraphVisibleRowsChanged : undefined}
							platform={clientPlatform}
							refMetadataById={refsMetadata}
							rowsStats={rowsStats}
							rowsStatsLoading={rowsStatsLoading}
							shaLength={graphConfig?.idLength}
							themeOpacityFactor={styleProps?.themeOpacityFactor}
							useAuthorInitialsForAvatars={!graphConfig?.avatars}
							workDirStats={workingTreeStats}
						/>
					</>
				) : (
					<p>No repository is selected</p>
				)}
			</main>
		</>
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

function getClosestSearchResultIndex(
	results: GraphSearchResults,
	query: SearchQuery | undefined,
	activeRow: string | undefined,
	next: boolean = true,
): [number, string | undefined] {
	if (results.ids == null) return [0, undefined];

	const activeInfo = getActiveRowInfo(activeRow);
	const activeId = activeInfo?.id;
	if (activeId == null) return [0, undefined];

	let index: number | undefined;
	let nearestId: string | undefined;
	let nearestIndex: number | undefined;

	const data = results.ids[activeId];
	if (data != null) {
		index = data.i;
		nearestId = activeId;
		nearestIndex = index;
	}

	if (index == null) {
		const activeDate = activeInfo?.date != null ? activeInfo.date + (next ? 1 : -1) : undefined;
		if (activeDate == null) return [0, undefined];

		// Loop through the search results and:
		//  try to find the active id
		//  if next=true find the nearest date before the active date
		//  if next=false find the nearest date after the active date

		let i: number;
		let id: string;
		let date: number;
		let nearestDate: number | undefined;
		for ([id, { date, i }] of Object.entries(results.ids)) {
			if (next) {
				if (date < activeDate && (nearestDate == null || date > nearestDate)) {
					nearestId = id;
					nearestDate = date;
					nearestIndex = i;
				}
			} else if (date > activeDate && (nearestDate == null || date <= nearestDate)) {
				nearestId = id;
				nearestDate = date;
				nearestIndex = i;
			}
		}

		index = nearestIndex == null ? results.count - 1 : nearestIndex + (next ? -1 : 1);
	}

	index = getNextOrPreviousSearchResultIndex(index, next, results, query);

	return index === nearestIndex ? [index, nearestId] : [index, undefined];
}

function getNextOrPreviousSearchResultIndex(
	index: number,
	next: boolean,
	results: GraphSearchResults,
	query: SearchQuery | undefined,
) {
	if (next) {
		if (index < results.count - 1) {
			index++;
		} else if (query != null && results?.paging?.hasMore) {
			index = -1; // Indicates a boundary that we should load more results
		} else {
			index = 0;
		}
	} else if (index > 0) {
		index--;
	} else if (query != null && results?.paging?.hasMore) {
		index = -1; // Indicates a boundary that we should load more results
	} else {
		index = results.count - 1;
	}
	return index;
}

function getSearchResultIdByIndex(results: GraphSearchResults, index: number): string | undefined {
	// Loop through the search results without using Object.entries or Object.keys and return the id at the specified index
	const { ids } = results;
	for (const id in ids) {
		if (ids[id].i === index) return id;
	}
	return undefined;

	// return Object.entries(results.ids).find(([, { i }]) => i === index)?.[0];
}

function getActiveRowInfo(activeRow: string | undefined): { id: string; date: number } | undefined {
	if (activeRow == null) return undefined;

	const [id, date] = activeRow.split('|');
	return {
		id: id,
		date: Number(date),
	};
}

function getSearchResultModel(state: State): {
	results: GraphSearchResults | undefined;
	resultsError: GraphSearchResultsError | undefined;
} {
	let results: GraphSearchResults | undefined;
	let resultsError: GraphSearchResultsError | undefined;
	if (state.searchResults != null) {
		if ('error' in state.searchResults) {
			resultsError = state.searchResults;
		} else {
			results = state.searchResults;
		}
	}
	return { results: results, resultsError: resultsError };
}

function getDay(date: number | Date): number {
	return new Date(date).setHours(0, 0, 0, 0);
}
