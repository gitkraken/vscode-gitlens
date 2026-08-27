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
	/**
	 * The worktree row this payload came from, set on BOTH of a worktree row's dual-verb payloads (see
	 * {@link createWorktreeScopeAction}) — including the plain-Focus alt payload, which carries no
	 * `origin`. `focusRef` needs this independent of `origin` to detect a LIVE perspective on this exact
	 * worktree (left by an earlier Scope gesture) and close it even when the current click is the
	 * Focus verb. Absent for an ordinary branch/remote-branch row, which has no worktree to perspective.
	 */
	worktreePath?: string;
	/** Whether `worktreePath` is the graph's HOME worktree — the un-scoped identity a gesture exits to
	 * (`isHomeWorktree`, NOT the repo's default worktree: a window opened on a worktree makes that
	 * worktree home and the main checkout an ordinary scope target). Set on BOTH of a worktree row's
	 * dual-verb payloads (see {@link createWorktreeScopeAction}). A gesture on home always exits any live
	 * perspective instead of stamping a new one (UX review finding 1); absent (falls back to `false`) for
	 * an ordinary branch/remote-branch row. */
	isHome?: boolean;
}

/**
 * Inline action focusing (scoping) the graph onto a branch — shared by the branch and remote-branch
 * leaves, which ultimately focus a branch only (no worktree perspective — see
 * {@link createWorktreeScopeAction} for the worktree row's dual-verb variant).
 *
 * Clicking it while the graph is already focused there unfocuses, mirroring the header's
 * jump-to-ref button. The label is deliberately fixed across both states so the row's icons don't
 * shift meaning as the scope changes.
 */
export function createFocusRefAction(label: string, args: FocusRefActionArgs): TreeItemAction {
	return { icon: 'target', label: label, action: focusRefActionId, arguments: [args] };
}

/**
 * Inline action for a worktree/WIP row offering BOTH verbs on ONE button, main-click vs. Alt+click —
 * the same alt-affordance pattern the tracking (Pull/Fetch) action uses. Main click "Scopes" the graph
 * onto the worktree (the perspective; also focuses the branch when `graph.scopeBehavior` is
 * `'scopeAndFocus'` — the default). Alt+click is the ordinary branch "Focus" (F only, no perspective) — identical
 * semantics to {@link createFocusRefAction}, just reached via the worktree row instead of a branch
 * row. Both variants route through {@link focusRefActionId} (view state, handled entirely in
 * the webview); they're distinguished by whether their payload carries a worktree `origin`.
 */
export function createWorktreeScopeAction(args: {
	branchName: string;
	upstreamName?: string;
	worktreePath: string;
	/** Whether this row IS the graph's home worktree — see {@link FocusRefActionArgs.isHome}.
	 * On a home row, the main-click (Scope) payload stamps NO origin — the gesture means "go home",
	 * never "perspective to home" (UX review finding 1). */
	isHome?: boolean;
	/** Whether this row IS the graph's LIVE worktree perspective — swaps the main-click label to
	 * "Unscope Worktree" so the row that's actively scoped reads as a toggle rather than a repeat of
	 * the same "Scope to Worktree" verb (UX review finding 8). Purely cosmetic: the click still routes
	 * through {@link focusRefActionId}, whose handler (`focusRef`) already detects and closes the live
	 * perspective from `worktreePath` regardless of this flag. */
	isScoped?: boolean;
}): TreeItemAction {
	return {
		// `gl-scope` (framing corners around a focal dot) is the SCOPE concept's own glyph — it means
		// "the graph is looking through this worktree" and nothing else. Deliberately not `gl-worktree`,
		// which is worktree IDENTITY (the row's own icon, the branch pill's) and never scope, nor
		// `target`, which is the focus vocabulary the alt verb below keeps.
		icon: 'gl-scope',
		label: args.isScoped ? 'Unscope Worktree' : 'Scope to Worktree',
		action: focusRefActionId,
		arguments: [
			{
				branchName: args.branchName,
				upstreamName: args.upstreamName,
				...(args.isHome ? {} : { origin: { kind: 'worktree', path: args.worktreePath } }),
				worktreePath: args.worktreePath,
				isHome: args.isHome,
			} satisfies FocusRefActionArgs,
		],
		altIcon: 'target',
		altLabel: 'Focus on Branch',
		altAction: focusRefActionId,
		// `worktreePath` on the ALT (plain Focus) payload too — no `origin` here (this verb never
		// perspectives), but `focusRef` still needs to know which worktree this row is, so a live
		// perspective left by an earlier Scope gesture on it gets closed by this click too.
		altArguments: [
			{
				branchName: args.branchName,
				upstreamName: args.upstreamName,
				worktreePath: args.worktreePath,
				isHome: args.isHome,
			} satisfies FocusRefActionArgs,
		],
	};
}

/**
 * Structural equality for two {@link GraphScopeOrigin}s — same `kind` and same identifying field
 * (`number` for `pullRequest`/`stack`, `path` for `worktree`). Used to tell a re-focus that changes
 * the scope's origin from a toggle of the exact same one.
 */
export function sameScopeOrigin(a: GraphScopeOrigin | undefined, b: GraphScopeOrigin | undefined): boolean {
	if (a === b) return true;
	if (a == null || b == null || a.kind !== b.kind) return false;

	switch (a.kind) {
		case 'pullRequest':
			return a.number === (b as Extract<GraphScopeOrigin, { kind: 'pullRequest' }>).number;
		case 'stack':
			return a.number === (b as Extract<GraphScopeOrigin, { kind: 'stack' }>).number;
		case 'worktree':
			return a.path === (b as Extract<GraphScopeOrigin, { kind: 'worktree' }>).path;
	}
}

/**
 * Whether a row's `webviewItem` token carries the `+hidden` flag — the ref itself (or, on a remote
 * header row, the whole remote) is hidden by the graph's hidden-refs filter. Token-only: the host is
 * the single source of truth, there's no separate hidden-state field to read.
 */
export function isHiddenWebviewItem(webviewItem: string | undefined): boolean {
	return webviewItem != null && /\b\+hidden\b/.test(webviewItem);
}

/**
 * Whether a row's `webviewItem` token carries the `+hiddenbyremote` flag — a remote-branch row whose
 * whole remote is hidden by a whole-remote wildcard, distinct from the branch itself being hidden.
 */
export function isHiddenByRemoteWebviewItem(webviewItem: string | undefined): boolean {
	return webviewItem != null && /\b\+hiddenbyremote\b/.test(webviewItem);
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

	// Last, so it lands on the row's right edge (the trailing cluster is right-packed against a
	// flexing label) and stays put no matter which state-dependent actions precede it — except on a
	// hidden row, where the un-hide chip below takes the edge as the row's primary recovery action.
	actions.push(
		createFocusRefAction('Focus on Branch', {
			branchName: b.name,
			upstreamName: b.upstream?.missing ? undefined : b.upstream?.name,
		}),
	);

	const webviewItem = b.context?.webviewItem;
	if (b.remote) {
		// Per-branch un-hide is the row-level action, whether the branch is individually hidden or
		// covered by a whole-remote wildcard — the host turns the latter into an exception instead of
		// un-hiding the whole remote. Whole-remote recovery stays on the remote header row's chip and
		// the context menus.
		if (isHiddenByRemoteWebviewItem(webviewItem) || isHiddenWebviewItem(webviewItem)) {
			actions.push({ icon: 'eye', label: 'Show Remote Branch', action: 'gitlens.graph.showRemoteBranch' });
		}
	} else if (isHiddenWebviewItem(webviewItem)) {
		actions.push({ icon: 'eye', label: 'Show Branch', action: 'gitlens.graph.showLocalBranch' });
	}

	return actions;
}
