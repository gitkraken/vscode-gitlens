import type { ReactNode } from 'react';
import React from 'react';
import { pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
import type { BranchState, State } from '../../../../plus/graph/protocol';
import { CodeIcon } from '../../../shared/components/code-icon.react';
import { GlTooltip } from '../../../shared/components/overlays/tooltip.react';

export const PushPullButton = ({
	branchState,
	state,
	fetchedText,
	branchName,
	remote,
}: {
	branchState: BranchState | undefined;
	state: State;
	fetchedText: string | undefined;
	branchName: string | undefined;
	remote: ReactNode;
}) => {
	let isBehind = false;
	let isAhead = false;
	if (branchState) {
		isBehind = branchState.behind > 0;
		isAhead = branchState.ahead > 0;
	}

	if (!branchState || (!isAhead && !isBehind)) {
		return null;
	}

	let action: 'pull' | 'push';
	let icon: string;
	let label: string;
	let tooltip: ReactNode;

	const branchPrefix = (
		<>
			<span className="md-code">{branchName}</span> is
		</>
	);

	if (isBehind) {
		action = 'pull';
		icon = 'repo-pull';
		label = 'Pull';
		tooltip = (
			<>
				Pull {pluralize('commit', branchState.behind)} from {remote}
				{branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}
			</>
		);
		if (isAhead) {
			tooltip = (
				<>
					{tooltip}
					<hr />
					{branchPrefix} {pluralize('commit', branchState.behind)} behind and{' '}
					{pluralize('commit', branchState.ahead)} ahead of {remote}
					{branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}
				</>
			);
		} else {
			tooltip = (
				<>
					{tooltip}
					<hr />
					{branchPrefix} {pluralize('commit', branchState.behind)} behind {remote}
					{branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}
				</>
			);
		}
	} else {
		action = 'push';
		icon = 'repo-push';
		label = 'Push';
		tooltip = (
			<>
				Push {pluralize('commit', branchState.ahead)} to {remote}
				{branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}
				<hr />
				{branchPrefix} {pluralize('commit', branchState.ahead)} ahead of {remote}
			</>
		);
	}

	return (
		<>
			<GlTooltip placement="bottom">
				<a
					href={createWebviewCommandLink(`gitlens.graph.${action}`, state.webviewId, state.webviewInstanceId)}
					className={`action-button${isBehind ? ' is-behind' : ''}${isAhead ? ' is-ahead' : ''}`}
				>
					<CodeIcon className="action-button__icon" icon={icon} />
					{label}
					<span>
						<span className="pill action-button__pill">
							{isBehind && (
								<span>
									{branchState.behind}
									<CodeIcon icon="arrow-down" />
								</span>
							)}
							{isAhead && (
								<span>
									{isBehind && <>&nbsp;&nbsp;</>}
									{branchState.ahead}
									<CodeIcon icon="arrow-up" />
								</span>
							)}
						</span>
					</span>
				</a>
				<div slot="content" style={{ whiteSpace: 'break-spaces' }}>
					{tooltip}
					{fetchedText && (
						<>
							<hr /> Last fetched {fetchedText}
						</>
					)}
				</div>
			</GlTooltip>
			{isAhead && isBehind && (
				<GlTooltip placement="top" slot="anchor">
					<a
						href={createWebviewCommandLink(
							'gitlens.graph.pushWithForce',
							state.webviewId,
							state.webviewInstanceId,
						)}
						className="action-button"
						aria-label="Force Push"
					>
						<CodeIcon icon="repo-force-push" aria-hidden="true" />
					</a>
					<span slot="content">
						Force Push {pluralize('commit', branchState.ahead)} to {remote}
						{branchState.provider?.name ? ` on ${branchState.provider?.name}` : ''}
					</span>
				</GlTooltip>
			)}
		</>
	);
};
