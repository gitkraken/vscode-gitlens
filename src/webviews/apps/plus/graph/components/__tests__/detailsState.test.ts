import * as assert from 'assert';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { DetailsState } from '../detailsState.js';
import { createDetailsState, getActiveTaskAction } from '../detailsState.js';

function enterMode(
	state: DetailsState,
	mode: 'review' | 'compose' | 'resolve',
	context: 'wip' | 'commit' | 'multicommit',
	repoPath: string,
	sha: string,
	shas?: string[],
): void {
	state.activeMode.set(mode);
	state.activeModeContext.set(context);
	state.activeModeRepoPath.set(repoPath);
	state.activeModeSha.set(sha);
	state.activeModeShas.set(shas);
}

suite('getActiveTaskAction — the account-gate task capture (#5534)', () => {
	test('no active mode and no open compare captures nothing', () => {
		const state = createDetailsState();
		assert.strictEqual(getActiveTaskAction(state), undefined);
	});

	test('a WIP-anchored mode carries its worktree, so a secondary worktree restores in place', () => {
		const state = createDetailsState();
		enterMode(state, 'resolve', 'wip', '/repo/worktrees/feature', uncommitted);

		assert.deepStrictEqual(getActiveTaskAction(state), {
			action: 'enter-resolve',
			target: { sha: uncommitted, worktreePath: '/repo/worktrees/feature', filePaths: undefined },
		});
	});

	test('a file-scoped resolve carries its scope, so the restore does not widen to all conflicts', () => {
		const state = createDetailsState();
		enterMode(state, 'resolve', 'wip', '/repo', uncommitted);
		state.resolveFocusedFilePaths.set(['src/a.ts', 'src/b.ts']);

		assert.deepStrictEqual(getActiveTaskAction(state)?.target?.filePaths, ['src/a.ts', 'src/b.ts']);
	});

	test('the resolve file scope does not leak into other modes', () => {
		const state = createDetailsState();
		enterMode(state, 'review', 'wip', '/repo', uncommitted);
		state.resolveFocusedFilePaths.set(['src/a.ts']);

		assert.strictEqual(getActiveTaskAction(state)?.target?.filePaths, undefined);
	});

	test('a single-commit anchor carries the commit, not the working changes', () => {
		const state = createDetailsState();
		enterMode(state, 'review', 'commit', '/repo', 'abc123');

		assert.deepStrictEqual(getActiveTaskAction(state), {
			action: 'enter-review',
			target: { sha: 'abc123', worktreePath: '/repo', filePaths: undefined },
		});
	});

	test('a multi-commit anchor is not representable in a show target — mode only', () => {
		const state = createDetailsState();
		enterMode(state, 'compose', 'multicommit', '/repo', 'abc123', ['abc123', 'def456']);

		assert.deepStrictEqual(getActiveTaskAction(state), { action: 'enter-compose', target: undefined });
	});

	test('an open compare (sheet or panel form) captures open-compare', () => {
		const sheet = createDetailsState();
		sheet.compareSheetOpen.set(true);
		assert.deepStrictEqual(getActiveTaskAction(sheet), { action: 'open-compare' });

		const panel = createDetailsState();
		panel.compareAsPanel.set(true);
		assert.deepStrictEqual(getActiveTaskAction(panel), { action: 'open-compare' });
	});

	test('an active mode wins over a coexisting open compare', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		enterMode(state, 'review', 'wip', '/repo', uncommitted);

		assert.strictEqual(getActiveTaskAction(state)?.action, 'enter-review');
	});
});
