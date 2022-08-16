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
import React, { useEffect, useRef, useState } from 'react';
import type {
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

				const matchingRemoteUrl: string | undefined =
					matchingRemote !== undefined && matchingRemote.urls.length > 0 ? matchingRemote.urls[0] : undefined;

				return {
					// If a matching remote is found, remove the remote name and slash from the branch name
					name:
						matchingRemote !== undefined ? branch.name.replace(`${matchingRemote.name}/`, '') : branch.name,
					url: matchingRemoteUrl,
					// TODO: Add avatarUrl support for remotes
					// avatarUrl: matchingRemote?.avatarUrl ?? undefined
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

const getGraphColSettingsModel = (config?: GraphConfig): GKGraphColumnsSettings => {
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
	// onSelectRepository,
	onColumnChange,
	onMoreCommits,
	nonce,
	mixedColumnColors,
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits, remotes, tags, branches));
	const [_reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState(selectedRepository);
	const [graphColSettings, setGraphColSettings] = useState(getGraphColSettingsModel(config));
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);
	const [styleProps, setStyleProps] = useState(getStyleProps(mixedColumnColors));
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
		setStyleProps(getStyleProps(state.mixedColumnColors));
	}

	useEffect(() => {
		if (subscriber === undefined) {
			return;
		}
		return subscriber(transformData);
	}, []);

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
		<main ref={mainRef} id="main" className="graph-app__main">
			{currentRepository !== undefined ? (
				<>
					{mainWidth !== undefined && mainHeight !== undefined && (
						<GraphContainer
							columnsSettings={graphColSettings}
							cssVariables={styleProps.cssVariables}
							graphRows={graphList}
							height={mainHeight}
							hasMoreCommits={logState?.hasMore}
							isLoadingRows={isLoading}
							nonce={nonce}
							onColumnResized={handleOnColumnResized}
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
	);
}
