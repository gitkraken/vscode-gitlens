import type { ReactNode } from 'react';
import React from 'react';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { BranchState, State } from '../../../../plus/graph/protocol';
import { CodeIcon } from '../../../shared/components/code-icon.react';
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
				<CodeIcon className="action-button__icon" icon="repo-fetch" />
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
