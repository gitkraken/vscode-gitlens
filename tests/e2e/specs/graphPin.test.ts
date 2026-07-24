/**
 * GitLens Graph — Pin Branch to Edge E2E Tests
 *
 * Tests the pin/unpin workflow in the Commit Graph:
 * - Pin a branch via command
 * - Verify pinnedRef state in webview
 * - Unpin and verify state cleared
 */
import * as process from 'node:process';
import type { FrameLocator } from '@playwright/test';
import { test as base, createTmpDir, expect, GitFixture } from '../baseTest.js';

interface GraphStateInfo {
	webviewId: string | undefined;
	webviewInstanceId: string | undefined;
	repoPath: string | undefined;
	pinnedRef?: { id: string; name: string; type: string } | undefined;
}

const getGraphStateScript = `(() => {
	const app = document.querySelector('gl-graph-app');
	if (!app) return JSON.stringify(null);
	const s = app.graphState?._state || app.graphState;
	return JSON.stringify({
		webviewId: s?.webviewId,
		webviewInstanceId: s?.webviewInstanceId,
		repoPath: s?.selectedRepository,
		pinnedRef: s?.pinnedRef ? { id: s.pinnedRef.id, name: s.pinnedRef.name, type: s.pinnedRef.type } : undefined,
	});
})()`;

const getPinnedRefScript = `(() => {
	const app = document.querySelector('gl-graph-app');
	const s = app?.graphState?._state || app?.graphState;
	const p = s?.pinnedRef;
	return JSON.stringify(p ? { id: p.id, name: p.name, type: p.type } : null);
})()`;

const hasPinnedContextScript = `(() => {
	var el = document.querySelector('[data-vscode-context*="+pinned"]');
	if (!el) return JSON.stringify(null);
	var ctx = el.getAttribute('data-vscode-context');
	var match = ctx.match(/"webviewItem":"([^"]+)"/);
	return JSON.stringify(match ? match[1] : null);
})()`;

// New Lit engine: the "Jump to Pinned Branch" affordance is a floating pill
// (gl-lit-graph.ts renderPinnedPill) rendered only when a branch is pinned AND its row is scrolled
// off-screen. It carries aria-label="Jump to Pinned Branch" / class gl-graph__pinned-pill. Its mere
// presence in the DOM means it's shown (renderPinnedPill returns `nothing` otherwise).
const hasPinButtonScript = `(() => {
	function find(root) {
		const btn = root.querySelector('.gl-graph__pinned-pill, [aria-label="Jump to Pinned Branch"]');
		if (btn) return true;
		for (const el of root.querySelectorAll('*')) {
			if (el.shadowRoot && find(el.shadowRoot)) return true;
		}
		return false;
	}
	return JSON.stringify(find(document));
})()`;

async function getGraphState(webview: FrameLocator): Promise<GraphStateInfo | null> {
	const json = String(await webview.locator(':root').evaluate(getGraphStateScript));
	return JSON.parse(json) as GraphStateInfo | null;
}

async function getPinnedRef(webview: FrameLocator): Promise<GraphStateInfo['pinnedRef'] | null> {
	const json = String(await webview.locator(':root').evaluate(getPinnedRefScript));
	return JSON.parse(json) as GraphStateInfo['pinnedRef'] | null;
}

async function hasPinButton(webview: FrameLocator): Promise<boolean> {
	const json = String(await webview.locator(':root').evaluate(hasPinButtonScript));
	return JSON.parse(json) as boolean;
}

async function getPinnedWebviewItem(webview: FrameLocator): Promise<string | null> {
	const json = String(await webview.locator(':root').evaluate(hasPinnedContextScript));
	return JSON.parse(json) as string | null;
}

/**
 * Collapse the details panel if it is open. The panel auto-opens at the bottom of the graph
 * (WIP initial selection + vertical layout), and in the short E2E panel it squeezes the row
 * grid to near-zero height — the virtualizer then paints no branch rows, so ref-pill
 * `data-vscode-context` assertions can never match. Closing it gives the grid the height to
 * actually render the rows.
 */
async function ensureDetailsPanelClosed(webview: FrameLocator): Promise<void> {
	const toggle = webview.locator('gl-button[aria-label$="Details Panel"]').first();
	await expect(toggle).toBeVisible({ timeout: 15000 });
	if ((await toggle.getAttribute('aria-label')) === 'Hide Details Panel') {
		await toggle.click();
		await expect(webview.locator('gl-button[aria-label="Show Details Panel"]').first()).toBeVisible({
			timeout: 15000,
		});
	}
}

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Initial commit', 'test.txt', 'content');

				// Each branch needs its own commit so it renders as a distinct ref pill in the
				// graph. Branches that point at the same commit as the current branch (main) are
				// not drawn with their own row/context, so a pin on them would have no DOM element
				// to carry the +pinned context. Create each at the current main tip, then give it
				// its own commit so it diverges into a distinct row.
				await git.branch('branch-a');
				await git.branch('branch-b');
				await git.branch('branch-c');

				await git.checkout('branch-a');
				await git.commit('Commit on branch-a', 'branch-a.txt', 'branch-a change');
				await git.checkout('branch-b');
				await git.commit('Commit on branch-b', 'branch-b.txt', 'branch-b change');
				await git.checkout('branch-c');
				await git.commit('Commit on branch-c', 'branch-c.txt', 'branch-c change');
				await git.checkout('main');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

// A taller graph for the jump-to-pinned pill: the pill only renders when the pinned branch's row is
// loaded AND scrolled off-screen (gl-lit-graph.updatePinnedPillDirection). The branch tips are created
// first, then ~40 commits are added on `main`, so on open (scrolled to the top / newest main commits)
// the branch rows sit far below the viewport — loaded, but off-screen — which is exactly the pill's
// trigger. Kept separate from the small fixture above, whose tests read the on-screen branch row's
// +pinned context and therefore need those rows rendered.
const testTall = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Initial commit', 'test.txt', 'content');

				// Branch tips first (each with its own commit → distinct row), then bury them under many
				// newer main commits so they render off-screen when the graph opens at the top.
				await git.branch('branch-a');
				await git.branch('branch-b');
				await git.branch('branch-c');
				await git.checkout('branch-a');
				await git.commit('Commit on branch-a', 'branch-a.txt', 'branch-a change');
				await git.checkout('branch-b');
				await git.commit('Commit on branch-b', 'branch-b.txt', 'branch-b change');
				await git.checkout('branch-c');
				await git.commit('Commit on branch-c', 'branch-c.txt', 'branch-c change');
				await git.checkout('main');

				for (let i = 1; i <= 40; i++) {
					await git.commit(`Main commit ${i}`, `main-${i}.txt`, `main change ${i}`);
				}

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe.configure({ mode: 'serial' });

test.describe('Graph — Pin Branch to Edge', () => {
	test.describe.configure({ mode: 'serial' });

	test.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	test('should pin a branch and reflect pinnedRef in webview state', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6 /* SubscriptionState.Paid */,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();

		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();
		expect(stateInfo!.webviewId).toBeDefined();
		expect(stateInfo!.webviewInstanceId).toBeDefined();
		expect(stateInfo!.repoPath).toBeDefined();
		expect(stateInfo!.pinnedRef).toBeUndefined();

		const branchId = `${stateInfo!.repoPath}|heads/branch-a`;
		await vscode.gitlens.executeCommand('gitlens.graph.pinBranchToEdge', {
			webview: stateInfo!.webviewId,
			webviewInstance: stateInfo!.webviewInstanceId,
			webviewItem: 'gitlens:branch',
			webviewItemValue: {
				type: 'branch',
				ref: {
					refType: 'branch',
					repoPath: stateInfo!.repoPath,
					ref: 'branch-a',
					name: 'branch-a',
					id: branchId,
					remote: false,
				},
			},
		});

		await vscode.page.waitForTimeout(1000);

		const pinnedState = await getPinnedRef(graphWebview!);
		expect(pinnedState).not.toBeNull();
		expect(pinnedState!.id).toBe(branchId);
		expect(pinnedState!.name).toBe('branch-a');
		expect(pinnedState!.type).toBe('head');

		// Verify the webviewItem context includes +pinned (rows re-processed after pin).
		// The row re-send (updateState) arrives separately from — and later than — the
		// pinnedRef state update above, so poll until the row context picks up +pinned.
		// The branch rows must actually be painted for the context to exist in the DOM.
		await ensureDetailsPanelClosed(graphWebview!);
		await expect.poll(() => getPinnedWebviewItem(graphWebview!), { timeout: 15000 }).toContain('+pinned');
	});

	test('should unpin a branch and clear pinnedRef state', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();

		await vscode.gitlens.executeCommand('gitlens.graph.pinBranchToEdge', {
			webview: stateInfo!.webviewId,
			webviewInstance: stateInfo!.webviewInstanceId,
			webviewItem: 'gitlens:branch',
			webviewItemValue: {
				type: 'branch',
				ref: {
					refType: 'branch',
					repoPath: stateInfo!.repoPath,
					ref: 'branch-b',
					name: 'branch-b',
					id: `${stateInfo!.repoPath}|heads/branch-b`,
					remote: false,
				},
			},
		});
		await vscode.page.waitForTimeout(1000);

		const pinnedBefore = await getPinnedRef(graphWebview!);
		expect(pinnedBefore).not.toBeNull();

		await vscode.gitlens.executeCommand('gitlens.graph.unpinBranchFromEdge', {
			webview: stateInfo!.webviewId,
			webviewInstance: stateInfo!.webviewInstanceId,
			webviewItem: 'gitlens:branch+pinned',
			webviewItemValue: {
				type: 'branch',
				ref: {
					refType: 'branch',
					repoPath: stateInfo!.repoPath,
					ref: 'branch-b',
					name: 'branch-b',
					id: `${stateInfo!.repoPath}|heads/branch-b`,
					remote: false,
				},
			},
		});
		await vscode.page.waitForTimeout(1000);

		const pinnedAfter = await getPinnedRef(graphWebview!);
		expect(pinnedAfter).toBeNull();
	});
});

// The jump-to-pinned pill needs the pinned row off-screen, which requires a taller graph than the
// tests above (whose small fixture keeps branch rows on-screen to read their +pinned context).
testTall.describe('Graph — Pin Branch to Edge — jump-to-pinned pill', () => {
	testTall.describe.configure({ mode: 'serial' });

	testTall.afterEach(async ({ vscode }) => {
		await vscode.gitlens.resetUI();
	});

	testTall(
		'shows the jump-to-pinned pill only when a branch is pinned and its row is off-screen',
		async ({ vscode }) => {
			using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

			await vscode.gitlens.showCommitGraphView();
			const graphWebview = await vscode.gitlens.commitGraphViewWebview;
			expect(graphWebview).not.toBeNull();
			await vscode.page.waitForTimeout(3000);

			// Not pinned yet → no pill.
			expect(await hasPinButton(graphWebview!)).toBe(false);

			const stateInfo = await getGraphState(graphWebview!);
			expect(stateInfo).not.toBeNull();

			// Pin branch-c: buried under 40 newer main commits, so its row is loaded but far below the
			// viewport when the graph opens at the top.
			await vscode.gitlens.executeCommand('gitlens.graph.pinBranchToEdge', {
				webview: stateInfo!.webviewId,
				webviewInstance: stateInfo!.webviewInstanceId,
				webviewItem: 'gitlens:branch',
				webviewItemValue: {
					type: 'branch',
					ref: {
						refType: 'branch',
						repoPath: stateInfo!.repoPath,
						ref: 'branch-c',
						name: 'branch-c',
						id: `${stateInfo!.repoPath}|heads/branch-c`,
						remote: false,
					},
				},
			});
			await vscode.page.waitForTimeout(1000);

			// The pinned row's off-screen direction is (re)computed on scroll; nudge the graph by a small
			// delta (which keeps branch-c off-screen) so the engine evaluates it and renders the pill.
			await graphWebview!.locator(':root').evaluate(() => {
				(
					document.querySelector('gl-lit-graph') as unknown as { scrollByDelta?: (d: number) => void }
				)?.scrollByDelta?.(120);
			});

			// Pinned + off-screen → the floating "Jump to Pinned Branch" pill is shown.
			await expect.poll(() => hasPinButton(graphWebview!), { timeout: 10000 }).toBe(true);
		},
	);
});
