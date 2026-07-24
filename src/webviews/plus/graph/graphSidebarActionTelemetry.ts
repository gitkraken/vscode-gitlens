import type { GlCommands } from '../../../constants.commands.js';
import type {
	GraphSidebarBranchesActionName,
	GraphSidebarRemotesActionName,
	GraphSidebarStashesActionName,
	GraphSidebarTagsActionName,
	GraphSidebarWorktreesActionName,
} from '../../../constants.telemetry.js';
import { sidebarInlineItemOrigin, sidebarItemOrigin } from './protocol.js';

/** Sidebar item types that carry `graph/{panel}/{item}Action` telemetry. */
export type SidebarItemType = 'branch' | 'remote' | 'worktree' | 'tag' | 'stash';

/**
 * Single source of truth mapping command ids → telemetry action names, per sidebar item type.
 *
 * Consumed by BOTH emit surfaces — the webview's inline (hover-icon) emits in `sidebar-panel.ts`
 * resolve through this same table as the host's context-menu emit
 * (`emitSidebarContextMenuActionTelemetry` in graphWebview.ts) — so an action rename or addition
 * on one surface cannot silently fragment the `action` × `location` metric.
 *
 * Curation: only management actions are mapped. Commands with their own telemetry domain (ai.*,
 * compose; the compare family beyond the two inline-tracked branch compares) and view-state
 * toggles (hide/solo/pin/focus) are intentionally omitted — they remain visible via
 * `graph/command`. Shared command ids (e.g. `gitlens.fetch:graph`, `gitlens.graph.renameBranch`)
 * appear under every item type they're contributed to; resolution keys off the item type first.
 */
export const sidebarItemActions: {
	readonly branch: Partial<Record<GlCommands, GraphSidebarBranchesActionName>>;
	readonly remote: Partial<Record<GlCommands, GraphSidebarRemotesActionName>>;
	readonly worktree: Partial<Record<GlCommands, GraphSidebarWorktreesActionName>>;
	readonly tag: Partial<Record<GlCommands, GraphSidebarTagsActionName>>;
	readonly stash: Partial<Record<GlCommands, GraphSidebarStashesActionName>>;
} = {
	branch: {
		'gitlens.switchToBranch:graph': 'switch',
		'gitlens.switchToAnotherBranch:graph': 'switch',
		'gitlens.fetch:graph': 'fetch',
		'gitlens.graph.pull': 'pull',
		'gitlens.graph.push': 'push',
		'gitlens.graph.compareBranchWithHead': 'compareWithHead',
		'gitlens.graph.compareWithWorking': 'compareWithWorking',
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
	},
	remote: {
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
	},
	worktree: {
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
	},
	tag: {
		'gitlens.graph.switchToTag': 'switchTo',
		'gitlens.graph.deleteTag': 'delete',
		'gitlens.createBranch:graph': 'createBranch',
		'gitlens.graph.resetToTag': 'reset',
	},
	stash: {
		'gitlens.stashApply:graph': 'apply',
		'gitlens.stashDelete:graph': 'delete',
		'gitlens.stashRename:graph': 'rename',
	},
};

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

/** Parse the sidebar item type from a `webviewItem` context string (e.g. `gitlens:branch+current`).
 *  Remote branches (`gitlens:branch+remote`, the leaves nested under the Remotes panel) are
 *  deliberately NOT resolved: the Branches panel — and so its `branchAction` metric — is
 *  local-only, and the inline path emits nothing for remote-branch leaves either, so both
 *  surfaces symmetrically leave remote-branch actions to `graph/command`. */
function parseItemType(webviewItem: string | undefined): SidebarItemType | undefined {
	if (webviewItem == null) return undefined;

	const type = /^gitlens:(branch|remote|worktree|tag|stash)\b/.exec(webviewItem)?.[1] as SidebarItemType | undefined;
	if (type === 'branch' && /\+remote\b/.test(webviewItem)) return undefined;
	return type;
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
			const action = sidebarItemActions.branch[command as GlCommands];
			return action != null ? { type: 'branch', action: action } : undefined;
		}
		case 'remote': {
			const action = sidebarItemActions.remote[command as GlCommands];
			return action != null ? { type: 'remote', action: action } : undefined;
		}
		case 'worktree': {
			const action = sidebarItemActions.worktree[command as GlCommands];
			return action != null ? { type: 'worktree', action: action } : undefined;
		}
		case 'tag': {
			const action = sidebarItemActions.tag[command as GlCommands];
			return action != null ? { type: 'tag', action: action } : undefined;
		}
		case 'stash': {
			const action = sidebarItemActions.stash[command as GlCommands];
			return action != null ? { type: 'stash', action: action } : undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Marks a parsed sidebar item context as an INLINE (hover-icon) invocation by rewriting its
 * origin to {@link sidebarInlineItemOrigin}, so {@link isSidebarOriginContext} rejects it and the
 * host's context-menu emit skips it — the webview already emitted that action with
 * `location: 'inline'`. Must be applied by the inline dispatch path (`onSidebarAction`) BEFORE
 * `executeCommand`, since both surfaces converge on the same registered command handler.
 */
export function markSidebarInlineInvocation(context: { webviewItemOrigin?: string }): void {
	context.webviewItemOrigin = sidebarInlineItemOrigin;
}

/**
 * Returns whether an invocation context is eligible for sidebar CONTEXT-MENU action telemetry —
 * i.e. it originated from a graph sidebar item and wasn't an inline (hover-icon) invocation.
 *
 * Required because `gitlens:branch`/`gitlens:tag`/`gitlens:stash` contexts are not
 * sidebar-exclusive — the main graph's ref pills (graphRowProcessor.ts) and the WIP details-header
 * kebab (graphWebview.ts) produce the same `webviewItem` types and dispatch the same commands
 * through the same registered handlers. Without this gate, sidebar
 * `*Action{location:'contextMenu'}` events would be dominated by graph-canvas ref-pill
 * right-clicks. The sidebar builders (`getSidebar*` in graphWebview.ts) are REQUIRED (by
 * `GraphSidebarItemOrigin` on the protocol context types) to stamp
 * `webviewItemOrigin: 'sidebar'`; other surfaces never carry it, and inline invocations are
 * re-stamped via {@link markSidebarInlineInvocation}.
 */
export function isSidebarOriginContext(context: unknown): boolean {
	return (
		context != null &&
		typeof context === 'object' &&
		(context as { webviewItemOrigin?: unknown }).webviewItemOrigin === sidebarItemOrigin
	);
}
