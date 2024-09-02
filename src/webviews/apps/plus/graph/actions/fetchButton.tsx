import type { ReactNode } from 'react';
import React from 'react';
import type { BranchState, State } from '../../../../../plus/webviews/graph/protocol';
import { createWebviewCommandLink } from '../../../../../system/webview';
import { GlTooltip } from '../../../shared/components/overlays/tooltip.react';

export const FetchButton = ({
	state,
	fetchedText,
	branchState,
	remote,
}: {
	branchState: BranchState | undefined;
	state: State;
	fetchedText: string | undefined;
	remote: ReactNode;
}) => {
	return (
		<GlTooltip placement="bottom">
			<a
				href={createWebviewCommandLink('gitlens.graph.fetch', state.webviewId, state.webviewInstanceId)}
				className="action-button"
			>
				<span className="glicon glicon-repo-fetch action-button__icon"></span>
				Fetch {fetchedText && <span className="action-button__small">({fetchedText})</span>}
			</a>
			<span slot="content" style={{ whiteSpace: 'break-spaces' }}>
				Fetch from {remote}
				{branchState?.provider?.name ? ` on ${branchState.provider?.name}` : ''}
				{fetchedText && (
					<>
						<hr /> Last fetched {fetchedText}
					</>
				)}
			</span>
		</GlTooltip>
	);
};
