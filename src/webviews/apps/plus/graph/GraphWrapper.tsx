import type {
	GraphColumnSetting,
	GraphColumnsSettings,
	GraphContainerProps,
	GraphPlatform,
	GraphRef,
	GraphRefGroup,
	GraphRefOptData,
	GraphRow,
	GraphZoneType,
	Head,
	OnFormatCommitDateTime,
} from '@gitkraken/gitkraken-components';
import GraphContainer, { GRAPH_ZONE_TYPE, REF_ZONE_TYPE } from '@gitkraken/gitkraken-components';
import { VSCodeCheckbox, VSCodeRadio, VSCodeRadioGroup } from '@vscode/webview-ui-toolkit/react';
import type { FormEvent, ReactElement } from 'react';
import React, { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import { DateStyle } from '../../../../config';
import { RepositoryVisibility } from '../../../../git/gitProvider';
import type { SearchQuery } from '../../../../git/search';
import type {
	DidEnsureRowParams,
	DidSearchParams,
	DismissBannerParams,
	GraphAvatars,
	GraphColumnName,
	GraphColumnsConfig,
	GraphCommitDateTimeSource,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphMissingRefsMetadata,
	GraphRepository,
	GraphSearchResults,
	GraphSearchResultsError,
	InternalNotificationType,
	State,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import {
	DidChangeAvatarsNotificationType,
	DidChangeColumnsNotificationType,
	DidChangeGraphConfigurationNotificationType,
	DidChangeRefsMetadataNotificationType,
	DidChangeRefsVisibilityNotificationType,
	DidChangeRowsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWindowFocusNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidFetchNotificationType,
	DidSearchNotificationType,
	GraphCommitDateTimeSources,
} from '../../../../plus/webviews/graph/protocol';
import type { Subscription } from '../../../../subscription';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import type { IpcNotificationType } from '../../../protocol';
import { MenuDivider, MenuItem, MenuLabel, MenuList } from '../../shared/components/menu/react';
import { PopMenu } from '../../shared/components/overlays/pop-menu/react';
import { PopOver } from '../../shared/components/overlays/react';
import { SearchBox } from '../../shared/components/search/react';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-box';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';
import type {
	ActivityGraph as ActivityGraphType,
	ActivityMarker,
	ActivitySearchResultMarker,
	ActivityStats,
	ActivityStatsSelectedEventDetail,
} from '../activity/activity-graph';
import { ActivityGraph } from '../activity/react';

export interface GraphWrapperProps {
	nonce?: string;
	state: State;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onChooseRepository?: () => void;
	onColumnsChange?: (colsSettings: GraphColumnsConfig) => void;
	onDimMergeCommits?: (dim: boolean) => void;
	onDoubleClickRef?: (ref: GraphRef) => void;
	onDoubleClickRow?: (row: GraphRow, preserveFocus?: boolean) => void;
	onMissingAvatars?: (emails: { [email: string]: string }) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onRefsVisibilityChange?: (refs: GraphExcludedRef[], visible: boolean) => void;
	onSearch?: (search: SearchQuery | undefined, options?: { limit?: number }) => void;
	onSearchPromise?: (
		search: SearchQuery,
		options?: { limit?: number; more?: boolean },
	) => Promise<DidSearchParams | undefined>;
	onSearchOpenInView?: (search: SearchQuery) => void;
	onDismissBanner?: (key: DismissBannerParams['key']) => void;
	onSelectionChange?: (rows: GraphRow[]) => void;
	onEnsureRowPromise?: (id: string, select: boolean) => Promise<DidEnsureRowParams | undefined>;
	onExcludeType?: (key: keyof GraphExcludeTypes, value: boolean) => void;
	onIncludeOnlyRef?: (all: boolean) => void;
}

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number, source?: GraphCommitDateTimeSource) =>
		formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat, source);
};

const createIconElements = (): { [key: string]: ReactElement<any> } => {
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
	];

	const miniIconList = ['upstream-ahead', 'upstream-behind'];

	const elementLibrary: { [key: string]: ReactElement<any> } = {};
	iconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `graph-icon icon--${iconKey}` });
	});
	miniIconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `graph-icon mini-icon icon--${iconKey}` });
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
	onDismissBanner,
	onExcludeType,
	onIncludeOnlyRef,
}: GraphWrapperProps) {
	const graphRef = useRef<GraphContainer>(null);

	const [rows, setRows] = useState(state.rows ?? []);
	const [avatars, setAvatars] = useState(state.avatars);
	const [refsMetadata, setRefsMetadata] = useState(state.refsMetadata);
	const [repos, setRepos] = useState(state.repositories ?? []);
	const [repo, setRepo] = useState<GraphRepository | undefined>(
		repos.find(item => item.path === state.selectedRepository),
	);
	const [selectedRows, setSelectedRows] = useState(state.selectedRows);
	const [activeRow, setActiveRow] = useState(state.activeRow);
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
	// account
	const [showAccount, setShowAccount] = useState(state.trialBanner);
	const [isAccessAllowed, setIsAccessAllowed] = useState(state.allowed ?? false);
	const [isRepoPrivate, setIsRepoPrivate] = useState(
		state.selectedRepositoryVisibility === RepositoryVisibility.Private,
	);
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

	const activityGraph = useRef<ActivityGraphType | undefined>(undefined);

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
				setSelectedRows(state.selectedRows);
				setAvatars(state.avatars);
				setRefsMetadata(state.refsMetadata);
				setPagingHasMore(state.paging?.hasMore ?? false);
				setIsLoading(state.loading);
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
				setIsAccessAllowed(state.allowed ?? false);
				setSubscription(state.subscription);
				break;
			case DidChangeWorkingTreeNotificationType:
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				break;
			case DidFetchNotificationType:
				setLastFetched(state.lastFetched);
				break;
			default: {
				setIsAccessAllowed(state.allowed ?? false);
				if (!themingChanged) {
					setStyleProps(state.theming);
				}
				setBranchName(state.branchName);
				setLastFetched(state.lastFetched);
				setColumns(state.columns);
				setRows(state.rows ?? []);
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				setGraphConfig(state.config);
				setSelectedRows(state.selectedRows);
				setExcludeRefsById(state.excludeRefs);
				setExcludeTypes(state.excludeTypes);
				setIncludeOnlyRefsById(state.includeOnlyRefs);
				setContext(state.context);
				setAvatars(state.avatars ?? {});
				setRefsMetadata(state.refsMetadata);
				setPagingHasMore(state.paging?.hasMore ?? false);
				setRepos(state.repositories ?? []);
				setRepo(repos.find(item => item.path === state.selectedRepository));
				setIsRepoPrivate(state.selectedRepositoryVisibility === RepositoryVisibility.Private);
				// setGraphDateFormatter(getGraphDateFormatter(config));
				setSubscription(state.subscription);
				setShowAccount(state.trialBanner ?? true);

				const { results, resultsError } = getSearchResultModel(state);
				setSearchResultsError(resultsError);
				setSearchResults(results);

				setIsLoading(state.loading);
				break;
			}
		}
	}

	useEffect(() => subscriber?.(updateState), []);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown);

		return () => {
			window.removeEventListener('keydown', handleKeyDown);
		};
	}, [activeRow]);

	const activityData = useMemo(() => {
		if (!graphConfig?.activityMinibar) return;

		// Loops through all the rows and group them by day and aggregate the row.stats
		const statsByDayMap = new Map<number, ActivityStats>();
		const markersByDay = new Map<number, ActivityMarker[]>();

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

		let head: Head | undefined;
		let markers;
		let headMarkers;
		let remoteMarkers;
		let tagMarkers;
		let row: GraphRow;
		let stat;
		let stats;

		// Iterate in reverse order so that we can track the HEAD upstream properly
		for (let i = rows.length - 1; i >= 0; i--) {
			row = rows[i];
			stats = row.stats;

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

			if (row.heads?.length) {
				rankedShas.branch = row.sha;

				// eslint-disable-next-line no-loop-func
				headMarkers = row.heads.map<ActivityMarker>(h => {
					if (h.isCurrentHead) {
						head = h;
						rankedShas.head = row.sha;
					}

					return {
						type: 'branch',
						name: h.name,
						current: h.isCurrentHead,
					};
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, headMarkers);
				} else {
					markers.push(...headMarkers);
				}
			}

			if (row.remotes?.length) {
				rankedShas.remote = row.sha;

				// eslint-disable-next-line no-loop-func
				remoteMarkers = row.remotes.map<ActivityMarker>(r => {
					let current = false;
					if (r.name === head?.name) {
						rankedShas.remote = row.sha;
						current = true;
					}

					return {
						type: 'remote',
						name: `${r.owner}/${r.name}`,
						current: current,
					};
				});

				markers = markersByDay.get(day);
				if (markers == null) {
					markersByDay.set(day, remoteMarkers);
				} else {
					markers.push(...remoteMarkers);
				}
			}

			if (row.tags?.length) {
				rankedShas.tag = row.sha;

				tagMarkers = row.tags.map<ActivityMarker>(t => ({
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
				stat =
					stats != null
						? {
								activity: { additions: stats.additions, deletions: stats.deletions },
								commits: 1,
								files: stats.files,
								sha: row.sha,
						  }
						: {
								commits: 1,
								sha: row.sha,
						  };
				statsByDayMap.set(day, stat);
			} else {
				stat.commits++;
				stat.sha = rankedShas.head ?? rankedShas.branch ?? rankedShas.remote ?? rankedShas.tag ?? stat.sha;
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

		return { stats: statsByDayMap, markers: markersByDay };
	}, [rows, graphConfig]);

	const activitySearchResults = useMemo(() => {
		if (!graphConfig?.activityMinibar) return;

		const searchResultsByDay = new Map<number, ActivitySearchResultMarker>();

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
	}, [searchResults, graphConfig]);

	const activitySelectedDay = useMemo(() => {
		if (!graphConfig?.activityMinibar) return;

		const date = getActiveRowInfo(activeRow)?.date;
		return date != null ? getDay(date) : undefined;
	}, [activeRow, graphConfig]);

	const handleActivityStatsSelected = (e: CustomEvent<ActivityStatsSelectedEventDetail>) => {
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

	const handleOnGraphRowHovered = (_event: any, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
		if (graphZoneType === REF_ZONE_TYPE || activityGraph.current == null) return;

		activityGraph.current.highlightedDay = getDay(graphRow.date);
		// queueMicrotask(() => void activityGraph.current?.select(graphRow.date));
	};

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
		if (!isAllBranches) {
			return true;
		}

		if (graphConfig?.dimMergeCommits) {
			return true;
		}

		if (excludeTypes == null) {
			return false;
		}

		return Object.values(excludeTypes).includes(true);
	}, [excludeTypes, isAllBranches, graphConfig?.dimMergeCommits]);

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

	const handleToggleColumnSettings = (event: React.MouseEvent<HTMLButtonElement, globalThis.MouseEvent>) => {
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
					order: columnSettings.order,
				},
			});
		}
	};

	const handleOnGraphVisibleRowsChanged = (top: GraphRow, bottom: GraphRow) => {
		if (activityGraph.current == null) return;

		activityGraph.current.visibleDays = {
			top: new Date(top.date).setHours(23, 59, 59, 999),
			bottom: new Date(bottom.date).setHours(0, 0, 0, 0),
		};
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
		_event: React.MouseEvent<HTMLButtonElement, globalThis.MouseEvent>,
		refGroup: GraphRefGroup,
		_row: GraphRow,
	) => {
		if (refGroup.length > 0) {
			onDoubleClickRef?.(refGroup[0]);
		}
	};

	const handleOnDoubleClickRow = (
		_event: React.MouseEvent<HTMLButtonElement, globalThis.MouseEvent>,
		graphZoneType: GraphZoneType,
		row: GraphRow,
	) => {
		if (graphZoneType === REF_ZONE_TYPE || graphZoneType === GRAPH_ZONE_TYPE) return;

		onDoubleClickRow?.(row, true);
	};

	const handleSelectGraphRows = (rows: GraphRow[]) => {
		const active = rows[0];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		// HACK: Ensure the main state is updated since it doesn't come from the extension
		state.activeRow = activeKey;
		setActiveRow(activeKey);

		// if (active != null) {
		// 	queueMicrotask(() => activityGraph.current?.select(active.date));
		// }
		onSelectionChange?.(rows);
	};

	const handleDismissAccount = () => {
		setShowAccount(false);
		onDismissBanner?.('trial');
	};

	const renderAccountState = () => {
		if (!subscription) return;

		let label = subscription.plan.effective.name;
		let isPro = true;
		let subText;
		switch (subscription.state) {
			case SubscriptionState.Free:
			case SubscriptionState.FreePreviewTrialExpired:
			case SubscriptionState.FreePlusTrialExpired:
				isPro = false;
				label = 'GitLens Free';
				break;
			case SubscriptionState.FreeInPreviewTrial:
			case SubscriptionState.FreePlusInTrial: {
				const days = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
				label = 'GitLens Pro (Trial)';
				subText = `${days < 1 ? '<1 day' : pluralize('day', days)} left`;
				break;
			}
			case SubscriptionState.VerificationRequired:
				isPro = false;
				label = `${label} (Unverified)`;
				break;
		}

		return (
			<span className="badge-container mr-loose">
				<span className="badge is-help">
					<span className={`repo-access${isPro ? ' is-pro' : ''}`}>✨</span> {label}
					{subText && (
						<>
							&nbsp;&nbsp;
							<small>{subText}</small>
						</>
					)}
				</span>
				<PopOver placement="top end" className="badge-popover">
					{isPro
						? 'You have access to all GitLens and GitLens+ features on any repo.'
						: 'You have access to GitLens+ features on local & public repos, and all other GitLens features on any repo.'}
					<br />
					<br />✨ indicates GitLens+ features
				</PopOver>
			</span>
		);
	};

	const renderAlertContent = () => {
		if (subscription == null || !isRepoPrivate || (isAccessAllowed && !showAccount)) return;

		let icon = 'account';
		let modifier = '';
		let content;
		let actions;
		let days = 0;
		if ([SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(subscription.state)) {
			days = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
		}

		switch (subscription.state) {
			case SubscriptionState.Free:
			case SubscriptionState.Paid:
				return;
			case SubscriptionState.FreeInPreviewTrial:
				icon = 'calendar';
				modifier = 'neutral';
				content = (
					<>
						<p className="alert__title">GitLens Pro Trial</p>
						<p className="alert__message">
							You have {days < 1 ? 'less than one day' : pluralize('day', days)} left in your 3-day
							GitLens Pro trial. Don't worry if you need more time, you can extend your trial for an
							additional free 7-days of the Commit Graph and other{' '}
							<a href="command:gitlens.plus.learn">GitLens+ features</a> on private repos.
						</p>
					</>
				);
				break;
			case SubscriptionState.FreePlusInTrial:
				icon = 'calendar';
				modifier = 'neutral';
				content = (
					<>
						<p className="alert__title">GitLens Pro Trial</p>
						<p className="alert__message">
							You have {days < 1 ? 'less than one day' : pluralize('day', days)} left in your GitLens Pro
							trial. Once your trial ends, you'll continue to have access to the Commit Graph and other{' '}
							<a href="command:gitlens.plus.learn">GitLens+ features</a> on local and public repos, while
							upgrading to GitLens Pro gives you access on private repos.
						</p>
					</>
				);
				break;
			case SubscriptionState.FreePreviewTrialExpired:
				icon = 'warning';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">Extend Your GitLens Pro Trial</p>
						<p className="alert__message">
							Your free 3-day GitLens Pro trial has ended, extend your trial to get an additional free
							7-days of the Commit Graph and other{' '}
							<a href="command:gitlens.plus.learn">GitLens+ features</a> on private repos.
						</p>
					</>
				);
				actions = (
					<a className="alert-action" href="command:gitlens.plus.loginOrSignUp">
						Extend Pro Trial
					</a>
				);
				break;
			case SubscriptionState.FreePlusTrialExpired:
				icon = 'warning';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">GitLens Pro Trial Expired</p>
						<p className="alert__message">
							Your GitLens Pro trial has ended, please upgrade to GitLens Pro to continue to use the
							Commit Graph and other <a href="command:gitlens.plus.learn">GitLens+ features</a> on private
							repos.
						</p>
					</>
				);
				actions = (
					<a className="alert-action" href="command:gitlens.plus.purchase">
						Upgrade to Pro
					</a>
				);
				break;
			case SubscriptionState.VerificationRequired:
				icon = 'unverified';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">Please verify your email</p>
						<p className="alert__message">
							Before you can use <a href="command:gitlens.plus.learn">GitLens+ features</a> on private
							repos, please verify your email address.
						</p>
					</>
				);
				actions = (
					<>
						<a className="alert-action" href="command:gitlens.plus.resendVerification">
							Resend Verification Email
						</a>
						<a className="alert-action" href="command:gitlens.plus.validate">
							Refresh Verification Status
						</a>
					</>
				);
				break;
		}

		return (
			<section className="graph-app__banners">
				<div className={`alert${modifier !== '' ? ` alert--${modifier}` : ''}`}>
					<span className={`alert__icon codicon codicon-${icon}`}></span>
					<div className="alert__content">
						{content}
						{actions && <div className="alert__actions">{actions}</div>}
					</div>
					{isAccessAllowed && (
						<button className="alert__dismiss" type="button" onClick={() => handleDismissAccount()}>
							<span className="codicon codicon-chrome-close"></span>
						</button>
					)}
				</div>
			</section>
		);
	};

	return (
		<>
			{renderAlertContent()}
			<header className="titlebar graph-app__header">
				<div className="titlebar__row titlebar__row--wrap">
					<div className="titlebar__group titlebar__group--fixed">
						<button
							type="button"
							className="action-button"
							slot="trigger"
							title="Switch to Another Repository..."
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
						{repo && (
							<>
								<span>
									<span className="codicon codicon-chevron-right"></span>
								</span>
								<a
									href="command:gitlens.graph.switchToAnotherBranch"
									className="action-button"
									title="Switch to Another Branch..."
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
								<a
									href="command:gitlens.graph.fetch"
									className="action-button"
									title="Fetch Repository"
								>
									<span className="codicon codicon-sync action-button__icon"></span> Fetch{' '}
									{lastFetched && <small>(Last fetched {fromNow(new Date(lastFetched))})</small>}
								</a>
							</>
						)}
					</div>
					<div className="titlebar__group titlebar__group--fixed">
						{state.debugging && (
							<span className="titlebar__group titlebar__debugging">
								{isLoading && <span className="icon--loading icon-modifier--spin" />}
								{rows.length > 0 && (
									<span>
										showing {rows.length} item{rows.length ? 's' : ''}
									</span>
								)}
							</span>
						)}
						{renderAccountState()}
						<a
							href="https://github.com/gitkraken/vscode-gitlens/discussions/2158"
							title="Commit Graph Feedback"
							aria-label="Commit Graph Feedback"
							className="action-button"
						>
							<span className="codicon codicon-feedback"></span>
						</a>
					</div>
				</div>
				{isAccessAllowed && (
					<div className="titlebar__row">
						<div className="titlebar__group">
							<PopMenu>
								<button type="button" className="action-button" slot="trigger" title="Filter Graph">
									<span className={`codicon codicon-filter${hasFilters ? '-filled' : ''}`}></span>
									{hasFilters && <span className="action-button__indicator"></span>}
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
													Show All Local Branches
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
													Hide Remote Branches
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
						</div>
					</div>
				)}
				<div className={`progress-container infinite${isLoading ? ' active' : ''}`} role="progressbar">
					<div className="progress-bar"></div>
				</div>
				{graphConfig?.activityMinibar && (
					<ActivityGraph
						ref={activityGraph as any}
						data={activityData?.stats}
						markers={activityData?.markers}
						searchResults={activitySearchResults}
						selectedDay={activitySelectedDay}
						onSelected={e =>
							handleActivityStatsSelected(e as CustomEvent<ActivityStatsSelectedEventDetail>)
						}
					></ActivityGraph>
				)}
			</header>
			<main
				id="main"
				className={`graph-app__main${!isAccessAllowed ? ' is-gated' : ''}`}
				aria-hidden={!isAccessAllowed}
			>
				{!isAccessAllowed && <div className="graph-app__cover"></div>}
				{repo !== undefined ? (
					<>
						<GraphContainer
							ref={graphRef}
							avatarUrlByEmail={avatars}
							columnsSettings={columns}
							contexts={context}
							cssVariables={styleProps?.cssVariables}
							dimMergeCommits={graphConfig?.dimMergeCommits}
							enabledRefMetadataTypes={graphConfig?.enabledRefMetadataTypes}
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
							onGraphRowHovered={activityGraph.current ? handleOnGraphRowHovered : undefined}
							onSelectGraphRows={handleSelectGraphRows}
							onToggleRefsVisibilityClick={handleOnToggleRefsVisibilityClick}
							onEmailsMissingAvatarUrls={handleMissingAvatars}
							onRefsMissingMetadata={handleMissingRefsMetadata}
							onShowMoreCommits={handleMoreCommits}
							onGraphVisibleRowsChanged={
								activityGraph.current ? handleOnGraphVisibleRowsChanged : undefined
							}
							platform={clientPlatform}
							refMetadataById={refsMetadata}
							shaLength={graphConfig?.idLength}
							themeOpacityFactor={styleProps?.themeOpacityFactor}
							useAuthorInitialsForAvatars={!graphConfig?.avatars}
							workDirStats={workingTreeStats}
						/>
					</>
				) : (
					<p>No repository is selected</p>
				)}
				<button
					className="column-button"
					type="button"
					role="button"
					data-vscode-context={context?.header || JSON.stringify({ webviewItem: 'gitlens:graph:columns' })}
					onClick={handleToggleColumnSettings}
				>
					<span
						className="codicon codicon-settings-gear columnsettings__icon"
						aria-label="Column Settings"
					></span>
				</button>
			</main>
		</>
	);
}

function formatCommitDateTime(
	commitDateTime: number,
	style: DateStyle = DateStyle.Absolute,
	format: DateTimeFormat | string = 'short+short',
	source?: GraphCommitDateTimeSource,
): string {
	switch (source) {
		case GraphCommitDateTimeSources.Tooltip:
			return formatDate(commitDateTime, format);
		case GraphCommitDateTimeSources.RowEntry:
		default:
			return style === DateStyle.Relative ? fromNow(commitDateTime) : formatDate(commitDateTime, format);
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
