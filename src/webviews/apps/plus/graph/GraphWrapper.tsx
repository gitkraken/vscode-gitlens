import GraphContainer, { CssVariables, GraphRow } from '@axosoft/gitkraken-components/lib/components/graph/GraphContainer';
import React, { useEffect, useState } from 'react';
import {
	CommitListCallback,
	GitBranch,
	GitCommit,
	GitRemote,
	GitTag,
	GraphColumnConfig,
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
	gitRemotes: GitRemote[] = [], // TODO: add remotes to our graphRows array
	gitTags: GitTag[] = [],
	gitBranches: GitBranch[] = []
): GraphRow[] => {
    const graphRows: GraphRow[] = [];

	// console.log('gitRemotes -> ', gitRemotes);
	// console.log('gitTags -> ', gitTags);
	// console.log('gitBranches -> ', gitBranches);

	// Copied from original pushed code of Miggy E.
	// TODO: review if that code is correct and see if we need to add more data
	for (const gitCommit of gitCommits) {
		const commitBranch = gitBranches.find(b => b.sha === gitCommit.sha);
		let branchInfo = {} as any;
		if (commitBranch != null) {
			branchInfo = {
				remotes: [
					{
						name: commitBranch.name,
						url: commitBranch.id
					}
				]
			};
			if (commitBranch.current) {
				branchInfo.heads = [
					{
						name: commitBranch.name,
						isCurrentHead: true
					}
				];
			}
		}
		const commitTag = gitTags.find(t => t.sha === gitCommit.sha);
		let tagInfo = {} as any;
		if (commitTag != null) {
			tagInfo = {
				tags: [
					{
						name: commitTag.name,
					}
				]
			};
		}

		graphRows.push({
			sha: gitCommit.sha,
			parents: gitCommit.parents,
			author: gitCommit.author.name,
			email: gitCommit.author.email,
			date: new Date(gitCommit.committer.date).getTime(),
			message: gitCommit.message,
			type: 'commit-node',
			...branchInfo,
			...tagInfo
		});
	}

    return graphRows;
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
	const [settings, setSettings] = useState(config);
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);

	function transformData(state: State) {
		setGraphList(getGraphModel(state.commits, state.remotes, state.tags, state.branches));
		setReposList(state.repositories ?? []);
		setCurrentRepository(state.selectedRepository);
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
					<ul>
						{graphList.length ? (
							<GraphContainer
								cssVariables={getCssVariables()}
								graphRows={graphList}
								hasMoreCommits={logState?.hasMore}
								isLoadingRows={isLoading}
								nonce={nonce}
								onShowMoreCommitsClicked={handleMoreCommits}
							/>
						) : (
							<li>No commits</li>
						)}
					</ul>
				</>
			) : (
				<p>No repository is selected</p>
			)}
		</>
	);
}
