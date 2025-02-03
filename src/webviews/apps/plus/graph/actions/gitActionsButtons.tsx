import React, { useEffect, useState } from 'react';
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
}): React.JSX.Element => {
	const remote = branchState?.upstream ? <span className="md-code">{branchState?.upstream}</span> : 'remote';

	const lastFetchedDate = lastFetched && new Date(lastFetched);
	const [fetchedText, setFetchedText] = useState(
		lastFetchedDate && lastFetchedDate.getTime() !== 0 ? fromNow(lastFetchedDate) : undefined,
	);
	useEffect(() => {
		if (!lastFetchedDate) {
			return;
		}
		const deltaSeconds = (new Date().getTime() - lastFetchedDate.getTime()) / 1000;
		const delay = deltaSeconds < 60 ? 1000 : deltaSeconds < 60 * 60 ? 60000 : undefined;
		if (!delay) {
			return;
		}
		const timeout = setTimeout(() => {
			setFetchedText(fromNow(lastFetchedDate));
		}, delay);
		return () => {
			clearTimeout(timeout);
		};
	}, [lastFetchedDate]);

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
