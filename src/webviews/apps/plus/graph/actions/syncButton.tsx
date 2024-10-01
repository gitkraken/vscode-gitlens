import type { ReactNode } from 'react';
import React from 'react';
import type { BranchState, State } from '../../../../../plus/webviews/graph/protocol';
import { pluralize } from '../../../../../system/string';
import { createWebviewCommandLink } from '../../../../../system/webview';
import { MenuItem, MenuLabel } from '../../../shared/components/menu/react';
import { GlPopover } from '../../../shared/components/overlays/popover.react';
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
				<GlPopover className="popover" placement="bottom-start" trigger="focus" arrow={false} distance={0}>
					<GlTooltip placement="top" slot="anchor">
						<button type="button" className="action-button" aria-label="Branch Actions">
							<span
								className="codicon codicon-chevron-down action-button__more"
								aria-hidden="true"
							></span>
						</button>
						<span slot="content">Branch Actions</span>
					</GlTooltip>
					<div slot="content">
						<MenuLabel>Branch actions</MenuLabel>
						<MenuItem
							href={createWebviewCommandLink(
								'gitlens.graph.pushWithForce',
								state.webviewId,
								state.webviewInstanceId,
							)}
						>
							Push (force)
						</MenuItem>
					</div>
				</GlPopover>
			)}
		</span>
	);
};
