import { getPlatform } from '@env/platform';
import type {
	CommitType,
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
import type { SlChangeEvent } from '@shoelace-style/shoelace';
import SlOption from '@shoelace-style/shoelace/dist/react/option/index.js';
import SlSelect from '@shoelace-style/shoelace/dist/react/select/index.js';
import type { FormEvent, MouseEvent, ReactElement } from 'react';
import React, { createElement, useEffect, useMemo, useRef, useState } from 'react';
import type { ConnectCloudIntegrationsCommandArgs } from '../../../../commands/cloudIntegrations';
import type { BranchGitCommandArgs } from '../../../../commands/git/branch';
import type { DateStyle, GraphBranchesVisibility } from '../../../../config';
import { GlCommand } from '../../../../constants.commands';
import type { SearchQuery } from '../../../../constants.search';
import type { Subscription } from '../../../../plus/gk/account/subscription';
import { isSubscriptionPaid } from '../../../../plus/gk/account/subscription';
import type { LaunchpadCommandArgs } from '../../../../plus/launchpad/launchpad';
import { createCommandLink } from '../../../../system/commands';
import { filterMap, first, groupByFilterMap, join } from '../../../../system/iterable';
import { createWebviewCommandLink } from '../../../../system/webview';
import type {
	DidEnsureRowParams,
	DidGetRowHoverParams,
	DidSearchParams,
	GraphAvatars,
	GraphColumnName,
	GraphColumnsConfig,
	GraphComponentConfig,
	GraphExcludedRef,
	GraphExcludeTypes,
	GraphItemContext,
	GraphMinimapMarkerTypes,
	GraphMissingRefsMetadata,
	GraphRefMetadataItem,
	GraphRepository,
	GraphSearchMode,
	GraphSearchResults,
	GraphSearchResultsError,
	InternalNotificationType,
	State,
	UpdateGraphConfigurationParams,
	UpdateStateCallback,
} from '../../../plus/graph/protocol';
import {
	DidChangeAvatarsNotification,
	DidChangeBranchStateNotification,
	DidChangeColumnsNotification,
	DidChangeGraphConfigurationNotification,
	DidChangeRefsMetadataNotification,
	DidChangeRefsVisibilityNotification,
	DidChangeRepoConnectionNotification,
	DidChangeRowsNotification,
	DidChangeRowsStatsNotification,
	DidChangeSelectionNotification,
	DidChangeSubscriptionNotification,
	DidChangeWorkingTreeNotification,
	DidFetchNotification,
	DidSearchNotification,
	DidStartFeaturePreviewNotification,
} from '../../../plus/graph/protocol';
import type { IpcNotification } from '../../../protocol';
import { DidChangeHostWindowFocusNotification } from '../../../protocol';
import { GlButton } from '../../shared/components/button.react';
import { GlCheckbox } from '../../shared/components/checkbox';
import { CodeIcon } from '../../shared/components/code-icon.react';
import { GlIndicator } from '../../shared/components/indicators/indicator.react';
import { GlMarkdown } from '../../shared/components/markdown/markdown.react';
import { MenuDivider, MenuItem, MenuLabel } from '../../shared/components/menu/react';
import { GlPopover } from '../../shared/components/overlays/popover.react';
import { GlTooltip } from '../../shared/components/overlays/tooltip.react';
import type { RadioGroup } from '../../shared/components/radio/radio-group';
import { GlRadio, GlRadioGroup } from '../../shared/components/radio/radio.react';
import { GlFeatureBadge } from '../../shared/components/react/feature-badge';
import { GlFeatureGate } from '../../shared/components/react/feature-gate';
import { GlIssuePullRequest } from '../../shared/components/react/issue-pull-request';
import { GlSearchBox } from '../../shared/components/search/react';
import type {
	SearchModeChangeEventDetail,
	SearchNavigationEventDetail,
} from '../../shared/components/search/search-box';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';
import { emitTelemetrySentEvent } from '../../shared/telemetry';
import { GitActionsButtons } from './actions/gitActionsButtons';
import { GlGraphHover } from './hover/graphHover.react';
import type { GraphMinimapDaySelectedEventDetail } from './minimap/minimap';
import { GlGraphMinimapContainer } from './minimap/minimap-container.react';
import { GlGraphSideBar } from './sidebar/sidebar.react';

export interface GraphWrapperProps {
	nonce?: string;
	state: State;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onChangeColumns?: (colsSettings: GraphColumnsConfig) => void;
	onChangeExcludeTypes?: (key: keyof GraphExcludeTypes, value: boolean) => void;
	onChangeGraphConfiguration?: (changes: UpdateGraphConfigurationParams['changes']) => void;
	onChangeGraphSearchMode?: (searchMode: GraphSearchMode) => void;
	onChangeRefIncludes?: (branchesVisibility: GraphBranchesVisibility, refs?: GraphRefOptData[]) => void;
	onChangeRefsVisibility?: (refs: GraphExcludedRef[], visible: boolean) => void;
	onChangeSelection?: (rows: GraphRow[]) => void;
	onChooseRepository?: () => void;
	onDoubleClickRef?: (ref: GraphRef, metadata?: GraphRefMetadataItem) => void;
	onDoubleClickRow?: (row: GraphRow, preserveFocus?: boolean) => void;
	onEnsureRowPromise?: (id: string, select: boolean) => Promise<DidEnsureRowParams | undefined>;
	onHoverRowPromise?: (row: GraphRow) => Promise<DidGetRowHoverParams>;
	onJumpToRefPromise?: (alt: boolean) => Promise<{ name: string; sha: string } | undefined>;
	onMissingAvatars?: (emails: Record<string, string>) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onOpenPullRequest?: (pr: NonNullable<NonNullable<State['branchState']>['pr']>) => void;
	onSearch?: (search: SearchQuery | undefined, options?: { limit?: number }) => void;
	onSearchPromise?: (
		search: SearchQuery,
		options?: { limit?: number; more?: boolean },
	) => Promise<DidSearchParams | undefined>;
	onSearchOpenInView?: (search: SearchQuery) => void;
}

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number, source?: CommitDateTimeSources) =>
		formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat, source);
};

const createIconElements = (): Record<string, ReactElement> => {
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

// eslint-disable-next-line @typescript-eslint/naming-convention
export function GraphWrapper({
	subscriber,
	nonce,
	state,
	onChooseRepository,
	onChangeColumns,
	onChangeExcludeTypes,
	onChangeGraphConfiguration,
	onChangeGraphSearchMode,
	onChangeRefIncludes,
	onChangeRefsVisibility,
	onChangeSelection,
	onDoubleClickRef,
	onDoubleClickRow,
	onEnsureRowPromise,
	onHoverRowPromise,
	onJumpToRefPromise,
	onMissingAvatars,
	onMissingRefsMetadata,
	onMoreRows,
	onOpenPullRequest,
	onSearch,
	onSearchPromise,
	onSearchOpenInView,
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
	const [branchesVisibility, setBranchesVisibility] = useState(state.branchesVisibility);
	const [branchState, setBranchState] = useState(state.branchState);
	const [selectedRows, setSelectedRows] = useState(state.selectedRows);
	const [activeRow, setActiveRow] = useState(state.activeRow);
	const [activeDay, setActiveDay] = useState(state.activeDay);
	const [selectionContexts, setSelectionContexts] = useState<SelectionContexts | undefined>();
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
	const [branch, setBranch] = useState(state.branch);
	const [lastFetched, setLastFetched] = useState(state.lastFetched);
	const [windowFocused, setWindowFocused] = useState(state.windowFocused);
	const [allowed, setAllowed] = useState(state.allowed ?? false);
	const [subscription, setSubscription] = useState<Subscription | undefined>(state.subscription);
	const [featurePreview, setFeaturePreview] = useState(state.featurePreview);

	// search state
	const searchEl = useRef<GlSearchBox>(null);
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
	const branchName = branch?.name;

	const minimap = useRef<GlGraphMinimapContainer | undefined>(undefined);
	const hover = useRef<GlGraphHover | undefined>(undefined);

	const ensuredIds = useRef<Set<string>>(new Set());
	const ensuredSkippedIds = useRef<Set<string>>(new Set());

	function updateState(
		state: State,
		type?: IpcNotification<any> | InternalNotificationType,
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
			case DidStartFeaturePreviewNotification:
				setFeaturePreview(state.featurePreview);
				setAllowed(state.allowed ?? false);
				break;
			case DidChangeAvatarsNotification:
				setAvatars(state.avatars);
				break;
			case DidChangeBranchStateNotification:
				setBranchState(state.branchState);
				break;
			case DidChangeHostWindowFocusNotification:
				setWindowFocused(state.windowFocused);
				break;
			case DidChangeRefsMetadataNotification:
				setRefsMetadata(state.refsMetadata);
				break;
			case DidChangeColumnsNotification:
				setColumns(state.columns);
				setContext(state.context);
				break;
			case DidChangeRowsNotification:
				hover.current?.reset();
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
			case DidChangeRowsStatsNotification:
				hover.current?.reset();
				setRowsStats(state.rowsStats);
				setRowsStatsLoading(state.rowsStatsLoading);
				break;
			case DidSearchNotification: {
				const { results, resultsError } = getSearchResultModel(state);
				setSearchResultsError(resultsError);
				setSearchResults(results);
				setSelectedRows(state.selectedRows);
				setSearching(false);
				break;
			}
			case DidChangeGraphConfigurationNotification:
				setGraphConfig(state.config);
				break;
			case DidChangeSelectionNotification:
				setSelectedRows(state.selectedRows);
				break;
			case DidChangeRefsVisibilityNotification:
				setBranchesVisibility(state.branchesVisibility);
				setExcludeRefsById(state.excludeRefs);
				setExcludeTypes(state.excludeTypes);
				setIncludeOnlyRefsById(state.includeOnlyRefs);
				// Hack to force the Graph to maintain the selected rows
				if (state.selectedRows != null) {
					const shas = Object.keys(state.selectedRows);
					if (shas.length) {
						queueMicrotask(() => graphRef?.current?.selectCommits(shas, false, true));
					}
				}
				break;
			case DidChangeSubscriptionNotification:
				setAllowed(state.allowed ?? false);
				setSubscription(state.subscription);
				break;
			case DidChangeWorkingTreeNotification:
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				break;
			case DidFetchNotification:
				setLastFetched(state.lastFetched);
				break;
			case DidChangeRepoConnectionNotification:
				setRepos(state.repositories ?? []);
				setRepo(state.repositories?.find(item => item.path === state.selectedRepository));
				break;
			default: {
				hover.current?.reset();
				setAllowed(state.allowed ?? false);
				if (!themingChanged) {
					setStyleProps(state.theming);
				}
				setBranch(state.branch);
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
				setBranchesVisibility(state.branchesVisibility);
				setBranchState(state.branchState);
				setRefsMetadata(state.refsMetadata);
				setPagingHasMore(state.paging?.hasMore ?? false);
				setRepos(state.repositories ?? []);
				setRepo(repos.find(item => item.path === state.selectedRepository));
				// setGraphDateFormatter(getGraphDateFormatter(config));
				setSubscription(state.subscription);
				setFeaturePreview(state.featurePreview);

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

		queueMicrotask(
			() =>
				e.target &&
				emitTelemetrySentEvent<'graph/minimap/day/selected'>(e.target, {
					name: 'graph/minimap/day/selected',
					data: {},
				}),
		);
	};

	const handleOnMinimapToggle = (_e: React.MouseEvent) => {
		onChangeGraphConfiguration?.({ minimap: !graphConfig?.minimap });
	};

	// This can only be applied to one radio button for now due to a bug in the component: https://github.com/microsoft/fast/issues/6381
	const handleOnMinimapDataTypeChange = (e: Event | FormEvent<HTMLElement>) => {
		if (graphConfig == null) return;

		const $el = e.target as RadioGroup;
		const minimapDataType = $el.value === 'lines' ? 'lines' : 'commits';
		if (graphConfig.minimapDataType === minimapDataType) return;

		setGraphConfig({ ...graphConfig, minimapDataType: minimapDataType });
		onChangeGraphConfiguration?.({ minimapDataType: minimapDataType });
	};

	const handleOnMinimapAdditionalTypesChange = (e: Event | FormEvent<HTMLElement>) => {
		if (graphConfig?.minimapMarkerTypes == null) return;

		const $el = e.target as HTMLInputElement;
		const value = $el.value as GraphMinimapMarkerTypes;

		if ($el.checked) {
			if (!graphConfig.minimapMarkerTypes.includes(value)) {
				const minimapMarkerTypes = [...graphConfig.minimapMarkerTypes, value];
				setGraphConfig({ ...graphConfig, minimapMarkerTypes: minimapMarkerTypes });
				onChangeGraphConfiguration?.({ minimapMarkerTypes: minimapMarkerTypes });
			}
		} else {
			const index = graphConfig.minimapMarkerTypes.indexOf(value);
			if (index !== -1) {
				const minimapMarkerTypes = [...graphConfig.minimapMarkerTypes];
				minimapMarkerTypes.splice(index, 1);
				setGraphConfig({ ...graphConfig, minimapMarkerTypes: minimapMarkerTypes });
				onChangeGraphConfiguration?.({ minimapMarkerTypes: minimapMarkerTypes });
			}
		}
	};

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
		minimap.current?.unselect(undefined, true);
		stopColumnResize();
	};

	const handleOnGraphRowHovered = (
		event: React.MouseEvent<any>,
		graphZoneType: GraphZoneType,
		graphRow: GraphRow,
	) => {
		if (graphZoneType === refZone) return;

		minimap.current?.select(graphRow.date, true);

		if (onHoverRowPromise == null) return;

		const hoverComponent = hover.current;
		if (hoverComponent == null) return;

		const { clientX } = event;

		const rect = event.currentTarget.getBoundingClientRect() as DOMRect;
		const x = clientX;
		const y = rect.top;
		const height = rect.height;
		const width = 60; // Add some width, so `skidding` will be able to apply

		const anchor = {
			getBoundingClientRect: function () {
				return {
					width: width,
					height: height,
					x: x,
					y: y,
					top: y,
					left: x,
					right: x + width,
					bottom: y + height,
				};
			},
		};

		hoverComponent.requestMarkdown ??= onHoverRowPromise;
		hoverComponent.onRowHovered(graphRow, anchor);
	};

	const handleOnGraphRowUnhovered = (
		event: React.MouseEvent<any>,
		graphZoneType: GraphZoneType,
		graphRow: GraphRow,
	) => {
		if (graphZoneType === refZone) return;

		hover.current?.onRowUnhovered(graphRow, event.relatedTarget);
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

	const hasFilters = useMemo(() => {
		if (graphConfig?.onlyFollowFirstParent) return true;
		if (excludeTypes == null) return false;

		return Object.values(excludeTypes).includes(true);
	}, [excludeTypes, graphConfig?.onlyFollowFirstParent]);

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

	const handleSearchModeChange = (e: CustomEvent<SearchModeChangeEventDetail>) => {
		const { searchMode } = e.detail;
		onChangeGraphSearchMode?.(searchMode);
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
			if (searchIndex === -1) {
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
			queueMicrotask(() => graphRef.current?.selectCommits([id], false, true));
		}
	};

	const handleChooseRepository = () => {
		onChooseRepository?.();
	};

	const handleJumpToRef = async (e: MouseEvent) => {
		const ref = await onJumpToRefPromise?.(e.altKey);
		if (ref != null) {
			const sha = await ensureSearchResultRow(ref.sha);
			if (sha == null) return;

			queueMicrotask(() => graphRef.current?.selectCommits([sha], false, true));
		}
	};

	const handleFilterChange = (e: Event | FormEvent<HTMLElement>) => {
		const $el = e.target as HTMLInputElement;
		if ($el == null) return;

		const { checked } = $el;

		switch ($el.value) {
			case 'mergeCommits':
				onChangeGraphConfiguration?.({ dimMergeCommits: checked });
				break;

			case 'onlyFollowFirstParent':
				onChangeGraphConfiguration?.({ onlyFollowFirstParent: checked });
				break;

			case 'remotes':
			case 'stashes':
			case 'tags': {
				const key = $el.value satisfies keyof GraphExcludeTypes;
				const currentFilter = excludeTypes?.[key];
				if ((currentFilter == null && checked) || (currentFilter != null && currentFilter !== checked)) {
					setExcludeTypes({ ...excludeTypes, [key]: checked });
					onChangeExcludeTypes?.(key, checked);
				}
				break;
			}
		}
	};

	const handleBranchesVisibility = (e: SlChangeEvent): void => {
		const $el = e.target as HTMLSelectElement;
		if ($el == null) return;

		onChangeRefIncludes?.($el.value as GraphBranchesVisibility);
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
			onChangeColumns?.({
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
		onChangeColumns?.(graphColumnsConfig);
	};

	const handleOnToggleRefsVisibilityClick = (_event: any, refs: GraphRefOptData[], visible: boolean) => {
		onChangeRefsVisibility?.(refs, visible);
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

	const handleRowContextMenu = (_event: React.MouseEvent<any>, graphZoneType: GraphZoneType, graphRow: GraphRow) => {
		if (graphZoneType === refZone) return;
		hover.current?.hide();

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
		hover.current?.hide();

		const active = rows[rows.length - 1];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		// HACK: Ensure the main state is updated since it doesn't come from the extension
		state.activeRow = activeKey;
		setActiveRow(activeKey);
		setActiveDay(active?.date);
		computeSelectionContext(active, rows);

		onChangeSelection?.(rows);
	};

	return (
		<>
			<header className="titlebar graph-app__header">
				<div className="titlebar__row titlebar__row--wrap">
					<div className="titlebar__group">
						{repo?.provider?.url && (
							<>
								<GlPopover placement="bottom">
									<a
										href={repo.provider.url}
										className="action-button"
										style={{ marginRight: '-0.5rem' }}
										aria-label={`Open Repository on ${repo.provider.name}`}
										slot="anchor"
										onClick={e =>
											emitTelemetrySentEvent<'graph/action/openRepoOnRemote'>(e.target, {
												name: 'graph/action/openRepoOnRemote',
												data: {},
											})
										}
									>
										<span>
											<CodeIcon
												className="action-button__icon"
												icon={
													repo.provider.icon === 'cloud'
														? 'cloud'
														: `gl-provider-${repo.provider.icon}`
												}
												aria-hidden="true"
											/>
											{repo.provider.integration?.connected && (
												<GlIndicator
													style={{
														marginLeft: '-0.2rem',
														// @ts-expect-error React doesn't like that we are setting a custom css prop
														'--gl-indicator-color': 'green',
														'--gl-indicator-size': '0.4rem',
													}}
												></GlIndicator>
											)}
										</span>
									</a>
									<span slot="content">
										Open Repository on {repo.provider.name}
										<hr />
										{repo.provider.integration?.connected ? (
											<span>
												<CodeIcon
													style={{ marginTop: '-3px' }}
													icon="check"
													aria-hidden="true"
												/>{' '}
												Connected to {repo.provider.name}
											</span>
										) : (
											repo.provider.integration?.connected === false && (
												<>
													<CodeIcon
														style={{ marginTop: '-3px' }}
														icon="plug"
														aria-hidden="true"
													/>{' '}
													<a
														href={createCommandLink<ConnectCloudIntegrationsCommandArgs>(
															'gitlens.plus.cloudIntegrations.connect',
															{
																integrationIds: [repo.provider.integration.id],
																source: 'graph',
															},
														)}
													>
														Connect to {repo.provider.name}
													</a>
													<span> &mdash; not connected</span>
												</>
											)
										)}
									</span>
								</GlPopover>
								{repo?.provider?.integration?.connected === false && (
									<GlButton
										appearance="toolbar"
										href={createCommandLink<ConnectCloudIntegrationsCommandArgs>(
											'gitlens.plus.cloudIntegrations.connect',
											{
												integrationIds: [repo.provider.integration.id],
												source: 'graph',
											},
										)}
									>
										<CodeIcon icon="plug" style={{ color: 'var(--titlebar-fg)' }}></CodeIcon>
										<span slot="tooltip">
											Connect to {repo.provider.name}
											<hr />
											View pull requests and issues in the Commit Graph, Launchpad, autolinks, and
											more
										</span>
									</GlButton>
								)}
							</>
						)}
						<GlTooltip placement="bottom">
							<button
								type="button"
								className="action-button"
								aria-label="Switch to Another Repository..."
								disabled={repos.length < 2}
								onClick={() => handleChooseRepository()}
							>
								{repo?.formattedName ?? 'none selected'}
								{repos.length > 1 && (
									<CodeIcon className="action-button__more" icon="chevron-down" aria-hidden="true" />
								)}
							</button>
							<span slot="content">Switch to Another Repository...</span>
						</GlTooltip>
						{allowed && repo && (
							<>
								<span>
									<CodeIcon icon="chevron-right" />
								</span>
								{branchState?.pr && (
									<GlPopover placement="bottom">
										<button slot="anchor" type="button" className="action-button">
											<GlIssuePullRequest
												type="pr"
												identifier={`#${branchState.pr.id}`}
												status={branchState.pr.state}
												compact
											/>
										</button>
										<div slot="content">
											<GlIssuePullRequest
												type="pr"
												name={branchState.pr.title}
												url={branchState.pr.url}
												identifier={`#${branchState.pr.id}`}
												status={branchState.pr.state}
												date={branchState.pr.updatedDate}
												dateFormat={graphConfig?.dateFormat}
												dateStyle={graphConfig?.dateStyle}
												details
												onOpenDetails={() =>
													branchState.pr?.id ? onOpenPullRequest?.(branchState.pr) : undefined
												}
											/>
										</div>
									</GlPopover>
								)}
								<GlPopover placement="bottom">
									<a
										slot="anchor"
										href={createWebviewCommandLink(
											'gitlens.graph.switchToAnotherBranch',
											state.webviewId,
											state.webviewInstanceId,
										)}
										className="action-button"
										style={branchState?.pr ? { marginLeft: '-0.6rem' } : {}}
										aria-label="Switch to Another Branch..."
									>
										{!branchState?.pr ? (
											branchState?.worktree ? (
												<CodeIcon icon="gl-worktrees-view" aria-hidden="true" />
											) : (
												<CodeIcon icon="git-branch" aria-hidden="true" />
											)
										) : (
											''
										)}
										<span className="action-button__truncated">{branchName}</span>
										<CodeIcon
											className="action-button__more"
											icon="chevron-down"
											aria-hidden="true"
										/>
									</a>
									<div slot="content">
										<span>
											Switch to Another Branch...
											<hr />
											<CodeIcon icon="git-branch" aria-hidden="true" />{' '}
											<span className="md-code">{branchName}</span>
											{branchState?.worktree ? <i> (in a worktree)</i> : ''}
										</span>
									</div>
								</GlPopover>
								<GlButton className="jump-to-ref" appearance="toolbar" onClick={handleJumpToRef}>
									<CodeIcon icon="target"></CodeIcon>
									<span slot="tooltip">
										Jump to HEAD
										<br />
										[Alt] Jump to Reference...
									</span>
								</GlButton>
								<span>
									<CodeIcon icon="chevron-right" />
								</span>
								<GitActionsButtons
									branchName={branchName}
									branchState={branchState}
									lastFetched={lastFetched}
									state={state}
								/>
							</>
						)}
					</div>
					<div className="titlebar__group">
						<GlTooltip placement="bottom">
							<a
								className="action-button"
								href={createCommandLink<BranchGitCommandArgs>(GlCommand.GitCommandsBranch, {
									state: {
										subcommand: 'create',
										reference: branch,
									},
									command: 'branch',
									confirm: true,
								})}
							>
								<CodeIcon className="action-button__icon" icon="custom-start-work" />
							</a>
							<span slot="content">
								Create New Branch from
								<CodeIcon icon="git-branch" />
								<span className="md-code">{branchName}</span>
							</span>
						</GlTooltip>
						<GlTooltip placement="bottom">
							<a
								href={`command:gitlens.showLaunchpad?${encodeURIComponent(
									JSON.stringify({
										source: 'graph',
									} satisfies Omit<LaunchpadCommandArgs, 'command'>),
								)}`}
								className="action-button"
							>
								<CodeIcon icon="rocket" />
							</a>
							<span slot="content">
								<span style={{ whiteSpace: 'break-spaces' }}>
									<strong>Launchpad</strong> &mdash; organizes your pull requests into actionable
									groups to help you focus and keep your team unblocked
								</span>
							</span>
						</GlTooltip>
						<GlTooltip placement="bottom">
							<a
								href={'command:gitlens.views.home.focus'}
								className="action-button"
								aria-label={`Open GitLens Home View`}
							>
								<span>
									<CodeIcon className="action-button__icon" icon={'gl-gitlens'} aria-hidden="true" />
								</span>
							</a>
							<span slot="content">
								<strong>GitLens Home</strong> — track, manage, and collaborate on your branches and pull
								requests, all in one intuitive hub
							</span>
						</GlTooltip>
						{(subscription == null || !isSubscriptionPaid(subscription)) && (
							<GlFeatureBadge
								source={{ source: 'graph', detail: 'badge' }}
								subscription={subscription}
							></GlFeatureBadge>
						)}
					</div>
				</div>
				{allowed && (
					<div className="titlebar__row">
						<div className="titlebar__group">
							<GlTooltip placement="top" content="Branches Visibility">
								<SlSelect value={branchesVisibility} onSlChange={handleBranchesVisibility} hoist>
									<CodeIcon icon="chevron-down" slot="expand-icon"></CodeIcon>
									<SlOption value="all" disabled={repo?.isVirtual}>
										All Branches
									</SlOption>
									<SlOption value="smart" disabled={repo?.isVirtual}>
										Smart Branches
										{!repo?.isVirtual ? (
											<GlTooltip placement="right" slot="suffix">
												<CodeIcon icon="info"></CodeIcon>
												<span slot="content">
													Shows only relevant branches
													<br />
													<br />
													<i>
														Includes the current branch, its upstream, and its base or
														target branch
													</i>
												</span>
											</GlTooltip>
										) : (
											<CodeIcon icon="info" slot="suffix"></CodeIcon>
										)}
									</SlOption>
									<SlOption value="current">Current Branch</SlOption>
								</SlSelect>
							</GlTooltip>
							<GlPopover
								className="popover"
								placement="bottom-start"
								trigger="click focus"
								arrow={false}
								distance={0}
							>
								<GlTooltip placement="top" slot="anchor">
									<button type="button" className="action-button">
										<CodeIcon icon={`filter${hasFilters ? '-filled' : ''}`} />
										<CodeIcon
											className="action-button__more"
											icon="chevron-down"
											aria-hidden="true"
										/>
									</button>
									<span slot="content">Graph Filtering</span>
								</GlTooltip>
								<div slot="content">
									<MenuLabel>Graph Filters</MenuLabel>
									{repo?.isVirtual !== true && (
										<>
											<MenuItem role="none">
												<GlTooltip
													placement="right"
													content="Only follow the first parent of merge commits to provide a more linear history"
												>
													<GlCheckbox
														value="onlyFollowFirstParent"
														onChange={handleFilterChange}
														checked={graphConfig?.onlyFollowFirstParent ?? false}
													>
														Simplify Merge History
													</GlCheckbox>
												</GlTooltip>
											</MenuItem>
											<MenuDivider></MenuDivider>
											<MenuItem role="none">
												<GlCheckbox
													value="remotes"
													onChange={handleFilterChange}
													checked={excludeTypes?.remotes ?? false}
												>
													Hide Remote-only Branches
												</GlCheckbox>
											</MenuItem>
											<MenuItem role="none">
												<GlCheckbox
													value="stashes"
													onChange={handleFilterChange}
													checked={excludeTypes?.stashes ?? false}
												>
													Hide Stashes
												</GlCheckbox>
											</MenuItem>
										</>
									)}
									<MenuItem role="none">
										<GlCheckbox
											value="tags"
											onChange={handleFilterChange}
											checked={excludeTypes?.tags ?? false}
										>
											Hide Tags
										</GlCheckbox>
									</MenuItem>
									<MenuDivider></MenuDivider>
									<MenuItem role="none">
										<GlCheckbox
											value="mergeCommits"
											onChange={handleFilterChange}
											checked={graphConfig?.dimMergeCommits ?? false}
										>
											Dim Merge Commit Rows
										</GlCheckbox>
									</MenuItem>
								</div>
							</GlPopover>
							<span>
								<span className="action-divider"></span>
							</span>
							<GlSearchBox
								ref={searchEl}
								step={searchPosition}
								total={searchResults?.count ?? 0}
								valid={Boolean(searchQuery?.query && searchQuery.query.length > 2)}
								more={searchResults?.paging?.hasMore ?? false}
								searching={searching}
								filter={state.defaultSearchMode === 'filter'}
								value={searchQuery?.query ?? ''}
								errorMessage={searchResultsError?.error ?? ''}
								resultsHidden={searchResultsHidden}
								resultsLoaded={searchResults != null}
								onChange={e => handleSearchInput(e)}
								onNavigate={e => handleSearchNavigation(e)}
								onOpenInView={() => handleSearchOpenInView()}
								onSearchModeChange={e => handleSearchModeChange(e)}
							/>
							<span>
								<span className="action-divider"></span>
							</span>
							<span className="button-group">
								<GlTooltip placement="bottom">
									<button
										type="button"
										role="checkbox"
										className="action-button"
										aria-label="Toggle Minimap"
										aria-checked={graphConfig?.minimap ?? false}
										onClick={handleOnMinimapToggle}
									>
										<CodeIcon className="action-button__icon" icon="graph-line"></CodeIcon>
									</button>
									<span slot="content">Toggle Minimap</span>
								</GlTooltip>
								<GlPopover
									className="popover"
									placement="bottom-end"
									trigger="click focus"
									arrow={false}
									distance={0}
								>
									<GlTooltip placement="top" distance={7} slot="anchor">
										<button type="button" className="action-button" aria-label="Minimap Options">
											<CodeIcon
												className="action-button__more"
												icon="chevron-down"
												aria-hidden="true"
											/>
										</button>
										<span slot="content">Minimap Options</span>
									</GlTooltip>
									<div slot="content">
										<MenuLabel>Minimap</MenuLabel>
										<MenuItem role="none">
											<GlRadioGroup
												value={graphConfig?.minimapDataType ?? 'commits'}
												onChange={handleOnMinimapDataTypeChange}
											>
												<GlRadio name="minimap-datatype" value="commits">
													Commits
												</GlRadio>
												<GlRadio name="minimap-datatype" value="lines">
													Lines Changed
												</GlRadio>
											</GlRadioGroup>
										</MenuItem>
										<MenuDivider></MenuDivider>
										<MenuLabel>Markers</MenuLabel>
										<MenuItem role="none">
											<GlCheckbox
												value="localBranches"
												onChange={handleOnMinimapAdditionalTypesChange}
												checked={
													graphConfig?.minimapMarkerTypes?.includes('localBranches') ?? false
												}
											>
												<span
													className="minimap-marker-swatch"
													data-marker="localBranches"
												></span>
												Local Branches
											</GlCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<GlCheckbox
												value="remoteBranches"
												onChange={handleOnMinimapAdditionalTypesChange}
												checked={
													graphConfig?.minimapMarkerTypes?.includes('remoteBranches') ?? true
												}
											>
												<span
													className="minimap-marker-swatch"
													data-marker="remoteBranches"
												></span>
												Remote Branches
											</GlCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<GlCheckbox
												value="pullRequests"
												onChange={handleOnMinimapAdditionalTypesChange}
												checked={
													graphConfig?.minimapMarkerTypes?.includes('pullRequests') ?? true
												}
											>
												<span
													className="minimap-marker-swatch"
													data-marker="pullRequests"
												></span>
												Pull Requests
											</GlCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<GlCheckbox
												value="stashes"
												onChange={handleOnMinimapAdditionalTypesChange}
												checked={graphConfig?.minimapMarkerTypes?.includes('stashes') ?? false}
											>
												<span className="minimap-marker-swatch" data-marker="stashes"></span>
												Stashes
											</GlCheckbox>
										</MenuItem>
										<MenuItem role="none">
											<GlCheckbox
												value="tags"
												onChange={handleOnMinimapAdditionalTypesChange}
												checked={graphConfig?.minimapMarkerTypes?.includes('tags') ?? true}
											>
												<span className="minimap-marker-swatch" data-marker="tags"></span>
												Tags
											</GlCheckbox>
										</MenuItem>
									</div>
								</GlPopover>
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
			<GlFeatureGate
				className="graph-app__gate"
				featurePreview={featurePreview}
				featurePreviewCommandLink={
					featurePreview
						? createWebviewCommandLink(
								GlCommand.PlusContinueFeaturePreview,
								state.webviewId,
								state.webviewInstanceId,
								{ feature: featurePreview.feature },
						  )
						: undefined
				}
				appearance="alert"
				featureWithArticleIfNeeded="the Commit Graph"
				source={{ source: 'graph', detail: 'gate' }}
				state={subscription?.state}
				webroot={state.webroot}
				visible={!allowed}
			>
				<p slot="feature">
					<a href="https://help.gitkraken.com/gitlens/gitlens-features/#commit-graph-pro">Commit Graph</a>
					<GlFeatureBadge
						source={{ source: 'graph', detail: 'badge' }}
						subscription={subscription}
					></GlFeatureBadge>{' '}
					&mdash; easily visualize your repository and keep track of all work in progress. Use the rich commit
					search to find a specific commit, message, author, a changed file or files, or even a specific code
					change.
				</p>
			</GlFeatureGate>
			<GlGraphMinimapContainer
				ref={minimap as any}
				activeDay={activeDay}
				disabled={!graphConfig?.minimap}
				rows={rows}
				rowsStats={rowsStats}
				dataType={graphConfig?.minimapDataType ?? 'commits'}
				markerTypes={graphConfig?.minimapMarkerTypes}
				refMetadata={refsMetadata}
				searchResults={searchResults}
				visibleDays={visibleDays}
				onSelected={e => handleOnMinimapDaySelected(e)}
			></GlGraphMinimapContainer>
			<GlGraphHover ref={hover as any} id="commit-hover" distance={0} skidding={15}></GlGraphHover>
			<main id="main" className="graph-app__main" aria-hidden={!allowed}>
				<GlGraphSideBar
					enabled={graphConfig?.sidebar}
					include={
						repo?.isVirtual
							? ['branches', 'remotes', 'tags']
							: ['branches', 'remotes', 'tags', 'stashes', 'worktrees']
					}
				></GlGraphSideBar>
				{repo !== undefined ? (
					<>
						<GraphContainer
							ref={graphRef}
							avatarUrlByEmail={avatars}
							columnsSettings={columns}
							contexts={context}
							// @ts-expect-error returnType of formatCommitMessage callback expects to be string, but it works fine with react element
							formatCommitMessage={e => <GlMarkdown markdown={e}></GlMarkdown>}
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
							onGraphMouseLeave={handleOnGraphMouseLeave}
							onGraphRowHovered={handleOnGraphRowHovered}
							onGraphRowUnhovered={handleOnGraphRowUnhovered}
							onRowContextMenu={handleRowContextMenu}
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
							searchMode={searchQuery?.filter ? 'filter' : 'normal'}
							shaLength={graphConfig?.idLength}
							shiftSelectMode="simple"
							suppressNonRefRowTooltips
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
