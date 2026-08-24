/**
 * GitLens Graph — Conflict Resolution E2E Tests (issue #5424)
 *
 * Covers the deterministic, non-AI surfaces of the "Resolve Conflicts…" feature in the
 * Commit Graph webview:
 *  - Conflict detection → context: the WIP row exposes `+hasConflicts`. That
 *    `data-vscode-context` segment is exactly what the menu `when` clause keys on
 *    (`gitlens.ai.resolveAllConflicts:graph` gates on
 *    `webviewItem =~ /^gitlens:wip\b(?=.*?\+hasConflicts\b)/`), so asserting its presence and
 *    absence is the e2e-observable form of the menu-gating requirement.
 *    The per-file counterpart — `gitlens:file` rows exposing `+conflict`, which
 *    `gitlens.ai.resolveConflicts:graph` gates on — is covered as well, now that #5548 (those rows
 *    not exposing the context under the new graph engine) is fixed. It rides the details panel's
 *    virtualized file tree, so that spec scrolls the tree into view before asserting.
 *  - Command routing: invoking the resolve commands enters the WIP details "resolve" mode
 *    (`gl-details-resolve-mode-panel`, idle state) scoped to all / a single / multiple files,
 *    WITHOUT firing the AI call (the AI request only runs when the user clicks "Resolve" in the
 *    idle panel).
 *
 * NOT covered here (documented, per the issue):
 *  - The `gitlens:ai:allowed` half of the menu gating: it is a native VS Code `when`-clause
 *    context, not reflected in the webview DOM, and toggling `gitlens.ai.enabled` does not
 *    change the rendered `data-vscode-context` — so it isn't observable through this harness.
 *    The conflict-presence half (`+hasConflicts` / `+conflict`) is covered below.
 *  - The actual AI resolution call (network/non-deterministic) and the `graph-resolve` virtual
 *    diff, which is only populated after an AI response. The pure resolution helpers are already
 *    unit-tested in `src/webviews/rebase/__tests__/conflictResolution.utils.test.ts`.
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, DefaultTimeout, expect, GitFixture, MaxTimeout } from '../baseTest.js';
import { ensureGraphRowsRendered, scrollDetailsToFileTree, widenSideBarForGraph } from '../graphHelpers.js';

const uncommittedSha = '0000000000000000000000000000000000000000';

let git: GitFixture;

interface GraphStateInfo {
	webviewId: string | undefined;
	webviewInstanceId: string | undefined;
	repoPath: string | undefined;
}

const getGraphStateScript = `(() => {
	const app = document.querySelector('gl-graph-app');
	if (!app) return JSON.stringify(null);
	const s = app.graphState?._state || app.graphState;
	return JSON.stringify({
		webviewId: s?.webviewId,
		webviewInstanceId: s?.webviewInstanceId,
		repoPath: s?.selectedRepository,
	});
})()`;

async function getGraphState(webview: FrameLocator): Promise<GraphStateInfo | null> {
	const json = String(await webview.locator(':root').evaluate(getGraphStateScript));
	return JSON.parse(json) as GraphStateInfo | null;
}

/**
 * WIP context that carries `+hasConflicts`. Two elements can carry it: the overview bar's WIP pill
 * (host-serialized, so selection-independent) and the WIP details header's overflow chip. This
 * fixture only ever sees the second — `gitlens.graph.overviewBar.visibility` defaults to `dirtyWorktrees`
 * and the fixture repo has exactly one, so the bar never renders (measured: 0 in the DOM). That is why
 * `openGraphWithConflict` has to put the WIP row in the selection before gating on this.
 */
function wipConflictContext(webview: FrameLocator) {
	return webview.locator('[data-vscode-context*="+hasConflicts"]');
}

/** Conflicted-file context lives inside the WIP details panel's shadow DOM (Playwright pierces it). */
function conflictFileContext(webview: FrameLocator) {
	return webview.locator('[data-vscode-context*="+conflict"]');
}

/**
 * Open or collapse the graph's details panel.
 *
 * Which state a step needs is load-bearing here, because the panel splits the side bar's HEIGHT with
 * the graph. Open, it can leave the graph too short for its virtualizer to mount ANY row: measured on a
 * cramped host, an open panel left the graph pane at 26px with the commit tree at height 0 and zero
 * `role="treeitem"` in the DOM, while collapsing it put the tree back at 19px with its rows mounted. So
 * anything that gates on graph rows — or clicks one — has to run while it is collapsed, and only the
 * WIP details themselves need it open. This file reaches the starved state on its own: its gate opens
 * the panel and the graph webview is retained across `resetUI`, so each test inherits the previous
 * one's panel. The wider CI VS Code window has room to spare; the fork legs (Windsurf, Positron) did
 * not.
 *
 * Gated on the pane's `inert` attribute rather than the toggle's label: `inert` is bound directly to
 * `graphState.details.visible` (`graph-app.ts`, `?inert=${!detailsVisible}`), so it can't report a
 * transient pre-render label the way a single `aria-label` read can, and it is the same invariant
 * `graphDetails.test.ts` asserts. Retried, because the click and that state land a frame apart.
 */
async function setDetailsPanel(webview: FrameLocator, open: boolean): Promise<void> {
	const pane = webview.locator('.graph__details-pane').first();
	const toggle = webview.locator(`gl-button[aria-label="${open ? 'Show' : 'Hide'} Details Panel"]`).first();

	await expect(async () => {
		if (await toggle.isVisible().catch(() => false)) {
			await toggle.click({ timeout: DefaultTimeout }).catch(() => {});
		}

		if (open) {
			await expect(pane).not.toHaveAttribute('inert', '', { timeout: DefaultTimeout });
		} else {
			await expect(pane).toHaveAttribute('inert', '', { timeout: DefaultTimeout });
		}
	}).toPass({ timeout: MaxTimeout });
}

/**
 * Select the WIP row. Kept separate from opening its details because the click needs the panel
 * COLLAPSED: the row it targets only exists in the DOM while the graph has the height to render it (see
 * {@link setDetailsPanel}).
 */
async function selectWipRow(webview: FrameLocator): Promise<void> {
	// New Lit engine: role="treeitem", accessible name "Working Changes". Forced, because a conflicted
	// WIP row carries adornment overlays (the "Resolve Conflicts…" chip and the modified-file stats pill)
	// that sit over it on slower/contended renders (the workers=4 flake).
	const wipRow = webview
		.getByRole('treeitem', { name: /Working Changes/ })
		.filter({ visible: true })
		.first();
	await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
	await wipRow.click({ force: true });
}

/** Select the WIP row and wait for its details (file list) to render. */
async function selectWipDetails(webview: FrameLocator): Promise<void> {
	// Collapse first so the row is there to click, then open for the details themselves.
	await setDetailsPanel(webview, false);
	await selectWipRow(webview);
	await setDetailsPanel(webview, true);
	await expect(webview.locator('gl-details-wip-panel').first()).toBeVisible({ timeout: 30000 });
}

function resolvePanel(webview: FrameLocator) {
	return webview.locator('gl-details-resolve-mode-panel');
}

/**
 * Exit resolve mode if it is active. The graph webview is retained across hide/show
 * (`retainContextWhenHidden`) and `resetUI` does not reset the in-memory active mode, so without
 * this the resolve panel from one serial test would leak into the next and make a bare
 * "panel is visible" assertion pass without the command having routed.
 */
async function exitResolveMode(webview: FrameLocator): Promise<void> {
	const panel = resolvePanel(webview);
	if (
		!(await panel
			.first()
			.isVisible()
			.catch(() => false))
	) {
		return;
	}

	// The resolve-mode header re-renders while the conflicted WIP is being watched, detaching the close
	// chip between actionability and click (a single click races that re-render). Retry a forced click
	// until the resolve panel is actually hidden rather than relying on one stable click landing.
	await expect(async () => {
		await webview
			.locator('gl-action-chip.mode-close')
			.first()
			.click({ force: true, timeout: 2000 })
			.catch(() => {});
		await expect(panel).toBeHidden({ timeout: 1000 });
	}).toPass({ timeout: MaxTimeout });
}

/** Open the Commit Graph and wait until the conflicted WIP row has rendered. */
async function openGraphWithConflict(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	await widenSideBarForGraph(vscode);
	const webview = await vscode.gitlens.commitGraphViewWebview;
	expect(webview).not.toBeNull();
	// Gate the row paint separately from the conflict state, so a failure names which one broke rather
	// than reporting the same "context never appeared" for either. 15s each: still well over
	// `MaxTimeout`, which the conflict state needs because it waits on a `git status` read. The stages
	// below add to that, which is why this file raises its per-test timeout (see the describe).
	//
	// The order of the stages is what makes them measure what they name:
	// - The row gate AND the WIP-row click both run with the details panel COLLAPSED, because the graph
	//   only has the height to render its rows in that state (see `setDetailsPanel`). Run them with the
	//   panel open and the gate reports "element(s) not found", blaming a graph that painted fine.
	// - The panel opens after that, because the WIP row has to be the selection for `+hasConflicts` to
	//   exist at all in this fixture (see `wipConflictContext`): with a commit selected the panel renders
	//   `gl-details-commit-panel` and there is no `gl-details-wip-header` to carry the context. A fresh
	//   graph auto-selects the WIP row, which is why gating on the context alone held for the first specs
	//   in this file — but nothing keeps that selection across a spec that left another row behind.
	// - Resolve mode is left only once the panel is open, since `exitResolveMode` probes whether the mode
	//   panel is VISIBLE: a collapsed panel hides it, so exiting earlier would early-return and leave the
	//   mode active, and `renderWip` then renders it INSTEAD of `gl-details-wip-panel` — surfacing as
	//   "the WIP details never rendered", the misdiagnosis this whole gate exists to prevent. The mode
	//   leaks in the first place because the graph webview is retained across `resetUI` and this file's
	//   `afterEach` can miss the close chip, which re-renders under the conflicted WIP's watcher.
	await setDetailsPanel(webview!, false);
	await ensureGraphRowsRendered(vscode, webview!, 15000);
	await selectWipRow(webview!);
	await setDetailsPanel(webview!, true);
	await exitResolveMode(webview!);
	await expect(webview!.locator('gl-details-wip-panel').first()).toBeVisible({ timeout: 30000 });
	await expect.poll(() => wipConflictContext(webview!).count(), { timeout: 15000 }).toBeGreaterThan(0);
	return webview!;
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				git = new GitFixture(repoDir);
				await git.init();

				// Diverge `main` and `feature` on two shared files so a merge produces real conflicts
				// in both, leaving the working tree in a conflicted merge state (WIP row →
				// `+hasConflicts`). Two conflicted files let the single- vs multi-file resolve
				// commands route over genuinely different scopes.
				await git.commit('Base commit', 'shared.txt', 'line1\nline2\nline3\n');
				await git.commit('Add shared2', 'shared2.txt', 'a\nb\nc\n');
				await git.branch('feature');
				await git.commit('Main edit', 'shared.txt', 'line1\nMAIN CHANGE\nline3\n');
				await git.commit('Main edit 2', 'shared2.txt', 'a\nMAIN\nc\n');
				await git.checkout('feature');
				await git.commit('Feature edit', 'shared.txt', 'line1\nFEATURE CHANGE\nline3\n');
				await git.commit('Feature edit 2', 'shared2.txt', 'a\nFEATURE\nc\n');
				await git.checkout('main');
				// `--no-ff` states the intent: these branches have diverged, so a merge commit is the only
				// possible outcome and nothing here should have to infer that from configuration.
				let mergeError: unknown;
				try {
					await git.merge('feature', 'Merge feature', { noFF: true });
				} catch (ex) {
					// Expected: a conflicting merge exits non-zero and leaves the conflicted merge state
					// these tests exercise. Kept, because it is also the only report of a merge that never ran.
					mergeError = ex;
				}

				// Swallowing that rejection equally swallows a merge git declined to start, so assert the
				// state the tests need. Both halves matter: unmerged paths alone can outlive an aborted
				// operation, and `MERGE_HEAD` is what gives the UI a paused merge to show.
				const [unmerged, merging] = await Promise.all([git.getUnmergedPaths(), git.isMergeInProgress()]);
				if (unmerged.length === 0 || !merging) {
					throw new Error(
						`fixture: expected a conflicted merge (unmerged=${unmerged.length}, MERGE_HEAD=${merging})${
							mergeError instanceof Error ? `; git reported: ${mergeError.message}` : ''
						}`,
					);
				}

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — Conflict Resolution', () => {
	// 90s per test rather than the config's 60s: `openGraphWithConflict` establishes the state it
	// measures — rows painted, details panel open, resolve mode left, WIP row selected — and then polls
	// the conflict context, which waits on a `git status` read. Each of those stages carries its own
	// timeout so a failure names itself; on a contended fork run they can add past 60s, and the per-test
	// cap firing mid-stage reports a bare "Test timeout" naming none of them.
	test.describe.configure({ mode: 'serial', timeout: 90000 });

	test.afterEach(async ({ vscode }) => {
		// Exit resolve mode before tearing down so it doesn't leak into the next serial test (the
		// graph webview is retained). Do it while the graph is still shown — resetUI hides it.
		const webview = await vscode.gitlens.commitGraphViewWebview;
		if (webview != null) {
			await exitResolveMode(webview);
		}
		await vscode.gitlens.resetUI();
	});

	test('WIP row exposes the +hasConflicts context', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6 /* Paid */, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);

		// The context segment that drives the "Resolve Conflicts" WIP-row menu item.
		const ctx = await wipConflictContext(webview).first().getAttribute('data-vscode-context');
		expect(ctx).toBeTruthy();
		expect(ctx).toContain('gitlens:wip');
		expect(ctx).toContain('+hasConflicts');
	});

	test('conflicted file exposes the +conflict context in the WIP details', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);

		// Open the WIP details file list, where the conflicted file carries the `+conflict` context
		// (drives the per-file "Resolve Conflicts" menu item).
		await selectWipDetails(webview);

		// Both conflicted files render a `gitlens:file…+conflict…` context; assert on the one for
		// shared.txt specifically rather than relying on render order. The per-file context is emitted by
		// the file ROWS, which the details file tree virtualizes — so scroll to the tree on every poll,
		// or a list below the fold reads as "the context never rendered" (see `scrollDetailsToFileTree`).
		await expect
			.poll(
				async () => {
					await scrollDetailsToFileTree(webview, MaxTimeout);
					return conflictFileContext(webview).count();
				},
				{ timeout: 15000 },
			)
			.toBeGreaterThan(0);
		const contexts = await conflictFileContext(webview).evaluateAll(els =>
			els.map(el => el.getAttribute('data-vscode-context') ?? ''),
		);
		const sharedCtx = contexts.find(c => c.includes('"path":"shared.txt"'));
		expect(sharedCtx, `expected a +conflict context for shared.txt, got: ${contexts.join(' | ')}`).toBeTruthy();
		expect(sharedCtx).toContain('gitlens:file');
		expect(sharedCtx).toContain('+conflict');
	});

	test('resolveAllConflicts enters resolve mode for the whole worktree', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);
		const state = await getGraphState(webview);
		expect(state).not.toBeNull();
		// Assert the routing contract explicitly: a webview command needs a live webview id +
		// instance id or the WebviewCommandRegistrar throws — fail fast with a clear signal if the
		// graph state shape ever changes.
		expect(state!.webviewId).toBeDefined();
		expect(state!.webviewInstanceId).toBeDefined();
		expect(state!.repoPath).toBeDefined();

		// Start outside resolve mode so the visibility change proves THIS command routed (the panel
		// is otherwise retained across tests).
		await exitResolveMode(webview);
		await expect(resolvePanel(webview)).toBeHidden();

		await vscode.gitlens.executeCommand('gitlens.ai.resolveAllConflicts:graph', {
			webview: state!.webviewId,
			webviewInstance: state!.webviewInstanceId,
			webviewItem: 'gitlens:wip+hasConflicts',
			webviewItemValue: {
				type: 'commit',
				ref: {
					refType: 'revision',
					repoPath: state!.repoPath,
					ref: uncommittedSha,
					sha: uncommittedSha,
					name: 'Working Tree',
				},
				worktreePath: state!.repoPath,
			},
		});

		// The idle resolve-mode panel renders (no AI call — that only runs on the "Resolve" click).
		await expect(resolvePanel(webview)).toBeVisible({ timeout: 15000 });
		await expect(webview.getByText('Resolving Conflicts').first()).toBeVisible({ timeout: 15000 });
	});

	test('resolveConflicts enters resolve mode scoped to a single file', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);
		const state = await getGraphState(webview);
		expect(state).not.toBeNull();
		// Assert the routing contract explicitly: a webview command needs a live webview id +
		// instance id or the WebviewCommandRegistrar throws — fail fast with a clear signal if the
		// graph state shape ever changes.
		expect(state!.webviewId).toBeDefined();
		expect(state!.webviewInstanceId).toBeDefined();
		expect(state!.repoPath).toBeDefined();

		await exitResolveMode(webview);
		await expect(resolvePanel(webview)).toBeHidden();

		await vscode.gitlens.executeCommand('gitlens.ai.resolveConflicts:graph', {
			webview: state!.webviewId,
			webviewInstance: state!.webviewInstanceId,
			webviewItem: 'gitlens:file+conflict+canStageCurrent+canStageIncoming',
			webviewItemValue: { type: 'file', path: 'shared.txt', repoPath: state!.repoPath },
		});

		await expect(resolvePanel(webview)).toBeVisible({ timeout: 15000 });
	});

	test('resolveConflicts.multi enters resolve mode for a multi-selection of conflicts', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);
		const state = await getGraphState(webview);
		expect(state).not.toBeNull();
		// Assert the routing contract explicitly: a webview command needs a live webview id +
		// instance id or the WebviewCommandRegistrar throws — fail fast with a clear signal if the
		// graph state shape ever changes.
		expect(state!.webviewId).toBeDefined();
		expect(state!.webviewInstanceId).toBeDefined();
		expect(state!.repoPath).toBeDefined();

		await exitResolveMode(webview);
		await expect(resolvePanel(webview)).toBeHidden();

		// The multi handler reads `webviewItemsValues` and keeps only the `+conflict` entries. Pass
		// both conflicted files plus a non-conflict entry to exercise the filter-out path
		// (`items.filter(i => i.webviewItem.includes('+conflict'))` in resolveConflictsMulti).
		await vscode.gitlens.executeCommand('gitlens.ai.resolveConflicts.multi:graph', {
			webview: state!.webviewId,
			webviewInstance: state!.webviewInstanceId,
			webviewItemsValues: [
				{
					webviewItem: 'gitlens:file+conflict+canStageCurrent+canStageIncoming',
					webviewItemValue: { type: 'file', path: 'shared.txt', repoPath: state!.repoPath },
				},
				{
					webviewItem: 'gitlens:file+conflict+canStageCurrent+canStageIncoming',
					webviewItemValue: { type: 'file', path: 'shared2.txt', repoPath: state!.repoPath },
				},
				{
					// Non-conflict selection the handler must filter out.
					webviewItem: 'gitlens:file+unstaged',
					webviewItemValue: { type: 'file', path: 'unrelated.txt', repoPath: state!.repoPath },
				},
			],
		});

		await expect(resolvePanel(webview)).toBeVisible({ timeout: 15000 });
	});

	// Tier 2 — the views surface. The conflicted files appear in the Commits view under the
	// merge status node; the file node's `viewItem` carries `+conflicted` (mergeConflictFileNode),
	// which is what `gitlens.ai.resolveConflicts:views` gates on. The `viewItem` string is a native
	// VS Code TreeItem contextValue (not in the DOM), so we assert on the rendered conflict node +
	// file instead — confirming conflict detection surfaces in the tree.
	test('Commits view surfaces the conflicted file under the merge status', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitsView();

		const sidebar = vscode.gitlens.sidebar.locator;
		// The merge-status node advertises the in-progress conflicted merge.
		await expect(sidebar.getByText(/Resolve conflicts to continue merging/i).first()).toBeVisible({
			timeout: 30000,
		});
		// The conflicted file is listed as a tree item.
		await expect(vscode.gitlens.sidebar.getTreeItem(/shared\.txt/).first()).toBeVisible({ timeout: 15000 });
	});

	// Runs last: aborting the merge clears the conflict, so no other test may depend on the
	// conflicted state after this point (serial mode guarantees ordering).
	test('no conflict context once the merge is aborted', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		const webview = await openGraphWithConflict(vscode);
		// Baseline: the conflicted merge currently advertises conflicts on the WIP row.
		expect(await wipConflictContext(webview).count()).toBeGreaterThan(0);

		await git.mergeAbort();
		await vscode.gitlens.executeCommand('gitlens.views.graph.refresh');

		// With the working tree clean, the WIP row no longer advertises conflicts, so the
		// "Resolve Conflicts" WIP-row menu item would not gate on. (We assert the at-rest
		// `+hasConflicts` signal here; the per-file `+conflict` context only renders inside an
		// opened WIP details panel and is covered by the dedicated file-context test above.)
		await expect.poll(() => wipConflictContext(webview).count(), { timeout: 15000 }).toBe(0);
	});
});
