import * as assert from 'assert';
import {
	isSidebarOriginContext,
	markSidebarInlineInvocation,
	resolveSidebarContextMenuAction,
} from '../graphSidebarActionTelemetry.js';

suite('resolveSidebarContextMenuAction', () => {
	test('resolves a context-menu-only remote command', () => {
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.pruneRemote:graph', 'gitlens:remote'), {
			type: 'remote',
			action: 'prune',
		});
	});

	test('resolves a dual-surface command (fetch) per item type', () => {
		// Same command id is contributed on multiple item types — the item type decides the panel.
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.fetch:graph', 'gitlens:branch+current'), {
			type: 'branch',
			action: 'fetch',
		});
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.fetch:graph', 'gitlens:worktree'), {
			type: 'worktree',
			action: 'fetch',
		});
	});

	test('resolves a shared command id to the right panel action', () => {
		// renameBranch is contributed on both branch and worktree items.
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.graph.renameBranch', 'gitlens:branch'), {
			type: 'branch',
			action: 'rename',
		});
		assert.deepStrictEqual(
			resolveSidebarContextMenuAction('gitlens.graph.renameBranch', 'gitlens:worktree+active'),
			{
				type: 'worktree',
				action: 'rename',
			},
		);
	});

	test('resolves stash and tag commands', () => {
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.stashRename:graph', 'gitlens:stash'), {
			type: 'stash',
			action: 'rename',
		});
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.graph.deleteTag', 'gitlens:tag'), {
			type: 'tag',
			action: 'delete',
		});
		// createBranch is mapped for tags (create branch from tag) but not for branches/worktrees (trimmed out).
		assert.deepStrictEqual(resolveSidebarContextMenuAction('gitlens.createBranch:graph', 'gitlens:tag'), {
			type: 'tag',
			action: 'createBranch',
		});
	});

	test('returns undefined for commands intentionally excluded from the curated set', () => {
		// AI / compose / compare / view-state commands are not instrumented via *Action.
		assert.strictEqual(
			resolveSidebarContextMenuAction('gitlens.ai.explainBranch:graph', 'gitlens:branch'),
			undefined,
		);
		assert.strictEqual(
			resolveSidebarContextMenuAction('gitlens.graph.hideLocalBranch', 'gitlens:branch'),
			undefined,
		);
		assert.strictEqual(resolveSidebarContextMenuAction('gitlens.createBranch:graph', 'gitlens:branch'), undefined);
	});

	test('returns undefined for an unknown or missing item type', () => {
		assert.strictEqual(resolveSidebarContextMenuAction('gitlens.pruneRemote:graph', 'gitlens:file'), undefined);
		assert.strictEqual(resolveSidebarContextMenuAction('gitlens.pruneRemote:graph', undefined), undefined);
	});

	test('returns undefined when the command is not in the item type map', () => {
		assert.strictEqual(resolveSidebarContextMenuAction('gitlens.stashRename:graph', 'gitlens:remote'), undefined);
	});

	test('remote branches (branch+remote) are excluded — both surfaces leave them to graph/command', () => {
		// The Branches panel (and its branchAction metric) is local-only, and the inline path emits
		// nothing for the remote-branch leaves nested under the Remotes panel — so the context-menu
		// side must not attribute their actions to branchAction either.
		assert.strictEqual(
			resolveSidebarContextMenuAction('gitlens.graph.mergeBranchInto', 'gitlens:branch+remote'),
			undefined,
		);
		assert.strictEqual(
			resolveSidebarContextMenuAction('gitlens.switchToBranch:graph', 'gitlens:branch+remote+pinned'),
			undefined,
		);
	});

	test('inline-tracked compare actions resolve for context-menu parity', () => {
		// These two are tracked by the inline branch chips, so they must resolve here too or the
		// action×location slice would wrongly show compares as inline-only.
		assert.deepStrictEqual(
			resolveSidebarContextMenuAction('gitlens.graph.compareBranchWithHead', 'gitlens:branch'),
			{ type: 'branch', action: 'compareWithHead' },
		);
		assert.deepStrictEqual(
			resolveSidebarContextMenuAction('gitlens.graph.compareWithWorking', 'gitlens:branch+current'),
			{ type: 'branch', action: 'compareWithWorking' },
		);
	});
});

suite('markSidebarInlineInvocation', () => {
	test('a marked sidebar context is rejected by the context-menu gate', () => {
		// The no-double-count invariant: onSidebarAction marks the parsed context before
		// executeCommand, so the wrapped handler's context-menu emit must skip it.
		const ctx = { webview: 'gitlens.views.graph', webviewItemOrigin: 'sidebar', webviewItem: 'gitlens:branch' };
		assert.strictEqual(isSidebarOriginContext(ctx), true);
		markSidebarInlineInvocation(ctx);
		assert.strictEqual(isSidebarOriginContext(ctx), false);
	});
});

suite('isSidebarOriginContext', () => {
	test('accepts a sidebar-stamped context', () => {
		assert.strictEqual(
			isSidebarOriginContext({
				webview: 'gitlens.views.graph',
				webviewItemOrigin: 'sidebar',
				webviewItem: 'gitlens:branch',
			}),
			true,
		);
	});

	test('rejects contexts from other graph surfaces (canvas ref pills, WIP kebab) that lack the origin stamp', () => {
		// graphRowProcessor.ts and the WIP details-header kebab produce the same webviewItem types
		// but never stamp webviewItemOrigin — those must not count as sidebar actions.
		assert.strictEqual(
			isSidebarOriginContext({ webview: 'gitlens.views.graph', webviewItem: 'gitlens:branch+current' }),
			false,
		);
		assert.strictEqual(isSidebarOriginContext({ webviewItem: 'gitlens:stash' }), false);
	});

	test('rejects inline invocations (origin re-stamped by onSidebarAction)', () => {
		// The inline (hover-icon) path re-stamps the parsed context to 'sidebar-inline' — the
		// webview already emitted that action with location:'inline', so the context-menu emit
		// must not fire for it (dual-surface commands like fetch would double-count).
		assert.strictEqual(
			isSidebarOriginContext({
				webview: 'gitlens.views.graph',
				webviewItemOrigin: 'sidebar-inline',
				webviewItem: 'gitlens:branch',
			}),
			false,
		);
	});

	test('rejects non-object and mismatched-origin contexts', () => {
		assert.strictEqual(isSidebarOriginContext(undefined), false);
		assert.strictEqual(isSidebarOriginContext(null), false);
		assert.strictEqual(isSidebarOriginContext('sidebar'), false);
		assert.strictEqual(isSidebarOriginContext({ webviewItemOrigin: 'graph-row' }), false);
	});
});
