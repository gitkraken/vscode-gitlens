import type { OnFormatCommitDateTime } from '@gitkraken/gitkraken-components';
import GraphContainer, {
	type CssVariables,
	type GraphColumnSetting,
	type GraphPlatform,
	type GraphRow,
} from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import { DateStyle } from '../../../../config';
import { RepositoryVisibility } from '../../../../git/gitProvider';
import type { GitGraphRowType } from '../../../../git/models/graph';
import type { SearchQuery } from '../../../../git/search';
import type {
	DidEnsureCommitParams,
	DidSearchCommitsParams,
	DismissBannerParams,
	GraphColumnConfig,
	GraphColumnName,
	GraphColumnsSettings,
	GraphComponentConfig,
	GraphRepository,
	State,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import type { Subscription } from '../../../../subscription';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../subscription';
import { debounce } from '../../../../system/function';
import { pluralize } from '../../../../system/string';
import { SearchField, SearchNav } from '../../shared/components/search/react';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';

export interface GraphWrapperProps extends State {
	nonce?: string;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onSelectRepository?: (repository: GraphRepository) => void;
	onColumnChange?: (name: GraphColumnName, settings: GraphColumnConfig) => void;
	onMissingAvatars?: (emails: { [email: string]: string }) => void;
	onMoreCommits?: (id?: string) => void;
	onSearchCommits?: (search: SearchQuery | undefined, options?: { limit?: number }) => void;
	onSearchCommitsPromise?: (
		search: SearchQuery,
		options?: { limit?: number; more?: boolean },
	) => Promise<DidSearchCommitsParams | undefined>;
	onDismissBanner?: (key: DismissBannerParams['key']) => void;
	onSelectionChange?: (selection: { id: string; type: GitGraphRowType }[]) => void;
	onEnsureCommitPromise?: (id: string, select: boolean) => Promise<DidEnsureCommitParams | undefined>;
}

const getStyleProps = (
	mixedColumnColors: CssVariables | undefined,
): { cssVariables: CssVariables; themeOpacityFactor: number } => {
	const body = document.body;
	const computedStyle = window.getComputedStyle(body);

	return {
		cssVariables: {
			'--app__bg0': computedStyle.getPropertyValue('--color-background'),
			'--panel__bg0': computedStyle.getPropertyValue('--graph-panel-bg'),
			'--panel__bg1': computedStyle.getPropertyValue('--graph-panel-bg2'),
			'--section-border': computedStyle.getPropertyValue('--graph-panel-bg2'),
			'--text-selected': computedStyle.getPropertyValue('--color-foreground'),
			'--text-normal': computedStyle.getPropertyValue('--color-foreground--85'),
			'--text-secondary': computedStyle.getPropertyValue('--color-foreground--65'),
			'--text-disabled': computedStyle.getPropertyValue('--color-foreground--50'),
			'--text-accent': computedStyle.getPropertyValue('--color-link-foreground'),
			'--text-inverse': computedStyle.getPropertyValue('--vscode-input-background'),
			'--text-bright': computedStyle.getPropertyValue('--vscode-input-background'),
			...mixedColumnColors,
		},
		themeOpacityFactor: parseInt(computedStyle.getPropertyValue('--graph-theme-opacity-factor')) || 1,
	};
};

const defaultGraphColumnsSettings: GraphColumnsSettings = {
	ref: { width: 150, isHidden: false },
	graph: { width: 150, isHidden: false },
	message: { width: 300, isHidden: false },
	author: { width: 130, isHidden: false },
	datetime: { width: 130, isHidden: false },
	sha: { width: 130, isHidden: false },
};

const getGraphColumns = (columns?: Record<GraphColumnName, GraphColumnConfig> | undefined): GraphColumnsSettings => {
	const columnsSettings: GraphColumnsSettings = {
		...defaultGraphColumnsSettings,
	};
	if (columns != null) {
		for (const [column, columnCfg] of Object.entries(columns) as [GraphColumnName, GraphColumnConfig][]) {
			columnsSettings[column] = {
				...defaultGraphColumnsSettings[column],
				...columnCfg,
			};
		}
	}
	return columnsSettings;
};

const getGraphDateFormatter = (config?: GraphComponentConfig): OnFormatCommitDateTime => {
	return (commitDateTime: number) => formatCommitDateTime(commitDateTime, config?.dateStyle, config?.dateFormat);
};

const getSearchHighlights = (searchIds?: [string, number][]): { [id: string]: boolean } | undefined => {
	if (!searchIds?.length) return undefined;

	const highlights: { [id: string]: boolean } = {};
	for (const [sha] of searchIds) {
		highlights[sha] = true;
	}
	return highlights;
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
	repositories = [],
	rows = [],
	selectedRepository,
	selectedRows,
	subscription,
	selectedRepositoryVisibility,
	allowed,
	avatars,
	columns,
	config,
	context,
	loading,
	paging,
	onSelectRepository,
	onColumnChange,
	onEnsureCommitPromise,
	onMissingAvatars,
	onMoreCommits,
	onSearchCommits,
	onSearchCommitsPromise,
	onSelectionChange,
	nonce,
	mixedColumnColors,
	previewBanner = true,
	searchResults,
	trialBanner = true,
	onDismissBanner,
}: GraphWrapperProps) {
	const [graphRows, setGraphRows] = useState(rows);
	const [graphAvatars, setAvatars] = useState(avatars);
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState<GraphRepository | undefined>(
		reposList.find(item => item.path === selectedRepository),
	);
	const [graphSelectedRows, setSelectedRows] = useState(selectedRows);
	const [graphConfig, setGraphConfig] = useState(config);
	// const [graphDateFormatter, setGraphDateFormatter] = useState(getGraphDateFormatter(config));
	const [graphColumns, setGraphColumns] = useState(getGraphColumns(columns));
	const [graphContext, setGraphContext] = useState(context);
	const [pagingState, setPagingState] = useState(paging);
	const [isLoading, setIsLoading] = useState(loading);
	const [styleProps, setStyleProps] = useState(getStyleProps(mixedColumnColors));
	// TODO: application shouldn't know about the graph component's header
	const graphHeaderOffset = 24;
	const [mainWidth, setMainWidth] = useState<number>();
	const [mainHeight, setMainHeight] = useState<number>();
	const mainRef = useRef<HTMLElement>(null);
	// banner
	const [showPreview, setShowPreview] = useState(previewBanner);
	// account
	const [showAccount, setShowAccount] = useState(trialBanner);
	const [isAllowed, setIsAllowed] = useState(allowed ?? false);
	const [isPrivateRepo, setIsPrivateRepo] = useState(selectedRepositoryVisibility === RepositoryVisibility.Private);
	const [subscriptionSnapshot, setSubscriptionSnapshot] = useState<Subscription | undefined>(subscription);
	// repo selection UI
	const [repoExpanded, setRepoExpanded] = useState(false);
	// search state
	const [searchQuery, setSearchQuery] = useState<SearchQuery | undefined>(undefined);
	const [searchResultKey, setSearchResultKey] = useState<string | undefined>(undefined);
	const [searchResultIds, setSearchResultIds] = useState(
		searchResults != null ? Object.entries(searchResults.ids) : undefined,
	);
	const [hasMoreSearchResults, setHasMoreSearchResults] = useState(searchResults?.paging?.hasMore ?? false);
	const [selectedRow, setSelectedRow] = useState<GraphRow | undefined>(undefined);

	useEffect(() => {
		if (graphRows.length === 0) {
			setSearchResultIds(undefined);
		}
	}, [graphRows]);

	useEffect(() => {
		if (searchResultIds == null || searchResultIds.length === 0) {
			setSearchResultKey(undefined);
			return;
		}

		if (
			searchResultKey == null ||
			(searchResultKey != null && !searchResultIds.some(id => id[0] === searchResultKey))
		) {
			setSearchResultKey(searchResultIds[0][0]);
		}
	}, [searchResultIds]);

	const searchHighlights = useMemo(() => getSearchHighlights(searchResultIds), [searchResultIds]);

	const searchPosition: number = useMemo(() => {
		if (searchResultKey == null || searchResultIds == null) return 0;

		const idx = searchResultIds.findIndex(id => id[0] === searchResultKey);
		return idx < 1 ? 1 : idx + 1;
	}, [searchResultKey, searchResultIds]);

	const handleSearchNavigation = async (next = true) => {
		if (searchResultKey == null || searchResultIds == null) return;

		let selected = searchResultKey;
		if (selectedRow != null && selectedRow.sha !== searchResultKey) {
			selected = selectedRow.sha;
		}

		let resultIds = searchResultIds;
		const selectedDate = selectedRow != null ? selectedRow.date + (next ? 1 : -1) : undefined;

		// Loop through the search results and:
		//  try to find the selected sha
		//  if next=true find the nearest date before the selected date
		//  if next=false find the nearest date after the selected date
		let rowIndex: number | undefined;
		let nearestDate: number | undefined;
		let nearestIndex: number | undefined;

		let i = -1;
		let date: number;
		let sha: string;
		for ([sha, date] of resultIds) {
			i++;

			if (sha === selected) {
				rowIndex = i;
				break;
			}

			if (selectedDate != null) {
				if (next) {
					if (date < selectedDate && (nearestDate == null || date > nearestDate)) {
						nearestDate = date;
						nearestIndex = i;
					}
				} else if (date > selectedDate && (nearestDate == null || date <= nearestDate)) {
					nearestDate = date;
					nearestIndex = i;
				}
			}
		}

		if (rowIndex == null) {
			rowIndex = nearestIndex == null ? resultIds.length - 1 : nearestIndex + (next ? -1 : 1);
		}

		if (next) {
			if (rowIndex < resultIds.length - 1) {
				rowIndex++;
			} else if (searchQuery != null && hasMoreSearchResults) {
				const results = await onSearchCommitsPromise?.(searchQuery, { more: true });
				if (results?.results != null) {
					if (resultIds.length < results.results.ids.length) {
						resultIds = Object.entries(results.results.ids);
						rowIndex++;
					} else {
						rowIndex = 0;
					}
				} else {
					rowIndex = 0;
				}
			} else {
				rowIndex = 0;
			}
		} else if (rowIndex > 0) {
			rowIndex--;
		} else {
			if (searchQuery != null && hasMoreSearchResults) {
				const results = await onSearchCommitsPromise?.(searchQuery, { limit: 0, more: true });
				if (results?.results != null) {
					if (resultIds.length < results.results.ids.length) {
						resultIds = Object.entries(results.results.ids);
					}
				}
			}

			rowIndex = resultIds.length - 1;
		}

		const nextSha = resultIds[rowIndex][0];
		if (nextSha == null) return;

		if (onEnsureCommitPromise != null) {
			let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
				timeout = undefined;
				setIsLoading(true);
			}, 250);

			const e = await onEnsureCommitPromise(nextSha, true);
			if (timeout == null) {
				setIsLoading(false);
			} else {
				clearTimeout(timeout);
			}

			if (e?.id === nextSha) {
				setSearchResultKey(nextSha);
				setSelectedRows({ [nextSha]: true });
			} else {
				debugger;
			}
		} else {
			setSearchResultKey(nextSha);
			setSelectedRows({ [nextSha]: true });
		}
	};

	const handleSearchInput = debounce((e: CustomEvent<SearchQuery>) => {
		const detail = e.detail;
		setSearchQuery(detail);

		const isValid = detail.query.length >= 3;
		if (!isValid) {
			setSearchResultKey(undefined);
			setSearchResultIds(undefined);
		}
		onSearchCommits?.(isValid ? detail : undefined);
	}, 250);

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

	function transformData(state: State) {
		setGraphRows(state.rows ?? []);
		setAvatars(state.avatars ?? {});
		setReposList(state.repositories ?? []);
		setCurrentRepository(reposList.find(item => item.path === state.selectedRepository));
		if (JSON.stringify(graphSelectedRows) !== JSON.stringify(state.selectedRows)) {
			setSelectedRows(state.selectedRows);
		}
		setGraphConfig(state.config);
		// setGraphDateFormatter(getGraphDateFormatter(config));
		setGraphColumns(getGraphColumns(state.columns));
		setGraphContext(state.context);
		setPagingState(state.paging);
		setStyleProps(getStyleProps(state.mixedColumnColors));
		setIsAllowed(state.allowed ?? false);
		setShowAccount(state.trialBanner ?? true);
		setSubscriptionSnapshot(state.subscription);
		setIsPrivateRepo(state.selectedRepositoryVisibility === RepositoryVisibility.Private);
		setIsLoading(state.loading);
		setSearchResultIds(state.searchResults != null ? Object.entries(state.searchResults.ids) : undefined);
		setHasMoreSearchResults(state.searchResults?.paging?.hasMore ?? false);
	}

	useEffect(() => subscriber?.(transformData), []);

	const handleSelectRepository = (item: GraphRepository) => {
		if (item != null && item !== currentRepository) {
			setIsLoading(true);
			onSelectRepository?.(item);
		}
		setRepoExpanded(false);
	};

	const handleToggleRepos = () => {
		if (currentRepository != null && reposList.length <= 1) return;
		setRepoExpanded(!repoExpanded);
	};

	const handleMissingAvatars = (emails: { [email: string]: string }) => {
		onMissingAvatars?.(emails);
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
		onMoreCommits?.();
	};

	const handleOnColumnResized = (columnName: GraphColumnName, columnSettings: GraphColumnSetting) => {
		if (columnSettings.width) {
			onColumnChange?.(columnName, {
				width: columnSettings.width,
				isHidden: columnSettings.isHidden,
			});
		}
	};

	const handleSelectGraphRows = (graphRows: GraphRow[]) => {
		setSelectedRow(graphRows[0]);
		onSelectionChange?.(graphRows.map(r => ({ id: r.sha, type: r.type as GitGraphRowType })));
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
			!subscriptionSnapshot ||
			![SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(
				subscriptionSnapshot.state,
			)
		) {
			return;
		}

		const days = getSubscriptionTimeRemaining(subscriptionSnapshot, 'days') ?? 0;
		return (
			<span className="mr-loose">
				<span className="badge">GitLens+ Trial</span> ({days < 1 ? '< 1 day' : pluralize('day', days)} left)
			</span>
		);
	};

	const renderAlertContent = () => {
		if (subscriptionSnapshot == null || !isPrivateRepo || (isAllowed && !showAccount)) return;

		let icon = 'account';
		let modifier = '';
		let content;
		let actions;
		let days = 0;
		if (
			[SubscriptionState.FreeInPreviewTrial, SubscriptionState.FreePlusInTrial].includes(
				subscriptionSnapshot.state,
			)
		) {
			days = getSubscriptionTimeRemaining(subscriptionSnapshot, 'days') ?? 0;
		}

		switch (subscriptionSnapshot.state) {
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
				{isAllowed && (
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
			{isAllowed && (
				<header className="titlebar graph-app__header">
					<div className="titlebar__group">
						<SearchField
							value={searchQuery?.query}
							onChange={e => handleSearchInput(e as CustomEvent<SearchQuery>)}
							onPrevious={() => handleSearchNavigation(false)}
							onNext={() => handleSearchNavigation(true)}
						/>
						<SearchNav
							aria-label="Graph search navigation"
							step={searchPosition}
							total={searchResultIds?.length ?? 0}
							valid={Boolean(searchQuery?.query && searchQuery.query.length > 2)}
							more={hasMoreSearchResults}
							onPrevious={() => handleSearchNavigation(false)}
							onNext={() => handleSearchNavigation(true)}
						/>
					</div>
				</header>
			)}
			<main
				ref={mainRef}
				id="main"
				className={`graph-app__main${!isAllowed ? ' is-gated' : ''}`}
				aria-hidden={!isAllowed}
			>
				{!isAllowed && <div className="graph-app__cover"></div>}
				{currentRepository !== undefined ? (
					<>
						{mainWidth !== undefined && mainHeight !== undefined && (
							<GraphContainer
								avatarUrlByEmail={graphAvatars}
								columnsSettings={graphColumns}
								contexts={graphContext}
								cssVariables={styleProps.cssVariables}
								enableMultiSelection={graphConfig?.enableMultiSelection}
								formatCommitDateTime={getGraphDateFormatter(graphConfig)}
								getExternalIcon={getIconElementLibrary}
								graphRows={graphRows}
								hasMoreCommits={pagingState?.hasMore}
								height={mainHeight}
								highlightedShas={searchHighlights}
								highlightRowsOnRefHover={graphConfig?.highlightRowsOnRefHover}
								showGhostRefsOnRowHover={graphConfig?.showGhostRefsOnRowHover}
								isLoadingRows={isLoading}
								isSelectedBySha={graphSelectedRows}
								nonce={nonce}
								onColumnResized={handleOnColumnResized}
								onSelectGraphRows={handleSelectGraphRows}
								onEmailsMissingAvatarUrls={handleMissingAvatars}
								onShowMoreCommits={handleMoreCommits}
								platform={clientPlatform}
								shaLength={graphConfig?.shaLength}
								themeOpacityFactor={styleProps.themeOpacityFactor}
								useAuthorInitialsForAvatars={!graphConfig?.avatars}
								width={mainWidth}
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
					data-vscode-context={JSON.stringify({ webviewItem: 'gitlens:graph:columns' })}
					onClick={handleToggleColumnSettings}
				>
					<span
						className="codicon codicon-settings-gear columnsettings__icon"
						aria-label="Column Settings"
					></span>
				</button>
			</main>
			<footer className={`actionbar graph-app__footer${!isAllowed ? ' is-gated' : ''}`} aria-hidden={!isAllowed}>
				<div className="actionbar__group">
					<div className="actioncombo">
						<button
							type="button"
							aria-controls="repo-actioncombo-list"
							aria-expanded={repoExpanded}
							aria-haspopup="listbox"
							id="repo-actioncombo-label"
							className="actioncombo__label"
							role="combobox"
							aria-activedescendant={
								repoExpanded
									? `repo-actioncombo-item-${reposList.findIndex(
											item => item.path === currentRepository?.path,
									  )}`
									: undefined
							}
							onClick={() => handleToggleRepos()}
						>
							<span className="codicon codicon-repo actioncombo__icon" aria-label="Repository "></span>
							{currentRepository?.formattedName ?? 'none selected'}
						</button>
						<div
							className="actioncombo__list"
							id="repo-actioncombo-list"
							role="listbox"
							tabIndex={-1}
							aria-labelledby="repo-actioncombo-label"
						>
							{reposList.length > 0 ? (
								reposList.map((item, index) => (
									<button
										type="button"
										className="actioncombo__item"
										role="option"
										data-value={item.path}
										id={`repo-actioncombo-item-${index}`}
										key={`repo-actioncombo-item-${index}`}
										aria-selected={item.path === currentRepository?.path}
										onClick={() => handleSelectRepository(item)}
										disabled={item.path === currentRepository?.path}
									>
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
					{isAllowed && graphRows.length > 0 && (
						<span className="actionbar__details">
							showing {graphRows.length} item{graphRows.length ? 's' : ''}
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
