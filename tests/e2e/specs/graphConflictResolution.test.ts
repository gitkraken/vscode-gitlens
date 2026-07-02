/**
 * GitLens Graph — Conflict Resolution E2E Tests (issue #5424)
 *
 * Covers the deterministic, non-AI surfaces of the "Resolve Conflicts…" feature in the
 * Commit Graph webview:
 *  - Conflict detection → context: the WIP row exposes `+hasConflicts`, and conflicted files
 *    expose `+conflict`. These `data-vscode-context` segments are exactly what the menu
 *    `when` clauses key on (`gitlens.ai.resolveAllConflicts:graph` gates on
 *    `webviewItem =~ /^gitlens:wip\b(?=.*?\+hasConflicts\b)/`; `gitlens.ai.resolveConflicts:graph`
 *    gates on `webviewItem =~ /gitlens:file\b(?=.*?\+conflict\b)/`). Asserting on the context
 *    presence/absence is therefore the e2e-observable form of the menu-gating requirement.
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
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

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

/** WIP-row context that carries `+hasConflicts` lives in the graph's light DOM. */
function wipConflictContext(webview: FrameLocator) {
	return webview.locator('[data-vscode-context*="+hasConflicts"]');
}

/** Conflicted-file context lives inside the WIP details panel's shadow DOM (Playwright pierces it). */
function conflictFileContext(webview: FrameLocator) {
	return webview.locator('[data-vscode-context*="+conflict"]');
}

/** Ensure the graph's details panel is expanded (it may start collapsed). */
async function ensureDetailsPanelOpen(webview: FrameLocator): Promise<void> {
	const toggle = webview.locator('gl-button[aria-label$="Details Panel"]').first();
	await expect(toggle).toBeVisible({ timeout: MaxTimeout });
	if ((await toggle.getAttribute('aria-label')) === 'Show Details Panel') {
		await toggle.click();
		await expect(webview.locator('gl-button[aria-label="Hide Details Panel"]').first()).toBeVisible({
			timeout: MaxTimeout,
		});
	}
}

/** Select the WIP row and wait for its details (file list) to render. */
async function selectWipDetails(webview: FrameLocator): Promise<void> {
	await ensureDetailsPanelOpen(webview);
	// Match the visible WIP row label, not the hidden tooltip span that carries the same text.
	const wipRow = webview
		.getByText(/Working (Changes|Tree)/)
		.filter({ visible: true })
		.first();
	await expect(wipRow).toBeVisible({ timeout: MaxTimeout });
	await wipRow.click();
	await ensureDetailsPanelOpen(webview);
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
	const closeChip = webview.locator('gl-action-chip.mode-close').first();
	if (await closeChip.isVisible().catch(() => false)) {
		await closeChip.click();
		await expect(resolvePanel(webview)).toBeHidden({ timeout: MaxTimeout });
	}
}

/** Open the Commit Graph and wait until the conflicted WIP row has rendered. */
async function openGraphWithConflict(vscode: VSCodeInstance): Promise<FrameLocator> {
	await vscode.gitlens.showCommitGraphView();
	const webview = await vscode.gitlens.commitGraphViewWebview;
	expect(webview).not.toBeNull();
	// The `+hasConflicts` WIP row appearing is our readiness signal: the graph has rendered AND
	// the conflicted merge state has been detected.
	await expect.poll(() => wipConflictContext(webview!).count(), { timeout: 30000 }).toBeGreaterThan(0);
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
				try {
					await git.merge('feature', 'Merge feature');
				} catch {
					// Expected: the merge fails with a conflict and leaves the repo in a conflicted
					// merge state, which is exactly what these tests exercise.
				}

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe('Graph — Conflict Resolution', () => {
	test.describe.configure({ mode: 'serial' });

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
		// shared.txt specifically rather than relying on render order.
		await expect.poll(() => conflictFileContext(webview).count(), { timeout: 15000 }).toBeGreaterThan(0);
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
