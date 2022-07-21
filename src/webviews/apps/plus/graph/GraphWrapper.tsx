import GraphContainer, {
	CssVariables,
	GraphColumnSetting as GKGraphColumnSetting,
	GraphColumnsSettings as GKGraphColumnsSettings,
	GraphRow,
	GraphZoneType,
	Head,
	Remote,
	Tag,
} from '@gitkraken/gitkraken-components/lib/components/graph/GraphContainer';
import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import {
	CommitListCallback,
	GraphBranch,
	GraphColumnConfig,
	GraphCommit,
	GraphConfig,
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
}

// Copied from original pushed code of Miggy E.
// TODO: review that code as I'm not sure if it is the correct way to do that in Gitlens side.
// I suppose we need to use the GitLens themes here instead.
const getCssVariables = (): CssVariables => {
    const body = document.body;
    const computedStyle = window.getComputedStyle(body);

	return {
        '--app__bg0': computedStyle.getPropertyValue('--color-background'),
        '--panel__bg0': computedStyle.getPropertyValue('--graph-panel-bg'),
		'--text-selected': computedStyle.getPropertyValue('--color-foreground'),
		'--text-normal': computedStyle.getPropertyValue('--color-foreground-85'),
		'--text-secondary': computedStyle.getPropertyValue('--color-foreground-65'),
		'--text-disabled': computedStyle.getPropertyValue('--color-foreground-50'),
		'--text-accent': computedStyle.getPropertyValue('--color-link-foreground'),
		'--text-inverse': computedStyle.getPropertyValue('--vscode-input-background'),
		'--text-bright': computedStyle.getPropertyValue('--vscode-input-background'),
		... getGraphColors(computedStyle),
    };
};

const getGraphColors = (computedStyle: CSSStyleDeclaration): CssVariables => {
	// mixed colors for ref labels (ref label color + graph bg color)
	// making the ref label color transparent is not an option since ref labels overlap the ref line
	// and can potentially overlap each other, e.g., when a truncated ref is expanded.
	const mixedGraphColors: CssVariables = {};
	for (let i = 0; i < 10; i++) {
		for (const mixInt of [15,25,45,50]) {
			mixedGraphColors[`--graph-color-${i}-bg${mixInt}`] = computedStyle.getPropertyValue(`--graph-color-${i}-bg${mixInt}`);
		}
	}
	return mixedGraphColors;
};

const getGraphModel = (
	gitCommits: GraphCommit[] = [],
	_gitRemotes: GraphRemote[] = [],
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
			.filter((branch: GraphBranch) => branch.sha === gitCommit.sha)
			.map((branch: GraphBranch) => {
				return {
					name: branch.name,
					url: branch.id,
					// avatarUrl: // TODO:
				};
			});

		const graphHeads: Head[] = gitBranches
			.filter((branch: GraphBranch) => branch.sha === gitCommit.sha && branch.current)
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
				// annotated: tag.refType === 'annotatedTag' // TODO: review that. I have copied same logic of GK but I think this is not correct.
			}));

		graphRows.push({
			sha: gitCommit.sha,
			parents: gitCommit.parents,
			author: gitCommit.author.name,
			email: gitCommit.author.email,
			date: new Date(gitCommit.committer.date).getTime(),
			message: gitCommit.message,
			type: 'commit-node', // TODO: review logic for stash, wip, etc
			heads: graphHeads,
			remotes: graphRemotes,
			tags: graphTags,
		});
	}

	return graphRows;
};

const getGraphColSettingsModel = (config?: GraphConfig): GKGraphColumnsSettings => {
	const columnsSettings: GKGraphColumnsSettings = {};
	if (config?.columns !== undefined) {
		for (const key of Object.keys(config.columns)) {
			columnsSettings[key] = {
				width: config.columns[key].width || 0,
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
	nonce,
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits, remotes, tags, branches));
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState(selectedRepository);
	const [graphColSettings, setGraphColSettings] = useState(getGraphColSettingsModel(config));
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);
	const [cssVariables, setCSSVariables] = useState(getCssVariables());
	// TODO: application shouldn't know about the graph component's header
	const graphHeaderOffset = 24;
	const [mainWidth, setMainWidth] = useState<number>();
	const [mainHeight, setMainHeight] = useState<number>();
	const mainRef = useRef<HTMLElement>(null);

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
		setCurrentRepository(state.selectedRepository);
		setGraphColSettings(getGraphColSettingsModel(state.config));
		setLogState(state.log);
		setIsLoading(false);
		setCSSVariables(getCssVariables());
	}

	useEffect(() => {
		if (subscriber === undefined) {
			return;
		}
		return subscriber(transformData);
	}, []);

	const handleSelectRepository = (event: ChangeEvent<HTMLSelectElement>) => {
		if (onSelectRepository !== undefined) {
			const item = reposList.find(repo => repo.path === event.target.value);
			item != null && onSelectRepository(item);
		}
	};

	const handleMoreCommits = () => {
		setIsLoading(true);
		onMoreCommits?.();
	};

	const handleOnColumnResized = (graphZoneType: GraphZoneType, columnSettings: GKGraphColumnSetting) => {
		if (onColumnChange !== undefined) {
			onColumnChange(graphZoneType, { width: columnSettings.width });
		}
	};

	return (
		<>
			<header className="graph-app__header">
				<h2>Repository: {reposList.length === 0 ? 'none available' : currentRepository ?? 'unselected'}</h2>
				{reposList.length > 0 && (
					<div>
						<label htmlFor="repo-picker">Switch</label>{' '}
						<select
							name="repo-picker"
							id="repo-picker"
							value={currentRepository}
							onChange={handleSelectRepository}
						>
							{reposList.map((item, index) => (
								<option value={item.path} key={`repos-${index}`}>
									{item.formattedName}
								</option>
							))}
						</select>
					</div>
				)}
			</header>
			<main ref={mainRef} id="main" className="graph-app__main">
				{currentRepository !== undefined ? (
					<>
						{mainWidth !== undefined && mainHeight !== undefined && (
							<GraphContainer
								columnsSettings={graphColSettings}
								cssVariables={cssVariables}
								graphRows={graphList}
								height={mainHeight}
								hasMoreCommits={logState?.hasMore}
								isLoadingRows={isLoading}
								nonce={nonce}
								onColumnResized={handleOnColumnResized}
								onShowMoreCommitsClicked={handleMoreCommits}
								width={mainWidth}
							/>
						)}
					</>
				) : (
					<p>No repository is selected</p>
				)}
			</main>
		</>
	);
}
