import GraphContainer, {
	type CssVariables,
	type GraphColumnSetting as GKGraphColumnSetting,
	type GraphColumnsSettings as GKGraphColumnsSettings,
	type GraphRow,
	type GraphZoneType,
	type Head,
	type Remote,
	type Tag,
} from '@gitkraken/gitkraken-components';
import type { ReactElement } from 'react';
import React, { createElement, useEffect, useRef, useState } from 'react';
import type { GraphColumnConfig } from '../../../../config';
import type {
	CommitListCallback,
	GraphBranch,
	GraphCommit,
	GraphCompositeConfig,
	GraphRemote,
	GraphRepository,
	GraphTag,
	State,
} from '../../../../plus/webviews/graph/protocol';

export interface GraphWrapperProps extends State {
	nonce?: string;
	subscriber: (callback: CommitListCallback) => () => void;
	onSelectRepository?: (repository: GraphRepository) => void;
	onColumnChange?: (name: string, settings: GraphColumnConfig) => void;
	onMoreCommits?: (limit?: number) => void;
	onDismissPreview?: () => void;
	onSelectionChange?: (selection: GraphCommit[]) => void;
}

// Copied from original pushed code of Miggy E.
// TODO: review that code as I'm not sure if it is the correct way to do that in Gitlens side.
// I suppose we need to use the GitLens themes here instead.
const getCssVariables = (mixedColumnColors: CssVariables | undefined): CssVariables => {
	const body = document.body;
	const computedStyle = window.getComputedStyle(body);

	return {
		'--app__bg0': computedStyle.getPropertyValue('--color-background'),
		'--panel__bg0': computedStyle.getPropertyValue('--graph-panel-bg'),
		'--text-selected': computedStyle.getPropertyValue('--color-foreground'),
		'--text-normal': computedStyle.getPropertyValue('--color-foreground--85'),
		'--text-secondary': computedStyle.getPropertyValue('--color-foreground--65'),
		'--text-disabled': computedStyle.getPropertyValue('--color-foreground--50'),
		'--text-accent': computedStyle.getPropertyValue('--color-link-foreground'),
		'--text-inverse': computedStyle.getPropertyValue('--vscode-input-background'),
		'--text-bright': computedStyle.getPropertyValue('--vscode-input-background'),
		...mixedColumnColors,
	};
};

const getStyleProps = (
	mixedColumnColors: CssVariables | undefined,
): { cssVariables: CssVariables; themeOpacityFactor: number } => {
	const body = document.body;
	const computedStyle = window.getComputedStyle(body);
	return {
		cssVariables: getCssVariables(mixedColumnColors),
		themeOpacityFactor: parseInt(computedStyle.getPropertyValue('--graph-theme-opacity-factor')) || 1,
	};
};

const getGraphModel = (
	gitCommits: GraphCommit[] = [],
	gitRemotes: GraphRemote[] = [],
	gitTags: GraphTag[] = [],
	gitBranches: GraphBranch[] = [],
): GraphRow[] => {
	const graphRows: GraphRow[] = [];

	// console.log('gitCommits -> ', gitCommits);
	// console.log('gitRemotes -> ', gitRemotes);
	// console.log('gitTags -> ', gitTags);
	// console.log('gitBranches -> ', gitBranches);

	// TODO: review if that code is correct and see if we need to add more data
	for (const gitCommit of gitCommits) {
		const graphRemotes: Remote[] = gitBranches
			.filter((branch: GraphBranch) => branch.sha === gitCommit.sha && branch.remote)
			.map((branch: GraphBranch) => {
				const matchingRemote: GraphRemote | undefined = gitRemotes.find((remote: GraphRemote) =>
					branch.name.startsWith(remote.name),
				);

				return {
					// If a matching remote is found, remove the remote name and slash from the branch name
					name:
						matchingRemote !== undefined ? branch.name.replace(`${matchingRemote.name}/`, '') : branch.name,
					url: matchingRemote?.url,
					avatarUrl: matchingRemote?.avatarUrl ?? undefined,
				};
			});

		const graphHeads: Head[] = gitBranches
			.filter((branch: GraphBranch) => branch.sha === gitCommit.sha && branch.remote === false)
			.map((branch: GraphBranch) => {
				return {
					name: branch.name,
					isCurrentHead: branch.current,
				};
			});

		const graphTags: Tag[] = gitTags
			.filter((tag: GraphTag) => tag.sha === gitCommit.sha)
			.map((tag: GraphTag) => ({
				name: tag.name,
				annotated: Boolean(tag.message),
			}));

		graphRows.push({
			sha: gitCommit.sha,
			parents: gitCommit.parents,
			author: gitCommit.author.name,
			email: gitCommit.author.email,
			date: new Date(gitCommit.committer.date).getTime(),
			message: gitCommit.message,
			type: gitCommit.type, // TODO: review logic for stash, wip, etc
			heads: graphHeads,
			remotes: graphRemotes,
			tags: graphTags,
		});
	}

	return graphRows;
};

const defaultGraphColumnsSettings: GKGraphColumnsSettings = {
	commitAuthorZone: { width: 110 },
	commitDateTimeZone: { width: 130 },
	commitMessageZone: { width: 130 },
	commitZone: { width: 170 },
	refZone: { width: 150 },
};

const getGraphColSettingsModel = (config?: GraphCompositeConfig): GKGraphColumnsSettings => {
	const columnsSettings: GKGraphColumnsSettings = { ...defaultGraphColumnsSettings };
	if (config?.columns !== undefined) {
		for (const column of Object.keys(config.columns)) {
			columnsSettings[column] = {
				width: config.columns[column].width,
			};
		}
	}
	return columnsSettings;
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
	const iconList = ['vm', 'cloud', 'tag', 'inbox', 'check', 'loading', 'warning'];
	const elementLibrary: { [key: string]: ReactElement<any> } = {};
	iconList.forEach(iconKey => {
		elementLibrary[iconKey] = createElement('span', { className: `codicon codicon-${iconKey}` });
	});
	return elementLibrary;
};

const iconElementLibrary = createIconElements();

const getIconElementLibrary = (iconKey: string) => {
	return iconElementLibrary[iconKey];
};

// eslint-disable-next-line @typescript-eslint/naming-convention
export function GraphWrapper({
	subscriber,
	commits = [],
	repositories = [],
	remotes = [],
	tags = [],
	branches = [],
	selectedRepository,
	config,
	log,
	onSelectRepository,
	onColumnChange,
	onMoreCommits,
	onSelectionChange,
	nonce,
	mixedColumnColors,
	previewBanner = true,
	onDismissPreview,
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits, remotes, tags, branches));
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState<GraphRepository | undefined>(
		reposList.find(item => item.path === selectedRepository),
	);
	const [graphColSettings, setGraphColSettings] = useState(getGraphColSettingsModel(config));
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);
	const [styleProps, setStyleProps] = useState(getStyleProps(mixedColumnColors));
	// TODO: application shouldn't know about the graph component's header
	const graphHeaderOffset = 24;
	const [mainWidth, setMainWidth] = useState<number>();
	const [mainHeight, setMainHeight] = useState<number>();
	const mainRef = useRef<HTMLElement>(null);
	const [showBanner, setShowBanner] = useState(previewBanner);
	// repo selection UI
	const [repoExpanded, setRepoExpanded] = useState(false);

	useEffect(() => {
		if (mainRef.current === null) {
			return;
		}

		const setDimensionsDebounced = debounceFrame((width, height) => {
			setMainWidth(Math.floor(width));
			setMainHeight(Math.floor(height) - graphHeaderOffset);
		});

		const resizeObserver = new ResizeObserver(entries => {
			entries.forEach(entry => {
				setDimensionsDebounced(entry.contentRect.width, entry.contentRect.height);
			});
		});
		resizeObserver.observe(mainRef.current);

		return () => {
			resizeObserver.disconnect();
		};
	}, [mainRef]);

	function transformData(state: State) {
		setGraphList(getGraphModel(state.commits, state.remotes, state.tags, state.branches));
		setReposList(state.repositories ?? []);
		setCurrentRepository(reposList.find(item => item.path === state.selectedRepository));
		setGraphColSettings(getGraphColSettingsModel(state.config));
		setLogState(state.log);
		setIsLoading(false);
		setStyleProps(getStyleProps(state.mixedColumnColors));
	}

	useEffect(() => {
		if (subscriber === undefined) {
			return;
		}
		return subscriber(transformData);
	}, []);

	const handleSelectRepository = (item: GraphRepository) => {
		if (item != null && item !== currentRepository) {
			onSelectRepository?.(item);
		}
		setRepoExpanded(false);
	};

	const handleToggleRepos = () => {
		if (currentRepository != null && reposList.length <= 1) return;
		setRepoExpanded(!repoExpanded);
	};

	const handleMoreCommits = () => {
		setIsLoading(true);
		onMoreCommits?.();
	};

	const handleOnColumnResized = (graphZoneType: GraphZoneType, columnSettings: GKGraphColumnSetting) => {
		onColumnChange?.(graphZoneType, { width: columnSettings.width });
	};

	const handleSelectGraphRows = (graphRows: GraphRow[]) => {
		onSelectionChange?.(graphRows);
	};

	const handleDismissBanner = () => {
		setShowBanner(false);
		onDismissPreview?.();
	};

	return (
		<>
			{showBanner && (
				<section className="graph-app__banner">
					<div className="alert">
						<span className="alert__icon codicon codicon-preview"></span>
						<div className="alert__content">
							<p className="alert__title">Preview</p>
							<p className="alert__message">
								This is a GitLens+ feature that requires a paid account for use on private repositories.
							</p>
						</div>
						<button className="alert__action" type="button" onClick={() => handleDismissBanner()}>
							<span className="codicon codicon-chrome-close"></span>
						</button>
					</div>
				</section>
			)}
			<main ref={mainRef} id="main" className="graph-app__main">
				{currentRepository !== undefined ? (
					<>
						{mainWidth !== undefined && mainHeight !== undefined && (
							<GraphContainer
								columnsSettings={graphColSettings}
								cssVariables={styleProps.cssVariables}
								// eslint-disable-next-line @typescript-eslint/ban-ts-comment
								//@ts-ignore - remove once the Graph component is updated to use the new API
								getExternalIcon={getIconElementLibrary}
								graphRows={graphList}
								height={mainHeight}
								hasMoreCommits={logState?.hasMore}
								isLoadingRows={isLoading}
								nonce={nonce}
								onColumnResized={handleOnColumnResized}
								onSelectGraphRows={handleSelectGraphRows}
								onShowMoreCommits={handleMoreCommits}
								width={mainWidth}
								themeOpacityFactor={styleProps.themeOpacityFactor}
							/>
						)}
					</>
				) : (
					<p>No repository is selected</p>
				)}
			</main>
			<footer className="actionbar graph-app__footer">
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
							aria-activedescendant=""
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
								<li
									className="actioncombo__item"
									role="option"
									id="repo-actioncombo-item-0"
									aria-selected="true"
								>
									None available
								</li>
							)}
						</div>
					</div>
					{graphList.length > 0 && (
						<span>
							{graphList.length} commit{graphList.length ? 's' : ''}
						</span>
					)}
				</div>
				<div className="actionbar__group">
					<span className="badge">Preview</span>
				</div>
			</footer>
		</>
	);
}
