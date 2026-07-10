import type { GlCommands } from '../../../constants.commands.js';
import type {
	GraphSidebarBranchesActionName,
	GraphSidebarRemotesActionName,
	GraphSidebarStashesActionName,
	GraphSidebarTagsActionName,
	GraphSidebarWorktreesActionName,
} from '../../../constants.telemetry.js';

/**
 * Marker set on a webview-item context by the inline (webview→RPC) action path (see
 * `onSidebarAction` in graphWebview.ts) so the context-menu telemetry wrapper can skip it — the
 * webview already emitted that action with `location: 'inline'`. Native right-click menu
 * invocations dispatch straight to the command via VS Code and never pass through that path, so
 * their context lacks the marker and the wrapper emits `location: 'contextMenu'`.
 *
 * A Symbol keeps it off enumeration/JSON and away from the `WebviewItemContext` fields handlers read.
 * It survives the in-process `vscode.commands.executeCommand` hop (args pass by reference).
 */
export const sidebarInlineActionMarker: unique symbol = Symbol('gl.graph.sidebar.inlineAction');

/**
 * Returns whether an invocation context originated from a graph SIDEBAR item. Required because
 * `gitlens:branch`/`gitlens:tag`/`gitlens:stash` contexts are not sidebar-exclusive — the main
 * graph's ref pills (graphRowProcessor.ts) and the WIP details-header kebab (graphWebview.ts)
 * produce the same `webviewItem` types and dispatch the same commands through the same registered
 * handlers. Without this gate, sidebar `*Action{location:'contextMenu'}` events would be dominated
 * by graph-canvas ref-pill right-clicks. The sidebar builders (`getSidebar*` in graphWebview.ts)
 * stamp `webviewItemOrigin: 'sidebar'` on their item contexts; other surfaces don't.
 */
export function isSidebarOriginContext(context: unknown): boolean {
	return (
		context != null &&
		typeof context === 'object' &&
		(context as { webviewItemOrigin?: unknown }).webviewItemOrigin === 'sidebar'
	);
}

/**
 * Resolved context-menu action, discriminated by panel so callers can emit the matching
 * `graph/{panel}/{item}Action` event with a correctly-typed `action`.
 */
export type ResolvedSidebarContextMenuAction =
	| { type: 'branch'; action: GraphSidebarBranchesActionName }
	| { type: 'remote'; action: GraphSidebarRemotesActionName }
	| { type: 'worktree'; action: GraphSidebarWorktreesActionName }
	| { type: 'tag'; action: GraphSidebarTagsActionName }
	| { type: 'stash'; action: GraphSidebarStashesActionName };

// Curated command → action maps, keyed by the resolved graph command id (`:graph` / `gitlens.graph.*`).
// Only management actions are mapped; commands with their own telemetry domain (ai.*, compose,
// compare) and view-state toggles (hide/solo/pin) are intentionally omitted. Shared command ids
// (e.g. `gitlens.fetch:graph`, `gitlens.graph.renameBranch`) appear under every item type they're
// contributed to, so resolution keys off the item type first, then the command.

const branchActions: Partial<Record<GlCommands, GraphSidebarBranchesActionName>> = {
	'gitlens.switchToBranch:graph': 'switch',
	'gitlens.switchToAnotherBranch:graph': 'switch',
	'gitlens.fetch:graph': 'fetch',
	'gitlens.graph.pull': 'pull',
	'gitlens.graph.push': 'push',
	'gitlens.openWorktree:graph': 'openWorktree',
	'gitlens.openWorktreeInNewWindow:graph': 'openWorktreeInNewWindow',
	'gitlens.graph.deleteBranch': 'delete',
	'gitlens.graph.renameBranch': 'rename',
	'gitlens.graph.mergeBranchInto': 'merge',
	'gitlens.graph.rebaseOntoBranch': 'rebaseOntoBranch',
	'gitlens.graph.rebaseOntoUpstream': 'rebaseOntoUpstream',
	'gitlens.graph.resetToTip': 'reset',
	'gitlens.publishBranch:graph': 'publish',
	'gitlens.setUpstream:graph': 'setUpstream',
	'gitlens.changeUpstream:graph': 'changeUpstream',
};

const remoteActions: Partial<Record<GlCommands, GraphSidebarRemotesActionName>> = {
	'gitlens.fetchRemote:graph': 'fetch',
	'gitlens.openRepoOnRemote:graph': 'openOnRemote',
	'gitlens.copyRemoteRepositoryUrl:graph': 'copyUrl',
	'gitlens.connectRemoteProvider:graph': 'connectIntegration',
	'gitlens.disconnectRemoteProvider:graph': 'disconnectIntegration',
	'gitlens.openBranchesOnRemote:graph': 'openBranchesOnRemote',
	'gitlens.copyRemoteBranchesUrl:graph': 'copyBranchesUrl',
	'gitlens.pruneRemote:graph': 'prune',
	'gitlens.removeRemote:graph': 'remove',
	'gitlens.setRemoteAsDefault:graph': 'setDefault',
	'gitlens.unsetRemoteAsDefault:graph': 'unsetDefault',
};

const worktreeActions: Partial<Record<GlCommands, GraphSidebarWorktreesActionName>> = {
	'gitlens.graph.pull': 'pull',
	'gitlens.graph.push': 'push',
	'gitlens.fetch:graph': 'fetch',
	'gitlens.openWorktree:graph': 'openWorktree',
	'gitlens.openWorktreeInNewWindow:graph': 'openWorktreeInNewWindow',
	'gitlens.graph.deleteWorktree': 'delete',
	'gitlens.graph.revealWorktreeInExplorer': 'revealInExplorer',
	'gitlens.openInIntegratedTerminal:graph': 'openInTerminal',
	'gitlens.copyWorkingChangesToWorktree:graph': 'copyWorkingChanges',
	'gitlens.graph.renameBranch': 'rename',
	'gitlens.publishBranch:graph': 'publish',
	'gitlens.setUpstream:graph': 'setUpstream',
	'gitlens.changeUpstream:graph': 'changeUpstream',
	'gitlens.graph.resetToTip': 'reset',
	'gitlens.graph.rebaseOntoUpstream': 'rebaseOntoUpstream',
};

const tagActions: Partial<Record<GlCommands, GraphSidebarTagsActionName>> = {
	'gitlens.graph.switchToTag': 'switchTo',
	'gitlens.graph.deleteTag': 'delete',
	'gitlens.createBranch:graph': 'createBranch',
	'gitlens.graph.resetToTag': 'reset',
};

const stashActions: Partial<Record<GlCommands, GraphSidebarStashesActionName>> = {
	'gitlens.stashApply:graph': 'apply',
	'gitlens.stashDelete:graph': 'delete',
	'gitlens.stashRename:graph': 'rename',
};

/** Parse the sidebar item type from a `webviewItem` context string (e.g. `gitlens:branch+current`). */
function parseItemType(webviewItem: string | undefined): ResolvedSidebarContextMenuAction['type'] | undefined {
	const match = webviewItem != null ? /^gitlens:(branch|remote|worktree|tag|stash)\b/.exec(webviewItem) : null;
	return match?.[1] as ResolvedSidebarContextMenuAction['type'] | undefined;
}

/**
 * Resolve the telemetry action for a context-menu command invoked on a sidebar item, keyed by the
 * item type (`webviewItem`) then the resolved command id. Returns undefined when the item type has
 * no context-menu telemetry or the command isn't in the curated set.
 */
export function resolveSidebarContextMenuAction(
	command: string,
	webviewItem: string | undefined,
): ResolvedSidebarContextMenuAction | undefined {
	const type = parseItemType(webviewItem);
	switch (type) {
		case 'branch': {
			const action = branchActions[command as GlCommands];
			return action != null ? { type: 'branch', action: action } : undefined;
		}
		case 'remote': {
			const action = remoteActions[command as GlCommands];
			return action != null ? { type: 'remote', action: action } : undefined;
		}
		case 'worktree': {
			const action = worktreeActions[command as GlCommands];
			return action != null ? { type: 'worktree', action: action } : undefined;
		}
		case 'tag': {
			const action = tagActions[command as GlCommands];
			return action != null ? { type: 'tag', action: action } : undefined;
		}
		case 'stash': {
			const action = stashActions[command as GlCommands];
			return action != null ? { type: 'stash', action: action } : undefined;
		}
		default:
			return undefined;
	}
}
