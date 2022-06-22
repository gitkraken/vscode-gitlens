import React, { useEffect, useState } from 'react';
import {
	CommitListCallback,
	GitCommit,
	GraphColumnConfig,
	Repository,
	State,
} from '../../../../plus/webviews/graph/protocol';

export interface GraphWrapperProps extends State {
	subscriber: (callback: CommitListCallback) => () => void;
	onSelectRepository?: (repository: Repository) => void;
	onColumnChange?: (name: string, settings: GraphColumnConfig) => void;
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
	onSelectRepository,
	onColumnChange,
}: GraphWrapperProps) {
	const [graphList, setGraphList] = useState(getGraphModel(commits));
	const [reposList, setReposList] = useState(repositories);
	const [currentRepository, setCurrentRepository] = useState(selectedRepository);
	const [settings, setSettings] = useState(config);

	function transformData(state: State) {
		setGraphList(getGraphModel(state.commits));
		setReposList(state.repositories ?? []);
		setCurrentRepository(state.selectedRepository);
		setSettings(state.config);
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
				<ul>
					{graphList.length ? (
						graphList.map((item, index) => <li key={`commits-${index}`}>{JSON.stringify(item)}</li>)
					) : (
						<li>No commits</li>
					)}
				</ul>
			) : (
				<p>No repository is selected</p>
			)}
		</>
	);
}
