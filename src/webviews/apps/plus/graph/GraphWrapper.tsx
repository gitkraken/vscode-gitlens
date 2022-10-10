import GraphContainer from '@gitkraken/gitkraken-components';
import type {
	GraphColumnSetting,
	GraphContainerProps,
	GraphPlatform,
	GraphRow,
	OnFormatCommitDateTime,
} from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import { DateStyle } from '../../../../config';
import { RepositoryVisibility } from '../../../../git/gitProvider';
import type { SearchQuery } from '../../../../git/search';
import type {
	DidEnsureRowParams,
	DidSearchParams,
	DismissBannerParams,
	GraphAvatars,
	GraphColumnConfig,
	GraphColumnName,
	GraphComponentConfig,
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
	DidChangeRowsNotificationType,
	DidChangeSelectionNotificationType,
	DidChangeSubscriptionNotificationType,
	DidChangeWorkingTreeNotificationType,
	DidSearchNotificationType,
} from '../../../../plus/webviews/graph/protocol';
import type { Subscription } from '../../../../subscription';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import type { IpcNotificationType } from '../../../../webviews/protocol';
import { SearchBox } from '../../shared/components/search/react';
import type { SearchNavigationEventDetail } from '../../shared/components/search/search-box';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';

export interface GraphWrapperProps {
	nonce?: string;
	state: State;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onSelectRepository?: (repository: GraphRepository) => void;
	onColumnChange?: (name: GraphColumnName, settings: GraphColumnConfig) => void;
	onMissingAvatars?: (emails: { [email: string]: string }) => void;
	onMissingRefsMetadata?: (metadata: GraphMissingRefsMetadata) => void;
	onMoreRows?: (id?: string) => void;
	onSearch?: (search: SearchQuery | undefined, options?: { limit?: number }) => void;
	onSearchPromise?: (
		search: SearchQuery,
		options?: { limit?: number; more?: boolean },
	) => Promise<DidSearchParams | undefined>;
	onSearchOpenInView?: (search: SearchQuery) => void;
	onDismissBanner?: (key: DismissBannerParams['key']) => void;
	onSelectionChange?: (rows: GraphRow[]) => void;
	onEnsureRowPromise?: (id: string, select: boolean) => Promise<DidEnsureRowParams | undefined>;
}

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number) => formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat);
};

type DebouncableFn = (...args: any) => void;
type DebouncedFn = (...args: any) => void;
const debounceFrame = (func: DebouncableFn): DebouncedFn => {
	let timer: number;
	return function (...args: any) {
		if (timer) cancelAnimationFrame(timer);
		timer = requestAnimationFrame(() => {
			func(...args);
		});
	};
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
	];
	const elementLibrary: { [key: string]: ReactElement<any> } = {};
	iconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `graph-icon icon--${iconKey}` });
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
	onSelectRepository,
	onColumnChange,
	onEnsureRowPromise,
	onMissingAvatars,
	onMissingRefsMetadata,
	onMoreRows,
	onSearch,
	onSearchPromise,
	onSearchOpenInView,
	onSelectionChange,
	onDismissBanner,
}: GraphWrapperProps) {
	// TODO: application shouldn't know about the graph component's header
	const graphHeaderOffset = 24;
	const [mainWidth, setMainWidth] = useState<number>();
	const [mainHeight, setMainHeight] = useState<number>();
	const mainRef = useRef<HTMLElement>(null);
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
	const [context, setContext] = useState(state.context);
	const [pagingHasMore, setPagingHasMore] = useState(state.paging?.hasMore ?? false);
	const [isLoading, setIsLoading] = useState(state.loading);
	const [styleProps, setStyleProps] = useState(state.theming);
	// banner
	const [showPreview, setShowPreview] = useState(state.previewBanner);
	// account
	const [showAccount, setShowAccount] = useState(state.trialBanner);
	const [isAccessAllowed, setIsAccessAllowed] = useState(state.allowed ?? false);
	const [isRepoPrivate, setIsRepoPrivate] = useState(
		state.selectedRepositoryVisibility === RepositoryVisibility.Private,
	);
	const [subscription, setSubscription] = useState<Subscription | undefined>(state.subscription);
	// repo selection UI
	const [repoExpanded, setRepoExpanded] = useState(false);
	// search state
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
			case DidChangeSubscriptionNotificationType:
				setIsAccessAllowed(state.allowed ?? false);
				setSubscription(state.subscription);
				break;
			case DidChangeWorkingTreeNotificationType:
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				break;
			default: {
				setIsAccessAllowed(state.allowed ?? false);
				if (!themingChanged) {
					setStyleProps(state.theming);
				}
				setColumns(state.columns);
				setRows(state.rows ?? []);
				setWorkingTreeStats(state.workingTreeStats ?? { added: 0, modified: 0, deleted: 0 });
				setGraphConfig(state.config);
				setSelectedRows(state.selectedRows);
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

	useLayoutEffect(() => {
		if (mainRef.current === null) return;

		const setDimensionsDebounced = debounceFrame((width, height) => {
			setMainWidth(Math.floor(width));
			setMainHeight(Math.floor(height) - graphHeaderOffset);
		});

		const resizeObserver = new ResizeObserver(entries =>
			entries.forEach(e => setDimensionsDebounced(e.contentRect.width, e.contentRect.height)),
		);
		resizeObserver.observe(mainRef.current);

		return () => resizeObserver.disconnect();
	}, [mainRef]);

	const searchPosition: number = useMemo(() => {
		if (searchResults?.ids == null || !searchQuery?.query) return 0;

		const id = getActiveRowInfo(activeRow)?.id;
		let searchIndex = id ? searchResults.ids[id]?.i : undefined;
		if (searchIndex == null) {
			[searchIndex] = getClosestSearchResultIndex(searchResults, searchQuery, activeRow);
		}
		return searchIndex < 1 ? 1 : searchIndex + 1;
	}, [activeRow, searchResults]);

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
			// TODO@eamodio Remove the any once we expose `selectCommits` on the graph component
			queueMicrotask(() => void (graphRef.current as any)?.selectCommits([id], false));
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

	const handleSelectRepository = (item: GraphRepository) => {
		if (item != null && item !== repo) {
			setIsLoading(true);
			onSelectRepository?.(item);
		}
		setRepoExpanded(false);
	};

	const handleToggleRepos = () => {
		if (repo != null && repos.length <= 1) return;
		setRepoExpanded(!repoExpanded);
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
			onColumnChange?.(columnName, {
				width: columnSettings.width,
				isHidden: columnSettings.isHidden,
			});
		}
	};

	const handleSelectGraphRows = (rows: GraphRow[]) => {
		const active = rows[0];
		const activeKey = active != null ? `${active.sha}|${active.date}` : undefined;
		// HACK: Ensure the main state is updated since it doesn't come from the extension
		state.activeRow = activeKey;
		setActiveRow(activeKey);
		onSelectionChange?.(rows);
	};

	const handleDismissPreview = () => {
		setShowPreview(false);
		onDismissBanner?.('preview');
	};

	const handleDismissAccount = () => {
		setShowAccount(false);
		onDismissBanner?.('trial');
	};

	const renderTrialDays = () => {
		if (
			!subscription ||
			![SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(subscription.state)
		) {
			return;
		}

		const days = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
		return (
			<span className="mr-loose">
				<span className="badge">GitLens+ Trial</span> ({days < 1 ? '< 1 day' : pluralize('day', days)} left)
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
			case SubscriptionState.FreePlusInTrial:
				icon = 'calendar';
				modifier = 'neutral';
				content = (
					<>
						<p className="alert__title">GitLens+ Trial</p>
						<p className="alert__message">
							You have {days < 1 ? 'less than one day' : pluralize('day', days)} left in your{' '}
							<a title="Learn more about GitLens+ features" href="command:gitlens.plus.learn">
								GitLens+ trial
							</a>
							. Once your trial ends, you'll need a paid plan to continue to use GitLens+ features,
							including the Commit Graph, on this and other private repos.
						</p>
					</>
				);
				break;
			case SubscriptionState.FreePreviewTrialExpired:
				icon = 'warning';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">Extend Your GitLens+ Trial</p>
						<p className="alert__message">
							Your free trial has ended, please sign in to extend your trial of GitLens+ features on
							private repos by an additional 7-days.
						</p>
					</>
				);
				actions = (
					<a className="alert-action" href="command:gitlens.plus.loginOrSignUp">
						Extend Trial
					</a>
				);
				break;
			case SubscriptionState.FreePlusTrialExpired:
				icon = 'warning';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">GitLens+ Trial Expired</p>
						<p className="alert__message">
							Your free trial has ended, please upgrade your account to continue to use GitLens+ features,
							including the Commit Graph, on this and other private repos.
						</p>
					</>
				);
				actions = (
					<a className="alert-action" href="command:gitlens.plus.purchase">
						Upgrade Your Account
					</a>
				);
				break;
			case SubscriptionState.VerificationRequired:
				icon = 'unverified';
				modifier = 'warning';
				content = (
					<>
						<p className="alert__title">Please verify your email</p>
						<p className="alert__message">Please verify the email for the account you created.</p>
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
		);
	};

	return (
		<>
			<section className="graph-app__banners">
				{showPreview && (
					<div className="alert">
						<span className="alert__icon codicon codicon-eye"></span>
						<div className="alert__content">
							<p className="alert__title">GitLens+ Feature Preview</p>
							<p className="alert__message">
								The Commit Graph is currently in preview. It will always be freely available for local
								and public repos, while private repos require a paid plan.
							</p>
							<p className="alert__accent">
								<span className="codicon codicon-feedback alert__accent-icon" /> Join the{' '}
								<a href="https://github.com/gitkraken/vscode-gitlens/discussions/2158">
									discussion on GitHub
								</a>
								! We'd love to hear from you.
							</p>
							<p className="alert__accent">
								<span className="glicon glicon-clock alert__accent-icon" /> GitLens+{' '}
								<a href="command:gitlens.plus.purchase">introductory pricing</a> will end with the next
								release (late Sept, early Oct).
							</p>
						</div>
						<button className="alert__dismiss" type="button" onClick={() => handleDismissPreview()}>
							<span className="codicon codicon-chrome-close"></span>
						</button>
					</div>
				)}
				{renderAlertContent()}
			</section>
			{isAccessAllowed && (
				<header className="titlebar graph-app__header">
					<div className="titlebar__group">
						<SearchBox
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
				</header>
			)}
			<main
				ref={mainRef}
				id="main"
				className={`graph-app__main${!isAccessAllowed ? ' is-gated' : ''}`}
				aria-hidden={!isAccessAllowed}
			>
				{!isAccessAllowed && <div className="graph-app__cover"></div>}
				{repo !== undefined ? (
					<>
						{mainWidth !== undefined && mainHeight !== undefined && (
							<GraphContainer
								ref={graphRef}
								avatarUrlByEmail={avatars}
								columnsSettings={columns}
								contexts={context}
								cssVariables={styleProps?.cssVariables}
								enableMultiSelection={graphConfig?.enableMultiSelection}
								formatCommitDateTime={getGraphDateFormatter(graphConfig)}
								getExternalIcon={getIconElementLibrary}
								graphRows={rows}
								hasMoreCommits={pagingHasMore}
								height={mainHeight}
								// Just cast the { [id: string]: number } object to { [id: string]: boolean } for performance
								highlightedShas={searchResults?.ids as GraphContainerProps['highlightedShas']}
								highlightRowsOnRefHover={graphConfig?.highlightRowsOnRefHover}
								showGhostRefsOnRowHover={graphConfig?.showGhostRefsOnRowHover}
								showRemoteNamesOnRefs={graphConfig?.showRemoteNamesOnRefs}
								isLoadingRows={isLoading}
								isSelectedBySha={selectedRows}
								nonce={nonce}
								onColumnResized={handleOnColumnResized}
								onSelectGraphRows={handleSelectGraphRows}
								onEmailsMissingAvatarUrls={handleMissingAvatars}
								onRefsMissingMetadata={handleMissingRefsMetadata}
								onShowMoreCommits={handleMoreCommits}
								platform={clientPlatform}
								refMetadataById={refsMetadata}
								shaLength={graphConfig?.idLength}
								themeOpacityFactor={styleProps?.themeOpacityFactor}
								useAuthorInitialsForAvatars={!graphConfig?.avatars}
								width={mainWidth}
								workDirStats={workingTreeStats}
							/>
						)}
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
			<footer
				className={`actionbar graph-app__footer${!isAccessAllowed ? ' is-gated' : ''}`}
				aria-hidden={!isAccessAllowed}
			>
				<div className="actionbar__group">
					<div className="actioncombo">
						<button
							type="button"
							aria-controls="repo-actioncombo-list"
							aria-expanded={repoExpanded}
							aria-haspopup="listbox"
							id="repo-actioncombo-label"
							className="actioncombo__label"
							disabled={repos.length < 2}
							role="combobox"
							aria-activedescendant={
								repoExpanded
									? `repo-actioncombo-item-${repos.findIndex(item => item.path === repo?.path)}`
									: undefined
							}
							onClick={() => handleToggleRepos()}
						>
							<span className="codicon codicon-repo actioncombo__icon" aria-label="Repository "></span>
							{repo?.formattedName ?? 'none selected'}
						</button>
						<div
							className="actioncombo__list"
							id="repo-actioncombo-list"
							role="listbox"
							tabIndex={-1}
							aria-labelledby="repo-actioncombo-label"
						>
							{repos.length > 0 ? (
								repos.map((item, index) => (
									<button
										type="button"
										className="actioncombo__item"
										role="option"
										data-value={item.path}
										id={`repo-actioncombo-item-${index}`}
										key={`repo-actioncombo-item-${index}`}
										aria-selected={item.path === repo?.path}
										onClick={() => handleSelectRepository(item)}
										disabled={item.path === repo?.path}
									>
										<span
											className={`${
												item.path === repo?.path ? 'codicon codicon-check ' : ''
											}actioncombo__icon`}
											aria-label="Checked"
										></span>
										{item.formattedName}
									</button>
								))
							) : (
								<span
									className="actioncombo__item"
									role="option"
									id="repo-actioncombo-item-0"
									aria-selected="true"
								>
									None available
								</span>
							)}
						</div>
					</div>
					{isAccessAllowed && rows.length > 0 && (
						<span className="actionbar__details">
							showing {rows.length} item{rows.length ? 's' : ''}
						</span>
					)}
					{isLoading && (
						<span className="actionbar__loading">
							<span className="icon--loading icon-modifier--spin" />
						</span>
					)}
				</div>
				<div className="actionbar__group">
					{renderTrialDays()}
					<span className="badge">Preview</span>
					<a
						href="https://github.com/gitkraken/vscode-gitlens/discussions/2158"
						title="Commit Graph Feedback"
						aria-label="Commit Graph Feedback"
					>
						<span className="codicon codicon-feedback"></span>
					</a>
				</div>
				<div className={`progress-container infinite${isLoading ? ' active' : ''}`} role="progressbar">
					<div className="progress-bar"></div>
				</div>
			</footer>
		</>
	);
}

function formatCommitDateTime(
	commitDateTime: number,
	style: DateStyle = DateStyle.Absolute,
	format: DateTimeFormat | string = 'short+short',
): string {
	return style === DateStyle.Relative ? fromNow(commitDateTime) : formatDate(commitDateTime, format);
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
