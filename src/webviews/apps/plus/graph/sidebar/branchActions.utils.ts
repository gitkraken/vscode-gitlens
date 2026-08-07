import type { GraphScopeOrigin, GraphSidebarBranch } from '../../../../plus/graph/protocol.js';
import type { TreeItemAction, TreeModel } from '../../../shared/components/tree/base.js';
import { providerIconName } from '../../../shared/git-utils.js';

/** Sentinel `TreeItemAction.action` handled inside the webview instead of dispatched to the host —
 *  focusing (scoping) the graph is view state, so it never needs to leave the webview. */
export const focusRefActionId = 'gl-graph-focus-ref';

/** Payload carried by a {@link focusRefActionId} action: the branch to focus the graph on. */
export interface FocusRefActionArgs {
	branchName: string;
	upstreamName?: string;
	/** Set when `branchName` is a remote branch that no local branch tracks, so the scope needs a
	 *  `remotes/*` ref id rather than a local head. */
	remote?: boolean;
	/**
	 * Further branches to bring into the same scope, without displacing `branchName` as the focal one.
	 *
	 * For a stack that's the layers above the focal branch: they're DESCENDANTS of its tip, and the scope
	 * only ever walks down from the focal tip, so nothing else can reach them.
	 */
	additional?: { branchName: string; remote?: boolean }[];
	/** What was focused, when the branch was reached through a pull request or a stack. */
	origin?: GraphScopeOrigin;
}

/**
 * Inline action focusing (scoping) the graph onto a branch — shared by the branch, worktree, and
 * remote-branch leaves, which all ultimately focus a branch.
 *
 * Clicking it while the graph is already focused there unfocuses, mirroring the header's
 * jump-to-ref button. The label is deliberately fixed across both states so the row's icons don't
 * shift meaning as the scope changes.
 */
export function createFocusRefAction(label: string, args: FocusRefActionArgs): TreeItemAction {
	return { icon: 'target', label: label, action: focusRefActionId, arguments: [args] };
}

/**
 * Icon for a branch row, shared by the branches sidebar panel and the scope picker.
 *
 * A remote branch takes its remote's provider glyph (cloud when unrecognized) — the branch glyph's
 * status/worktree shape has nothing to say about a branch that lives on the server.
 */
export function branchTreeIcon(b: GraphSidebarBranch): NonNullable<TreeModel['icon']> {
	if (b.remote) return providerIconName(b.providerIcon);

	return { type: 'branch', status: b.status, worktree: b.worktree };
}

/**
 * Maps each remote name to its provider glyph, for the group nodes remote branches fold under in tree
 * layout. Derived from the branches themselves — the panels' branch payload carries no remote list.
 */
export function remoteProviderIconsByName(branches: GraphSidebarBranch[]): Map<string, string> {
	const icons = new Map<string, string>();
	for (const b of branches) {
		if (!b.remote) continue;

		const remoteName = b.name.split('/', 1)[0];
		if (remoteName && !icons.has(remoteName)) {
			icons.set(remoteName, providerIconName(b.providerIcon));
		}
	}
	return icons;
}

/**
 * Provider glyph for a branch group node, or `undefined` when it isn't a remote's node and should stay a
 * folder.
 *
 * Takes the node's own name, not its path: a compacted node fronting the remote is named `origin/feature`,
 * while a folder nested under the remote is named just `feature` — and only the former stands in for the
 * remote itself.
 */
export function remoteProviderFolderIcon(icons: Map<string, string>, name: string): string | undefined {
	return icons.get(name.split('/', 1)[0]);
}

/**
 * Builds the inline actions for a branch leaf in the branches sidebar panel.
 *
 * Every command (action/altAction) produced here must resolve in the shared
 * `sidebarItemActions.branch` table (graphSidebarActionTelemetry.ts) — otherwise
 * `graph/branches/branchAction` telemetry silently drops it. Guarded by
 * `__tests__/branchActions.utils.test.ts`.
 */
export function getBranchLeafActions(b: GraphSidebarBranch): TreeItemAction[] {
	const actions: TreeItemAction[] = [];

	if (b.tracking?.behind) {
		actions.push({
			icon: 'repo-pull',
			label: 'Pull',
			action: 'gitlens.graph.pull',
			altIcon: 'repo-fetch',
			altLabel: 'Fetch',
			altAction: 'gitlens.fetch:graph',
		});
	} else if (b.tracking?.ahead) {
		actions.push({ icon: 'repo-push', label: 'Push', action: 'gitlens.graph.push' });
	} else if (b.upstream && !b.upstream.missing) {
		actions.push({
			icon: 'repo-fetch',
			label: 'Fetch',
			action: 'gitlens.fetch:graph',
			altIcon: 'repo-pull',
			altLabel: 'Pull',
			altAction: 'gitlens.graph.pull',
		});
	}

	if (b.current) {
		actions.unshift({
			icon: 'gl-switch',
			label: 'Switch to Another Branch...',
			action: 'gitlens.switchToAnotherBranch:graph',
		});
		actions.push({
			icon: 'gl-compare-ref-working',
			label: 'Compare with Working Tree',
			action: 'gitlens.graph.compareWithWorking',
		});
	} else if (b.checkedOut) {
		actions.push({
			icon: 'empty-window',
			label: 'Open Worktree in New Window...',
			action: 'gitlens.openWorktreeInNewWindow:graph',
			altIcon: 'window',
			altLabel: 'Open Worktree...',
			altAction: 'gitlens.openWorktree:graph',
		});
	} else {
		actions.unshift({
			icon: 'gl-switch',
			label: 'Switch to Branch...',
			action: 'gitlens.switchToBranch:graph',
		});
		actions.push({
			icon: 'compare-changes',
			label: 'Compare with HEAD',
			action: 'gitlens.graph.compareBranchWithHead',
			altIcon: 'gl-compare-ref-working',
			altLabel: 'Compare with Working Tree',
			altAction: 'gitlens.graph.compareWithWorking',
		});
	}

	// Always last, so it lands on the row's right edge (the trailing cluster is right-packed against
	// a flexing label) and stays put no matter which state-dependent actions precede it.
	actions.push(
		createFocusRefAction('Focus on Branch', {
			branchName: b.name,
			upstreamName: b.upstream?.missing ? undefined : b.upstream?.name,
		}),
	);

	return actions;
}
