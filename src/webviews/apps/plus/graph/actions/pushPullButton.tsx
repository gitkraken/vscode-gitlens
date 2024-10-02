import type { ReactNode } from 'react';
import React from 'react';
import type { BranchState, State } from '../../../../../plus/webviews/graph/protocol';
import { pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
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
		icon = 'glicon glicon-repo-pull';
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
		icon = 'glicon glicon-repo-push';
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
					<span className={`${icon} action-button__icon`}></span>
					{label}
					<span>
						<span className="pill action-button__pill">
							{isBehind && (
								<span>
									{branchState.behind}
									<span className="codicon codicon-arrow-down"></span>
								</span>
							)}
							{isAhead && (
								<span>
									{isBehind && <>&nbsp;&nbsp;</>}
									{branchState.ahead}
									<span className="codicon codicon-arrow-up"></span>
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
						<span className="codicon codicon-repo-force-push" aria-hidden="true"></span>
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
