import GraphContainer, {
	CssVariables,
	GraphColumnSetting as GKGraphColumnSetting,
	GraphColumnsSettings as GKGraphColumnsSettings,
	GraphRow,
	GraphZoneType,
	Head,
	Remote,
	Tag
} from '@gitkraken/gitkraken-components/lib/components/graph/GraphContainer';
import React, { useEffect, useState } from 'react';
import {
	CommitListCallback,
	GitBranch,
	GitCommit,
	GitRemote,
	GitTag,
	GraphColumnConfig,
	GraphConfig,
	Repository,
	State,
} from '../../../../plus/webviews/graph/protocol';

export interface GraphWrapperProps extends State {
	nonce?: string;
	subscriber: (callback: CommitListCallback) => () => void;
	onSelectRepository?: (repository: Repository) => void;
	onColumnChange?: (name: string, settings: GraphColumnConfig) => void;
	onMoreCommits?: (limit?: number) => void;
}

// Copied from original pushed code of Miggy E.
// TODO: review that code as I'm not sure if it is the correct way to do that in Gitlens side.
// I suppose we need to use the GitLens themes here instead.
export const getCssVariables = (): CssVariables => {
    const body = document.body;
    const computedStyle = window.getComputedStyle(body);
    return {
        '--app__bg0': computedStyle.getPropertyValue('--color-background'),
        // note that we should probably do something theme-related here, (dark theme we lighten, light theme we darken)
        '--panel__bg0':computedStyle.getPropertyValue('--color-background--lighten-05'),
    };
};

const getGraphModel = (
	gitCommits: GitCommit[] = [],
	gitRemotes: GitRemote[] = [],
	gitTags: GitTag[] = [],
	gitBranches: GitBranch[] = []
): GraphRow[] => {
    const graphRows: GraphRow[] = [];

	// console.log('gitCommits -> ', gitCommits);
	// console.log('gitRemotes -> ', gitRemotes);
	// console.log('gitTags -> ', gitTags);
	// console.log('gitBranches -> ', gitBranches);

	// TODO: review if that code is correct and see if we need to add more data
	for (const gitCommit of gitCommits) {
		const graphRemotes: Remote[] = gitBranches.filter(
			(branch: GitBranch) => branch.sha === gitCommit.sha
		).map((branch: GitBranch) => {
			return {
				name: branch.name,
				url: branch.id
				// avatarUrl: // TODO:
			};
		});

		const graphHeads: Head[] = gitBranches.filter(
			(branch: GitBranch) => branch.sha === gitCommit.sha && branch.current
		).map((branch: GitBranch) => {
			return {
				name: branch.name,
				isCurrentHead: branch.current
			};
		});

		const graphTags: Tag[] = gitTags.filter(
			(tag: GitTag) => tag.sha === gitCommit.sha
		).map((tag: GitTag) => ({
			name: tag.name
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
			tags: graphTags
		});
	}

    return graphRows;
};

const getGraphColSettingsModel = (config?: GraphConfig): GKGraphColumnsSettings => {
	const columnsSettings: GKGraphColumnsSettings = {};
	if (config?.columns !== undefined) {
		for (const key of Object.keys(config.columns)) {
			columnsSettings[key] = {
				width: config.columns[key].width || 0
			};
		}
	}
	return columnsSettings;
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
	nonce
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits, remotes, tags, branches));
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState(selectedRepository);
	const [graphColSettings, setGraphColSettings] = useState(getGraphColSettingsModel(config));
	const [settings, setSettings] = useState(config);
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);

	function transformData(state: State) {
		setGraphList(getGraphModel(state.commits, state.remotes, state.tags, state.branches));
		setReposList(state.repositories ?? []);
		setCurrentRepository(state.selectedRepository);
		setGraphColSettings(getGraphColSettingsModel(state.config));
		setSettings(state.config);
		setLogState(state.log);
		setIsLoading(false);
	}

	useEffect(() => {
		if (subscriber === undefined) {
			return;
		}
		return subscriber(transformData);
	}, []);

	const handleSelectRepository = (item: GitCommit) => {
		if (onSelectRepository !== undefined) {
			onSelectRepository(item);
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
			<ul>
				{reposList.length ? (
					reposList.map((item, index) => (
						<li onClick={() => handleSelectRepository(item)} key={`repos-${index}`}>
							{item.path === currentRepository ? '(selected)' : ''}
							{JSON.stringify(item)}
						</li>
					))
				) : (
					<li>No repos</li>
				)}
			</ul>
			{currentRepository !== undefined ? (
				<>
					<h2>Repository: {currentRepository}</h2>
					<GraphContainer
						columnsSettings={graphColSettings}
						cssVariables={getCssVariables()}
						graphRows={graphList}
						hasMoreCommits={logState?.hasMore}
						isLoadingRows={isLoading}
						nonce={nonce}
						onColumnResized={handleOnColumnResized}
						onShowMoreCommitsClicked={handleMoreCommits}
					/>
				</>
			) : (
				<p>No repository is selected</p>
			)}
		</>
	);
}
