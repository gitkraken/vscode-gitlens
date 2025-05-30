import type { OnFormatCommitDateTime } from '@gitkraken/gitkraken-components';
import GraphContainer, {
	type CssVariables,
	type GraphColumnSetting as GKGraphColumnSetting,
	type GraphColumnsSettings as GKGraphColumnsSettings,
	type GraphPlatform,
	type GraphRow,
	type GraphZoneType,
} from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, useEffect, useRef, useState } from 'react';
import { getPlatform } from '@env/platform';
import { DateStyle } from '../../../../config';
import type { GraphColumnConfig } from '../../../../config';
import { RepositoryVisibility } from '../../../../git/gitProvider';
import type { GitGraphRowType } from '../../../../git/models/graph';
import type {
	DismissBannerParams,
	GraphComponentConfig,
	GraphRepository,
	State,
	UpdateStateCallback,
} from '../../../../plus/webviews/graph/protocol';
import type { Subscription } from '../../../../subscription';
import { getSubscriptionTimeRemaining, SubscriptionState } from '../../../../subscription';
import { pluralize } from '../../../../system/string';
import type { DateTimeFormat } from '../../shared/date';
import { formatDate, fromNow } from '../../shared/date';

export interface GraphWrapperProps extends State {
	nonce?: string;
	subscriber: (callback: UpdateStateCallback) => () => void;
	onSelectRepository?: (repository: GraphRepository) => void;
	onColumnChange?: (name: string, settings: GraphColumnConfig) => void;
	onMissingAvatars?: (emails: { [email: string]: string }) => void;
	onMoreCommits?: () => void;
	onDismissBanner?: (key: DismissBannerParams['key']) => void;
	onSelectionChange?: (selection: { id: string; type: GitGraphRowType }[]) => void;
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

const defaultGraphColumnsSettings: GKGraphColumnsSettings = {
	commitAuthorZone: { width: 110, isHidden: false },
	commitDateTimeZone: { width: 130, isHidden: false },
	commitMessageZone: { width: 130, isHidden: false },
	commitZone: { width: 170, isHidden: false },
	refZone: { width: 150, isHidden: false },
};

const getGraphColSettingsModel = (config?: GraphComponentConfig): GKGraphColumnsSettings => {
	const columnsSettings: GKGraphColumnsSettings = { ...defaultGraphColumnsSettings };
	if (config?.columns !== undefined) {
		for (const column of Object.keys(config.columns)) {
			columnsSettings[column] = {
				width: config.columns[column].width,
				isHidden: config.columns[column].isHidden,
			};
		}
	}
	return columnsSettings;
};

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

const graphColumns: {[Key in GraphZoneType]: {name: string; hideable: boolean}} = {
	refZone: {
		name: 'Branch / Tag',
		hideable: false,
	},
	commitZone: {
		name: 'Graph',
		hideable: false,
	},
	commitMessageZone: {
		name: 'Commit Message',
		hideable: false,
	},
	commitAuthorZone: {
		name: 'Author',
		hideable: true,
	},
	commitDateTimeZone: {
		name: 'Commit Date / Time',
		hideable: true,
	},
	commitShaZone: {
		name: 'Sha',
		hideable: true,
	},
};

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
	config,
	loading,
	paging,
	onSelectRepository,
	onColumnChange,
	onMissingAvatars,
	onMoreCommits,
	onSelectionChange,
	nonce,
	mixedColumnColors,
	previewBanner = true,
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
	const [graphColSettings, setGraphColSettings] = useState(getGraphColSettingsModel(config));
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
	// column setting UI
	const [columnSettingsExpanded, setColumnSettingsExpanded] = useState(false);

	useEffect(() => {
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
		setSelectedRows(state.selectedRows);
		setGraphConfig(state.config);
		// setGraphDateFormatter(getGraphDateFormatter(config));
		setGraphColSettings(getGraphColSettingsModel(state.config));
		setPagingState(state.paging);
		setStyleProps(getStyleProps(state.mixedColumnColors));
		setIsAllowed(state.allowed ?? false);
		setShowAccount(state.trialBanner ?? true);
		setSubscriptionSnapshot(state.subscription);
		setIsPrivateRepo(state.selectedRepositoryVisibility === RepositoryVisibility.Private);
		setIsLoading(state.loading);
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

	const handleSelectColumn = (graphZoneType: GraphZoneType) => {
		onColumnChange?.(graphZoneType, {
			...graphColSettings[graphZoneType],
			isHidden: !graphColSettings[graphZoneType]?.isHidden,
		});
	};

	const handleToggleColumnSettings = () => {
		setColumnSettingsExpanded(!columnSettingsExpanded);
	};

	const handleMoreCommits = () => {
		setIsLoading(true);
		onMoreCommits?.();
	};

	const handleOnColumnResized = (graphZoneType: GraphZoneType, columnSettings: GKGraphColumnSetting) => {
		if (columnSettings.width) {
			onColumnChange?.(graphZoneType, {
				width: columnSettings.width,
				isHidden: columnSettings.isHidden,
			});
		}
	};

	const handleSelectGraphRows = (graphRows: GraphRow[]) => {
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
								columnsSettings={graphColSettings}
								cssVariables={styleProps.cssVariables}
								enableMultiSelection={graphConfig?.enableMultiSelection}
								formatCommitDateTime={getGraphDateFormatter(graphConfig)}
								getExternalIcon={getIconElementLibrary}
								graphRows={graphRows}
								hasMoreCommits={pagingState?.more}
								height={mainHeight}
								// highlightRowssOnRefHover={graphConfig?.highlightRowsOnRefHover}
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
					<div className="actioncombo">
						<button
							type="button"
							aria-controls="repo-columnsettings-list"
							aria-expanded={columnSettingsExpanded}
							aria-haspopup="listbox"
							id="columns-actioncombo-label"
							className="actioncombo__label"
							role="combobox"
							onClick={() => handleToggleColumnSettings()}
						>
							<span className="codicon codicon-settings-gear columnsettings__icon" aria-label="Column Settings"></span>
						</button>
						<div
							className="actioncombo__list"
							id="columns-actioncombo-list"
							role="listbox"
							tabIndex={-1}
							aria-labelledby="columns-actioncombo-label"
						>
							{
								Object.entries(graphColumns).map(([graphZoneType, column]) => column.hideable && (
									<span
										className="actioncombo__item"
										role="option"
										data-value={graphZoneType}
										id={`column-actioncombo-item-${graphZoneType}`}
										key={`column-actioncombo-item-${graphZoneType}`}
										aria-checked={false}
										onClick={() => handleSelectColumn(graphZoneType as GraphZoneType)}
									>
										{column.name} {!graphColSettings[graphZoneType]?.isHidden && <span className='icon--check' />}
									</span>
								))
							}
						</div>
					</div>
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
