import * as assert from 'assert';
import { isSidebarOriginContext, resolveSidebarContextMenuAction } from '../graphSidebarContextMenuTelemetry.js';

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

	test('rejects non-object and mismatched-origin contexts', () => {
		assert.strictEqual(isSidebarOriginContext(undefined), false);
		assert.strictEqual(isSidebarOriginContext(null), false);
		assert.strictEqual(isSidebarOriginContext('sidebar'), false);
		assert.strictEqual(isSidebarOriginContext({ webviewItemOrigin: 'graph-row' }), false);
	});
});
