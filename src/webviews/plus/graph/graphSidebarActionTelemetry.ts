import type { GlCommands } from '../../../constants.commands.js';
import type {
	GraphSidebarBranchesActionName,
	GraphSidebarPullRequestsActionName,
	GraphSidebarRemotesActionName,
	GraphSidebarStashesActionName,
	GraphSidebarTagsActionName,
	GraphSidebarWorktreesActionName,
	WebviewTelemetryEvents,
} from '../../../constants.telemetry.js';
import type { GraphSidebarPanel } from './protocol.js';
import { sidebarInlineItemOrigin, sidebarItemOrigin } from './protocol.js';

/** Sidebar item types that carry `graph/{panel}/{item}Action` telemetry. */
export type SidebarItemType = 'branch' | 'remote' | 'worktree' | 'tag' | 'stash' | 'pullRequest';

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
	readonly pullRequest: Partial<Record<GlCommands, GraphSidebarPullRequestsActionName>>;
} = {
	pullRequest: {
		'gitlens.openPullRequestOnRemote:graph': 'openOnRemote',
		'gitlens.switchToPullRequest:graph': 'switch',
		'gitlens.graph.openInWorktree': 'openInWorktree',
		'gitlens.openPullRequestChanges:graph': 'openChanges',
		'gitlens.openPullRequestComparison:graph': 'openComparison',
		'gitlens.openPullRequest:graph': 'openPullRequest',
		'gitlens.graph.copy': 'copy',
		'gitlens.copyRemotePullRequestUrl:graph': 'copyUrl',
	},
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
		'gitlens.graph.pushTag': 'push',
		'gitlens.createBranch:graph': 'createBranch',
		'gitlens.graph.resetToTag': 'reset',
	},
	stash: {
		'gitlens.stashApply:graph': 'apply',
		'gitlens.stashDelete:graph': 'delete',
		'gitlens.stashRename:graph': 'rename',
	},
};

/** The `action` names a panel's `graph/{panel}/headerAction` event accepts. Pulled through the
 *  events map (via `infer`, which resolves per concrete panel) rather than redeclared, so the
 *  table can't drift from the declared payloads. */
type SidebarHeaderActionName<P extends Exclude<GraphSidebarPanel, 'overview'>> =
	WebviewTelemetryEvents[`graph/${P}/headerAction`] extends { action: infer TAction } ? TAction : never;

/**
 * Single source of truth for the sidebar HEADER buttons' telemetry, per panel: each panel's
 * header commands mapped to their `graph/{panel}/headerAction` action name, alongside the
 * panel's literal event name (kept literal rather than derived so consumers emit with a typed
 * event name and a per-panel-checked payload).
 *
 * Consumed by the webview's `handleAction` in `sidebar-panel.ts`; the Refresh button reports
 * `action: 'refresh'` against the same per-panel events, which is why the event names live here —
 * but `refresh` itself is deliberately NOT mapped as an action (it isn't command-driven).
 */
export const sidebarHeaderActions: {
	[P in Exclude<GraphSidebarPanel, 'overview'>]: {
		readonly event: `graph/${P}/headerAction`;
		readonly actions: Partial<Record<GlCommands, SidebarHeaderActionName<P>>>;
	};
} = {
	agents: {
		event: 'graph/agents/headerAction',
		actions: {
			'gitlens.startWork': 'startWork',
			'gitlens.startReview': 'startReview',
		},
	},
	worktrees: {
		event: 'graph/worktrees/headerAction',
		actions: { 'gitlens.views.title.createWorktree': 'createWorktree' },
	},
	branches: {
		event: 'graph/branches/headerAction',
		actions: {
			'gitlens.switchToAnotherBranch:views': 'switchToBranch',
			'gitlens.views.title.createBranch': 'createBranch',
		},
	},
	pullRequests: {
		event: 'graph/pullRequests/headerAction',
		actions: { 'gitlens.createPullRequest:graph': 'createPullRequest' },
	},
	remotes: {
		event: 'graph/remotes/headerAction',
		actions: { 'gitlens.views.addRemote': 'addRemote' },
	},
	stashes: {
		event: 'graph/stashes/headerAction',
		actions: {
			'gitlens.stashSave:views': 'stashAll',
			'gitlens.stashesApply:views': 'applyStash',
		},
	},
	tags: {
		event: 'graph/tags/headerAction',
		actions: { 'gitlens.views.title.createTag': 'createTag' },
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
	| { type: 'stash'; action: GraphSidebarStashesActionName }
	| { type: 'pullRequest'; action: GraphSidebarPullRequestsActionName };

/** Parse the sidebar item type from a `webviewItem` context string (e.g. `gitlens:branch+current`).
 *  Remote branches (`gitlens:branch+remote`, the leaves nested under the Remotes panel) are
 *  deliberately NOT resolved: the Branches panel — and so its `branchAction` metric — is
 *  local-only, and the inline path emits nothing for remote-branch leaves either, so both
 *  surfaces symmetrically leave remote-branch actions to `graph/command`. */
function parseItemType(webviewItem: string | undefined): SidebarItemType | undefined {
	if (webviewItem == null) return undefined;

	// `pullrequest` is the context value's spelling; the telemetry type is camelCased to match the panel.
	if (/^gitlens:pullrequest\b/.test(webviewItem)) return 'pullRequest';

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
		case 'pullRequest': {
			const action = sidebarItemActions.pullRequest[command as GlCommands];
			return action != null ? { type: 'pullRequest', action: action } : undefined;
		}
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
