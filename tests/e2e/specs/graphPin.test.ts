/**
 * GitLens Graph — Pin Branch to Edge E2E Tests
 *
 * Tests the pin/unpin workflow in the Commit Graph:
 * - Pin a branch via command
 * - Verify pinnedRef state in webview
 * - Unpin and verify state cleared
 */
import * as process from 'node:process';
import type { FrameLocator, Locator } from '@playwright/test';
import type { VSCodeInstance } from '../baseTest.js';
import { test as base, createTmpDir, expect, GitFixture, MaxTimeout } from '../baseTest.js';

interface GraphStateInfo {
	webviewId: string | undefined;
	webviewInstanceId: string | undefined;
	repoPath: string | undefined;
	pinnedRef?: { id: string; name: string; type: string } | undefined;
}

/**
 * The pinned ref, wherever it currently lives.
 *
 * NOT in the serialized `_state` snapshot: `pinnedRef` was dropped from the Graph webview protocol's
 * `State` when the write planes moved onto RPC services, and the state provider's own accessor is what
 * carries it now. `_state` still exists and still carries `webviewId`/`selectedRepository`, so a probe
 * that prefers `_state` keeps working — and keeps reporting the pin as absent, indistinguishable from
 * "not pinned". Both places are read so this survives the field moving again in either direction.
 *
 * Callers fold the result with ?? undefined where an unpinned graph should omit the key entirely.
 */
const pinnedRefExpr = `(() => {
	const app = document.querySelector('gl-graph-app');
	const p = app?.graphState?.pinnedRef ?? app?.graphState?._state?.pinnedRef;
	return p ? { id: p.id, name: p.name, type: p.type } : null;
})()`;

const getGraphStateScript = `(() => {
	const app = document.querySelector('gl-graph-app');
	if (!app) return JSON.stringify(null);
	const s = app.graphState?._state || app.graphState;
	return JSON.stringify({
		webviewId: s?.webviewId,
		webviewInstanceId: s?.webviewInstanceId,
		repoPath: s?.selectedRepository,
		pinnedRef: ${pinnedRefExpr} ?? undefined,
	});
})()`;

const getPinnedRefScript = `(() => JSON.stringify(${pinnedRefExpr}))()`;

const hasPinnedContextScript = `(() => {
	var el = document.querySelector('[data-vscode-context*="+pinned"]');
	if (!el) return JSON.stringify(null);
	var ctx = el.getAttribute('data-vscode-context');
	var match = ctx.match(/"webviewItem":"([^"]+)"/);
	return JSON.stringify(match ? match[1] : null);
})()`;

// New Lit engine: the "Jump to Pinned Branch" affordance is a segment of the floating waypoints capsule
// (gl-lit-graph.ts renderPinnedPill, inside renderWaypoints) rendered only when a branch is pinned AND its
// row is scrolled off-screen. Its mere presence in the DOM means it's shown (renderPinnedPill returns
// `nothing` otherwise).
//
// Matched on the class, not the aria-label: the label carries the branch NAME ("Jump to pinned branch
// <name>") so screen readers get the identity without hovering — the visible text is just "Pinned" at rest.
const hasPinButtonScript = `(() => {
	function find(root) {
		const btn = root.querySelector('.gl-graph__pinned-pill, [aria-label^="Jump to pinned branch"]');
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

/**
 * Clear any edge pin and wait for it to actually leave the webview state before tearing down. The no-arg
 * `unpinBranchFromEdge` clears the pin for the LIVE graph session's repo, so the graph has to be shown (a
 * session must exist), and the pin is persisted per-repo in workspace storage — a fire-and-forget unpin can
 * lose the race with `resetUI` and leak the pin into the next serial test. Polling the state to null closes
 * that race; a genuinely stuck pin (an unpin regression) is still surfaced by the next test that asserts on it.
 */
async function clearEdgePin(vscode: VSCodeInstance): Promise<void> {
	await vscode.gitlens.showCommitGraphView();
	const webview = await vscode.gitlens.commitGraphViewWebview;
	if (webview == null) return;

	const pinned = await getPinnedRef(webview);
	if (pinned == null) return;

	const state = await getGraphState(webview);
	if (state == null) return;

	// `unpinBranchFromEdge` is a webview command: it ignores its item arg (it clears the LIVE graph
	// session's repo) but the webview framework still routes on the `webview`/`webviewInstance` ids, so a
	// no-arg call reaches no controller and silently no-ops — leaking the pin (persisted per-repo in
	// workspace storage) into the next serial test. Passing the routing context is what actually lands the
	// unpin; poll the webview state to confirm it cleared before tearing down.
	await expect
		.poll(
			async () => {
				await vscode.gitlens
					.executeCommand('gitlens.graph.unpinBranchFromEdge', {
						webview: state.webviewId,
						webviewInstance: state.webviewInstanceId,
					})
					.catch(() => {});
				return getPinnedRef(webview);
			},
			{ timeout: 15000, intervals: [250, 500, 1000, 1000, 2000] },
		)
		.toBeNull();
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

/**
 * The `GraphItemContext` the graph's own menus carry into the pin/unpin commands. Built here rather
 * than inline per test: `pinBranchToEdge` bails unless `refType === 'branch'` and `ref.id != null`
 * (`graphCommands.ts`), and the id has to be the one the rows carry — `<repoPath>|heads/<name>` or
 * `|remotes/<name>` (`getBranchId`) — or the webview never matches the pin to a row.
 */
function graphRefContext(state: GraphStateInfo, name: string, remote: boolean, pinned: boolean = false) {
	return {
		webview: state.webviewId,
		webviewInstance: state.webviewInstanceId,
		webviewItem: pinned ? 'gitlens:branch+pinned' : 'gitlens:branch',
		webviewItemValue: {
			type: 'branch',
			ref: {
				refType: 'branch',
				repoPath: state.repoPath,
				ref: name,
				name: name,
				id: `${state.repoPath}|${remote ? 'remotes' : 'heads'}/${name}`,
				remote: remote,
			},
		},
	};
}

/**
 * Pin a branch and wait for the webview to have it. Gated on the state rather than a fixed delay: the
 * command resolves as soon as the host records the pin, while the webview learns about it over a
 * separate notification.
 */
async function pinBranch(
	vscode: VSCodeInstance,
	webview: FrameLocator,
	state: GraphStateInfo,
	name: string,
	options?: { remote?: boolean },
): Promise<void> {
	const remote = options?.remote === true;
	await vscode.gitlens.executeCommand('gitlens.graph.pinBranchToEdge', graphRefContext(state, name, remote));
	await expect
		.poll(async () => (await getPinnedRef(webview))?.id, { timeout: 15000 })
		.toBe(`${state.repoPath}|${remote ? 'remotes' : 'heads'}/${name}`);
}

/** Unpin via the command, and wait for the webview's state to clear. */
async function unpinBranch(
	vscode: VSCodeInstance,
	webview: FrameLocator,
	state: GraphStateInfo,
	name: string,
	options?: { remote?: boolean },
): Promise<void> {
	await vscode.gitlens.executeCommand(
		'gitlens.graph.unpinBranchFromEdge',
		graphRefContext(state, name, options?.remote === true, true),
	);
	await expect.poll(() => getPinnedRef(webview), { timeout: 15000 }).toBeNull();
}

/** A row's ref pill, addressed by the ref it names. */
function refPill(webview: FrameLocator, refName: string): Locator {
	return webview.locator('.gl-graph__ref-pill').filter({ hasText: refName }).first();
}

/**
 * The pin control on a ref pill — the pinned glyph at rest, `close` on hover, and the only in-graph way
 * to unpin (`renderPinControl`).
 *
 * Scoped to `.gl-graph__ref-pill-expand`: a pill renders the leading slot TWICE, and the in-flow copy
 * under `.gl-graph__ref-pill-main` is the covered one — `pinnedTargetForEvent` in `gl-lit-graph.ts`
 * redirects to the expand copy for exactly this reason, so a click has to target the same one.
 */
function refPillPinControl(webview: FrameLocator, refName: string): Locator {
	return refPill(webview, refName).locator('.gl-graph__ref-pill-expand .gl-graph__ref-pill-icon--pin').first();
}

/**
 * The edge-pin control's IN-FLOW copy — the resting pin indicator in the leading slot of
 * `.gl-graph__ref-pill-main`. This copy is the one visible at rest (the `-expand` overlay is
 * `display:none` until the pill fills on hover/focus), so it — not `refPillPinControl` — is what an
 * indicator / aria assertion reads without first hovering.
 */
function refPillPinIndicator(webview: FrameLocator, refName: string): Locator {
	return refPill(webview, refName).locator('.gl-graph__ref-pill-main .gl-graph__ref-pill-icon--pin').first();
}

/**
 * Click an edge-pin control the way a user does. Hovering the pill fills it, which flips the in-flow
 * `-main` copy to `visibility:hidden` and reveals the `-expand` overlay on top — so the only copy that
 * actually receives the click is the overlay one. Playwright's own auto-hover during `click()` triggers
 * exactly this flip, so a click aimed at the resting copy lands on a hidden element; hover first, then
 * click the overlay copy.
 */
async function clickPinControl(webview: FrameLocator, refName: string, control: Locator): Promise<void> {
	await refPill(webview, refName).hover();
	await expect(control).toBeVisible({ timeout: MaxTimeout });
	await control.click();
}

/**
 * Scroll the virtualized graph to a fraction of its range (0 = top, 1 = bottom). Writing `scrollTop`
 * fires the scroller's `scroll` event, which drives `updateHeadPillDirection` / `updatePinnedPillDirection`.
 * Half-way puts BOTH the newest (HEAD) and the oldest rows off-screen at once.
 */
async function scrollGraphToFraction(webview: FrameLocator, fraction: number): Promise<void> {
	await webview.locator(':root').evaluate((_el, f) => {
		const scroller = document.querySelector('gl-lit-graph lit-virtualizer');
		if (scroller != null) {
			scroller.scrollTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) * f);
		}
	}, fraction);
}

/**
 * Toggle the details panel and wait for the opposite state — a real resize of the row grid (which fires
 * the graph's ResizeObserver) with NO scrolling.
 */
async function toggleDetailsPanel(webview: FrameLocator): Promise<void> {
	const toggle = webview.locator('gl-button[aria-label$="Details Panel"]').first();
	await expect(toggle).toBeVisible({ timeout: 15000 });
	const wasHiding = (await toggle.getAttribute('aria-label')) === 'Hide Details Panel';
	await toggle.click();
	const nextLabel = wasHiding ? 'Show Details Panel' : 'Hide Details Panel';
	await expect(webview.locator(`gl-button[aria-label="${nextLabel}"]`).first()).toBeVisible({ timeout: 15000 });
}

/**
 * The pinned branch's band on the scroll rail. Matched on its colour variable, because the rendered box
 * carries no type of its own — `renderScrollMarkers` emits only geometry plus `backgroundColor`, and
 * `pinned` is the one lane painted with `--color-graph-scroll-marker-pinned` (`graph-scroll-markers.ts`).
 */
function pinnedScrollMarker(webview: FrameLocator): Locator {
	return webview.locator('.gl-graph__scroll-marker-box[style*="scroll-marker-pinned"]');
}

/** The floating waypoints capsule and its two possible segments (`renderWaypoints`). */
function waypointsCapsule(webview: FrameLocator): Locator {
	return webview.locator('.gl-graph__waypoints');
}

function headWaypoint(webview: FrameLocator): Locator {
	return webview.locator('.gl-graph__waypoint--head');
}

function pinnedWaypoint(webview: FrameLocator): Locator {
	return webview.locator('.gl-graph__waypoint--pinned');
}

const getSelectedShasScript = `(() => {
	const graph = document.querySelector('gl-lit-graph');
	const rows = graph?.selectedRows;
	return JSON.stringify(rows != null ? Object.keys(rows).sort() : []);
})()`;

/** The shas the graph considers selected — the invariant the pin control's `stopPropagation` protects. */
async function getSelectedShas(webview: FrameLocator): Promise<string[]> {
	const json = String(await webview.locator(':root').evaluate(getSelectedShasScript));
	return JSON.parse(json) as string[];
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
// first, then ~120 commits are added on `main`, so on open (scrolled to the top / newest main commits)
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

				for (let i = 1; i <= 120; i++) {
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
		await clearEdgePin(vscode);
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
		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-a');

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

		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-b');

		const pinnedBefore = await getPinnedRef(graphWebview!);
		expect(pinnedBefore).not.toBeNull();

		await unpinBranch(vscode, graphWebview!, stateInfo!, 'branch-b');

		const pinnedAfter = await getPinnedRef(graphWebview!);
		expect(pinnedAfter).toBeNull();
	});

	test('renders the pin indicator on the pinned pill, and unpin is reachable from it', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		// The branch rows have to be painted for their pills to exist at all — see `ensureDetailsPanelClosed`
		await ensureDetailsPanelClosed(graphWebview!);
		const pill = refPill(graphWebview!, 'branch-a');
		await expect(pill).toBeVisible({ timeout: MaxTimeout });

		// Unpinned: the pill carries no pin control anywhere, but it does carry its kind glyph.
		await expect(pill.locator('.gl-graph__ref-pill-icon--pin')).toHaveCount(0);
		await expect(pill.locator('.gl-graph__ref-pill-main .gl-graph__ref-pill-icon').first()).toBeVisible({
			timeout: MaxTimeout,
		});

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();
		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-a');

		// The pin renders as an at-rest INDICATOR in the leading slot — visible without hovering, since the
		// edge pin is not a `$pill-filled` trigger (the `-expand` overlay stays hidden at rest).
		const indicator = refPillPinIndicator(graphWebview!, 'branch-a');
		await expect(indicator).toBeVisible({ timeout: MaxTimeout });
		await expect(indicator).toHaveAttribute('aria-label', 'Unpin Branch from Edge');
		// At rest it shows the pinned glyph; it swaps to `close` only on hover of the control itself.
		await expect(indicator.locator('code-icon[icon="gl-pinned-filled"]')).toBeVisible({ timeout: MaxTimeout });

		// The real contract is that the pin JOINS the kind glyph rather than replacing it (the glyph is the
		// only thing naming WHAT is pinned), so the pinned leading slot still carries the ref's kind icon
		// next to the pin. The pill is deliberately allowed to grow to fit — this is NOT a no-layout-shift
		// check, which an earlier version wrongly asserted against a `display:none` overlay box.
		await expect(
			pill.locator(
				'.gl-graph__ref-pill-main .gl-graph__ref-pill-pinned-slot .gl-graph__ref-pill-icon:not(.gl-graph__ref-pill-icon--pin)',
			),
		).toBeVisible({ timeout: MaxTimeout });
	});

	test('unpins from the pill without selecting the row or opening the branch sheet', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		await ensureDetailsPanelClosed(graphWebview!);
		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();
		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-a');

		// The at-rest indicator confirms the pin landed; the unpin click itself has to go through the
		// `-expand` overlay copy (see `clickPinControl`).
		await expect(refPillPinIndicator(graphWebview!, 'branch-a')).toBeVisible({ timeout: MaxTimeout });
		await expect(pinnedScrollMarker(graphWebview!).first()).toBeVisible({ timeout: MaxTimeout });

		// The contract `renderPinControl`'s `stopPropagation` exists for: the click must not reach the pill,
		// which selects the row and opens the branch sheet. Captured BEFORE the click so the assertion is
		// about what the click changed, not about what the graph happened to have selected.
		const selectedBefore = await getSelectedShas(graphWebview!);

		await clickPinControl(graphWebview!, 'branch-a', refPillPinControl(graphWebview!, 'branch-a'));

		// Pin cleared everywhere it was shown: state, pill glyph, rail band
		await expect.poll(() => getPinnedRef(graphWebview!), { timeout: MaxTimeout }).toBeNull();
		await expect(refPill(graphWebview!, 'branch-a').locator('.gl-graph__ref-pill-icon--pin')).toHaveCount(0);
		await expect(pinnedScrollMarker(graphWebview!)).toHaveCount(0);

		// ...and the click did nothing else
		expect(await getSelectedShas(graphWebview!)).toEqual(selectedBefore);
		await expect(graphWebview!.locator('gl-graph-branch-sheet-pane, gl-graph-branch-sheet')).toHaveCount(0);
	});

	test('shows the pinned band on the scroll rail only while pinned', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		await ensureDetailsPanelClosed(graphWebview!);
		// The rail itself is always present while any marker type is enabled (it is also the right-click
		// target for its own menu), so the band — not the rail — is what the pin adds.
		await expect(graphWebview!.locator('.gl-graph__scroll-markers')).toBeVisible({ timeout: MaxTimeout });
		await expect(pinnedScrollMarker(graphWebview!)).toHaveCount(0);

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();
		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-b');

		// `pinned` is an always-on marker role — it does not depend on `graph.scrollMarkers.additionalTypes`
		await expect(pinnedScrollMarker(graphWebview!).first()).toBeVisible({ timeout: MaxTimeout });

		await unpinBranch(vscode, graphWebview!, stateInfo!, 'branch-b');
		await expect(pinnedScrollMarker(graphWebview!)).toHaveCount(0);
	});
});

// The jump-to-pinned pill needs the pinned row off-screen, which requires a taller graph than the
// tests above (whose small fixture keeps branch rows on-screen to read their +pinned context).
testTall.describe('Graph — Pin Branch to Edge — jump-to-pinned pill', () => {
	testTall.describe.configure({ mode: 'serial' });

	testTall.afterEach(async ({ vscode }) => {
		await clearEdgePin(vscode);
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

			// Pin branch-c: buried under 120 newer main commits, so its row is loaded but far below the
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

	testTall('adds the pinned segment left of HEAD without moving HEAD', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		// Scroll to the MIDDLE of the range so BOTH the newest (HEAD) and the oldest (branch-c) rows sit
		// off-screen at once: HEAD's waypoint is the capsule's anchor here, and branch-c's row has to be
		// off-screen too for the pinned segment to render. An over-large delta would instead land at the
		// bottom, bringing branch-c back into view.
		await scrollGraphToFraction(graphWebview!, 0.5);

		const head = headWaypoint(graphWebview!);
		await expect(head).toBeVisible({ timeout: MaxTimeout });
		await expect(pinnedWaypoint(graphWebview!)).toHaveCount(0);

		const headBefore = await head.boundingBox();
		expect(headBefore).not.toBeNull();

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();
		await pinBranch(vscode, graphWebview!, stateInfo!, 'branch-c');

		const pinned = pinnedWaypoint(graphWebview!);
		await expect(pinned).toBeVisible({ timeout: MaxTimeout });

		// Both segments in one capsule, pinned first
		await expect(waypointsCapsule(graphWebview!)).toHaveCount(1);

		const pinnedBox = await pinned.boundingBox();
		const headAfter = await head.boundingBox();
		expect(pinnedBox).not.toBeNull();
		expect(headAfter).not.toBeNull();

		// Pinned sits to the LEFT of HEAD...
		expect(pinnedBox!.x + pinnedBox!.width).toBeLessThanOrEqual(headAfter!.x + 1);
		// ...and HEAD's right edge is where it was: the capsule grows leftward, which is the whole point of
		// making HEAD the trailing anchor (a pin appearing must not shift the target the user is aiming at).
		expect(Math.abs(headAfter!.x + headAfter!.width - (headBefore!.x + headBefore!.width))).toBeLessThanOrEqual(1);
	});
});

// The resize-recompute test needs a NON-head branch that is on screen at the resting grid height but
// leaves the viewport when the grid shrinks. `main` (HEAD, row 0) stays pinned to the top on any resize,
// and pinning it collapses into the head waypoint (`pinnedIsHead`) so the pinned segment never renders —
// hence a dedicated branch. `pinme` diverges from the initial commit and `main` is then buried under 6
// newer commits, so pinme lands at a stable ~row 7: within the resting grid (~10 rows) but below the fold
// once the details panel shrinks it (~5 rows). The commit dates are explicit and well separated because
// same-second timestamps let git order same-date commits arbitrarily, which floated pinme's row and made
// the on-screen->off-screen transition flaky; they are anchored an hour ahead of `init()`'s undated
// initial commit so that commit always sorts oldest (bottom) no matter when the suite runs.
const testResize = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				const anchorMs = Date.now() + 60 * 60 * 1000;
				const at = (i: number) => new Date(anchorMs + i * 60_000).toISOString();

				await git.branch('pinme');
				await git.checkout('pinme');
				await git.commit('Commit on pinme', 'pinme.txt', 'pinme change', { date: at(0) });
				await git.checkout('main');
				for (let i = 1; i <= 6; i++) {
					await git.commit(`Main commit ${i}`, `main-${i}.txt`, `main change ${i}`, { date: at(i) });
				}

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

testResize.describe('Graph — Pin Branch to Edge — recompute on resize', () => {
	testResize.describe.configure({ mode: 'serial' });

	testResize.afterEach(async ({ vscode }) => {
		await clearEdgePin(vscode);
		await vscode.gitlens.resetUI();
	});

	// Regression for fdd3c3b7b: before it, the off-screen direction was recomputed only on scroll, so
	// resizing while pinned left the capsule stale. Toggling the details panel resizes the row grid (firing
	// the graph's ResizeObserver) with NO scroll — exactly the path the fix added.
	testResize('recomputes the pinned segment when the grid resizes, without scrolling', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		// Start from the resting grid (details panel closed), where pinme's row is on screen.
		await ensureDetailsPanelClosed(graphWebview!);

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();

		// Pin a NON-head branch whose row is on screen: the pinned waypoint must NOT render yet.
		await pinBranch(vscode, graphWebview!, stateInfo!, 'pinme');
		await expect(pinnedWaypoint(graphWebview!)).toHaveCount(0);

		// Shrink the grid by opening the details panel — no scrolling. pinme's row leaves the viewport and
		// the recompute-on-resize surfaces its segment.
		await toggleDetailsPanel(graphWebview!);
		await expect(pinnedWaypoint(graphWebview!)).toBeVisible({ timeout: MaxTimeout });
		// It is the pin's own segment, not HEAD's — HEAD (row 0) is still on screen at the top.
		await expect(headWaypoint(graphWebview!)).toHaveCount(0);

		// Growing the grid back (closing the panel) brings the row into view again, and the segment goes
		// away on the same resize signal.
		await toggleDetailsPanel(graphWebview!);
		await expect(pinnedWaypoint(graphWebview!)).toHaveCount(0);
	});
});

// #5624's case A needs a row carrying BOTH the current branch and its in-sync upstream, so the two
// combine into one pill. Built offline: `createRemoteBranch` writes `refs/remotes/origin/main` with
// `update-ref` and `setUpstream` writes the tracking config, so no network or bare repo is involved.
const testUpstream = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Initial commit', 'test.txt', 'content');
				await git.commit('Second commit', 'test2.txt', 'more content');

				await git.addRemote('origin', 'https://example.com/gitlens-e2e/pin.git');
				await git.createRemoteBranch('origin', 'main');
				await git.setUpstream('main', 'origin/main');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

testUpstream.describe('Graph — Pin Branch to Edge — pinned upstream on the current row', () => {
	testUpstream.describe.configure({ mode: 'serial' });

	testUpstream.afterEach(async ({ vscode }) => {
		await clearEdgePin(vscode);
		await vscode.gitlens.resetUI();
	});

	// Regression for #5624 case A. The upstream is absorbed into the primary pill's own segment rather
	// than rendered as a `+N` popover row, so before the fix a pin on it had nowhere to show: a deep
	// search of the webview found zero `+pinned` elements, and the pin could not be cleared from the
	// graph at all. It now gets a real control on that segment (`renderUpstreamSegment`).
	testUpstream('surfaces the pin on the combined pill’s upstream segment', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({ state: 6, planId: 'pro' });

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		await ensureDetailsPanelClosed(graphWebview!);
		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();

		// Pin the REMOTE ref while its local counterpart is checked out and in sync
		await pinBranch(vscode, graphWebview!, stateInfo!, 'origin/main', { remote: true });

		// The control lives on the upstream segment, which carries its own class so it can be told apart
		// from the leading-slot pin of a single-ref row
		const upstreamPin = graphWebview!.locator('.gl-graph__ref-pill-icon--pin-upstream').first();
		await expect(upstreamPin).toBeVisible({ timeout: MaxTimeout });
		await expect(upstreamPin).toHaveAttribute('aria-label', 'Unpin Branch from Edge');

		// And it unpins, which is the half that was unreachable from the graph body entirely. The click has
		// to go through the `-expand` overlay copy — hovering the pill hides the in-flow one (see
		// `clickPinControl`).
		await clickPinControl(
			graphWebview!,
			'main',
			graphWebview!.locator('.gl-graph__ref-pill-expand .gl-graph__ref-pill-icon--pin-upstream').first(),
		);
		await expect.poll(() => getPinnedRef(graphWebview!), { timeout: MaxTimeout }).toBeNull();
		await expect(graphWebview!.locator('.gl-graph__ref-pill-icon--pin-upstream')).toHaveCount(0);
	});
});
