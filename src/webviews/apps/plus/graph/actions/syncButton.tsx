import type { ReactNode } from 'react';
import React from 'react';
import type { BranchState, State } from '../../../../../plus/webviews/graph/protocol';
import { pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
import { MenuItem, MenuLabel, MenuList } from '../../../shared/components/menu/react';
import { PopMenu } from '../../../shared/components/overlays/pop-menu/react';
import { GlTooltip } from '../../../shared/components/overlays/tooltip.react';

export const SyncButton = ({
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
	const isBehind = Boolean(branchState?.behind);
	const isAhead = Boolean(branchState?.ahead);
	const hasChanges = isAhead || isBehind;
	if (!hasChanges || !branchState) {
		return null;
	}

	let action: 'pull' | 'push' | 'sync' = 'sync';
	let icon = 'codicon codicon-repo-sync';
	let label = 'Fetch';
	let tooltip;

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
			action = 'sync';
			icon = 'codicon codicon-repo-sync';
			label = 'Sync';
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
	} else if (isAhead) {
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
		<span className="button-group">
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
				<GlTooltip placement="top" distance={7}>
					<PopMenu position="right">
						<button type="button" className="action-button" slot="trigger" aria-label="Minimap Options">
							<span
								className="codicon codicon-chevron-down action-button__more"
								aria-hidden="true"
							></span>
						</button>
						<MenuList slot="content" style={{ width: 120 }}>
							<MenuLabel>Git actions</MenuLabel>
							<GlTooltip>
								<MenuItem>
									<a
										href={createWebviewCommandLink(
											'gitlens.graph.sync',
											state.webviewId,
											state.webviewInstanceId,
										)}
									>
										Sync
									</a>
								</MenuItem>
								<span slot="content">Run pull then push</span>
							</GlTooltip>
							<MenuItem>
								<a
									href={createWebviewCommandLink(
										'gitlens.graph.pull',
										state.webviewId,
										state.webviewInstanceId,
									)}
								>
									Pull...
								</a>
							</MenuItem>
							<MenuItem>
								<a
									href={createWebviewCommandLink(
										'gitlens.graph.push',
										state.webviewId,
										state.webviewInstanceId,
									)}
								>
									Push...
								</a>
							</MenuItem>
						</MenuList>
					</PopMenu>
					<span slot="content">Git Sync Options</span>
				</GlTooltip>
			)}
		</span>
	);
};
