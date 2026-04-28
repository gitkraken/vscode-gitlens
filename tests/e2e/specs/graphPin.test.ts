/**
 * GitLens Graph — Pin Branch to Left E2E Tests
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

const hasPinButtonScript = `(() => {
	function find(root) {
		const btn = root.querySelector('.jump-to-pinned-branch');
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

const test = base.extend({
	vscodeOptions: [
		{
			vscodeVersion: process.env.VSCODE_VERSION ?? 'stable',
			setup: async () => {
				const repoDir = await createTmpDir();
				const git = new GitFixture(repoDir);
				await git.init();

				await git.commit('Initial commit', 'test.txt', 'content');

				await git.branch('branch-a');
				await git.branch('branch-b');
				await git.branch('branch-c');

				return repoDir;
			},
		},
		{ scope: 'worker' },
	],
});

test.describe.configure({ mode: 'serial' });

test.describe('Graph — Pin Branch to Left', () => {
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
		await vscode.executeCommand('gitlens.graph.pinBranchToLeft', {
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

		// Verify the webviewItem context includes +pinned (rows re-processed after pin)
		const pinnedItem = await getPinnedWebviewItem(graphWebview!);
		expect(pinnedItem).not.toBeNull();
		expect(pinnedItem).toContain('+pinned');
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

		await vscode.executeCommand('gitlens.graph.pinBranchToLeft', {
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

		await vscode.executeCommand('gitlens.graph.unpinBranchFromLeft', {
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

	test('should show jump-to-pinned-branch button only when pinned', async ({ vscode }) => {
		using _ = await vscode.gitlens.startSubscriptionSimulation({
			state: 6,
			planId: 'pro',
		});

		await vscode.gitlens.showCommitGraphView();
		const graphWebview = await vscode.gitlens.commitGraphViewWebview;
		expect(graphWebview).not.toBeNull();
		await vscode.page.waitForTimeout(3000);

		expect(await hasPinButton(graphWebview!)).toBe(false);

		const stateInfo = await getGraphState(graphWebview!);
		expect(stateInfo).not.toBeNull();

		await vscode.executeCommand('gitlens.graph.pinBranchToLeft', {
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
		await vscode.page.waitForTimeout(1500);

		expect(await hasPinButton(graphWebview!)).toBe(true);
	});
});
