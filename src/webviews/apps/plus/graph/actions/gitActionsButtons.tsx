import React from 'react';
import { fromNow } from '../../../../../system/date';
import type { BranchState, State } from '../../../../plus/graph/protocol';
import { FetchButton } from './fetchButton';
import { PushPullButton } from './pushPullButton';

export const GitActionsButtons = ({
	branchState,
	branchName,
	lastFetched,
	state,
}: {
	branchState: BranchState | undefined;
	branchName: string | undefined;
	lastFetched: Date | undefined;
	state: State;
}) => {
	const remote = branchState?.upstream ? <span className="md-code">{branchState?.upstream}</span> : 'remote';

	const lastFetchedDate = lastFetched && new Date(lastFetched);
	const fetchedText = lastFetchedDate && lastFetchedDate.getTime() !== 0 ? fromNow(lastFetchedDate) : undefined;

	return (
		<>
			<PushPullButton
				branchState={branchState}
				state={state}
				fetchedText={fetchedText}
				branchName={branchName}
				remote={remote}
			/>
			<FetchButton branchState={branchState} fetchedText={fetchedText} remote={remote} state={state} />
		</>
	);
};
