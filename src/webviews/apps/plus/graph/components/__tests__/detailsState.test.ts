import * as assert from 'assert';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { DetailsState } from '../detailsState.js';
import {
	createDetailsState,
	getActiveTaskAction,
	getOpenComparison,
	shouldRestoreCapturedComparison,
} from '../detailsState.js';

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
		assert.deepStrictEqual(getActiveTaskAction(sheet), {
			action: 'open-compare',
			compare: undefined,
			compareGraphRepoPath: undefined,
		});

		const panel = createDetailsState();
		panel.compareAsPanel.set(true);
		assert.deepStrictEqual(getActiveTaskAction(panel), {
			action: 'open-compare',
			compare: undefined,
			compareGraphRepoPath: undefined,
		});
	});

	test('an open compare carries its refs against its birth-record repo, so the restore reopens the SAME comparison', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		state.branchCompareLeftRef.set('main');
		state.branchCompareLeftRefType.set('branch');
		state.branchCompareRightRef.set('feature');
		state.branchCompareRightRefType.set('branch');
		state.branchCompareIncludeWorkingTree.set(false);
		state.branchCompareGraphRepoPath.set('/repo');

		// Selection has wandered to a secondary worktree; the captured refs must still target the
		// birth-record repo (`/repo`), not the passed selection path.
		assert.deepStrictEqual(getActiveTaskAction(state, '/repo/worktrees/feature'), {
			action: 'open-compare',
			compare: {
				repoPath: '/repo',
				leftRef: 'main',
				leftRefType: 'branch',
				rightRef: 'feature',
				rightRefType: 'branch',
				includeWorkingTree: false,
			},
			compareGraphRepoPath: '/repo',
		});
	});

	test('the passed selection path backs the refs only when there is no birth record', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		state.branchCompareRightRef.set('feature');
		state.branchCompareRightRefType.set('branch');

		assert.strictEqual(getActiveTaskAction(state, '/repo')?.compare?.repoPath, '/repo');
	});

	test('a compare without a right ref falls back to the ref-less capture (default-shape restore)', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		state.branchCompareLeftRef.set('main');

		assert.deepStrictEqual(getActiveTaskAction(state, '/repo'), {
			action: 'open-compare',
			compare: undefined,
			compareGraphRepoPath: undefined,
		});
	});

	test('a compare without a repo path cannot be restored by refs — ref-less capture', () => {
		const state = createDetailsState();
		state.compareAsPanel.set(true);
		state.branchCompareRightRef.set('feature');

		assert.deepStrictEqual(getActiveTaskAction(state), {
			action: 'open-compare',
			compare: undefined,
			compareGraphRepoPath: undefined,
		});
	});

	test('an empty-string repo path counts as no repo path — ref-less capture', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		state.branchCompareRightRef.set('feature');

		assert.deepStrictEqual(getActiveTaskAction(state, ''), {
			action: 'open-compare',
			compare: undefined,
			compareGraphRepoPath: undefined,
		});
	});

	test('an active mode wins over a coexisting open compare', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		enterMode(state, 'review', 'wip', '/repo', uncommitted);

		assert.strictEqual(getActiveTaskAction(state)?.action, 'enter-review');
	});
});

suite('getOpenComparison — the live-comparison probe (#5671)', () => {
	test('no open comparison probes as undefined', () => {
		assert.strictEqual(getOpenComparison(createDetailsState(), '/repo'), undefined);
	});

	test('an open comparison is visible even while a mode sits on top of it', () => {
		const state = createDetailsState();
		state.compareSheetOpen.set(true);
		state.branchCompareRightRef.set('feature');
		state.branchCompareGraphRepoPath.set('/repo');
		enterMode(state, 'review', 'wip', '/repo', uncommitted);

		assert.strictEqual(getActiveTaskAction(state, '/repo')?.action, 'enter-review');
		assert.deepStrictEqual(getOpenComparison(state, '/repo'), {
			compare: {
				repoPath: '/repo',
				leftRef: undefined,
				leftRefType: undefined,
				rightRef: 'feature',
				rightRefType: undefined,
				includeWorkingTree: false,
			},
			graphRepoPath: '/repo',
		});
	});
});

suite('shouldRestoreCapturedComparison — the restore guards (#5671)', () => {
	const refs = { repoPath: '/repo', leftRef: 'main', rightRef: 'feature' };
	const noLive = undefined;
	const liveWithRefs = { compare: { repoPath: '/repo', rightRef: 'other' }, graphRepoPath: '/repo' };
	const liveRefless = { compare: undefined, graphRepoPath: '/repo' };

	test('a witnessed family mismatch restores nothing, refs or not', () => {
		assert.strictEqual(shouldRestoreCapturedComparison(refs, '/a', '/b', noLive), false);
		assert.strictEqual(shouldRestoreCapturedComparison(undefined, '/a', '/b', noLive), false);
	});

	test('an unknown family on either side cannot witness a switch — the capture proceeds', () => {
		assert.strictEqual(shouldRestoreCapturedComparison(refs, undefined, '/b', noLive), true);
		assert.strictEqual(shouldRestoreCapturedComparison(refs, '/a', undefined, noLive), true);
	});

	test('an open ref-carrying live comparison always wins over the capture', () => {
		assert.strictEqual(shouldRestoreCapturedComparison(refs, '/a', '/a', liveWithRefs), false);
	});

	test('a ref-less live comparison yields only to captured refs (same comparison mid-init)', () => {
		assert.strictEqual(shouldRestoreCapturedComparison(refs, '/a', '/a', liveRefless), true);
		assert.strictEqual(shouldRestoreCapturedComparison(undefined, '/a', '/a', liveRefless), false);
	});

	test('matching families with no live comparison restore', () => {
		assert.strictEqual(shouldRestoreCapturedComparison(refs, '/a', '/a', noLive), true);
		assert.strictEqual(shouldRestoreCapturedComparison(undefined, '/a', '/a', noLive), true);
	});
});
