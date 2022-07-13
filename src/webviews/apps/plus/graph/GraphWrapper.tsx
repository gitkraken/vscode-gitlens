import { GraphRow } from '@axosoft/gitkraken-components/lib/components/graph/GraphContainer';
import React, { useEffect, useState } from 'react';
import {
	CommitListCallback,
	GitCommit,
	GraphColumnConfig,
	Repository,
	State,
} from '../../../../plus/webviews/graph/protocol';
import { GKGraph } from './GKGraph';

export interface GraphWrapperProps extends State {
	subscriber: (callback: CommitListCallback) => () => void;
	onSelectRepository?: (repository: Repository) => void;
	onColumnChange?: (name: string, settings: GraphColumnConfig) => void;
	nonce?: string;
	onMoreCommits?: (limit?: number) => void;
}

// TODO: this needs to be replaced with a function from the Graph repo
const getGraphModel = (data: GitCommit[] = []) => data;

// eslint-disable-next-line @typescript-eslint/naming-convention
export function GraphWrapper({
	subscriber,
	commits = [],
	repositories = [],
	selectedRepository,
	config,
	log,
	onSelectRepository,
	onColumnChange,
	onMoreCommits,
	nonce
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits));
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState(selectedRepository);
	const [settings, setSettings] = useState(config);
	const [logState, setLogState] = useState(log);
	const [isLoading, setIsLoading] = useState(false);

	function transformData(state: State) {
		setGraphList(getGraphModel(state.commits));
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
					isLoading ? (
						<div>Loading...</div>
					) : (
                    <GKGraph
                    graphRows={Object.values(graphList) as GraphRow[]}
                    repo={currentRepository}
                    nonce={nonce}
                    />
                    )
			) : (
				<p>No repository is selected</p>
			)}
		</>
	);
}
