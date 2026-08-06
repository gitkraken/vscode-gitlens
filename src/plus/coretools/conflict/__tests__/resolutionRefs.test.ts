import * as assert from 'assert';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import { getResolutionRefs } from '../resolutionRefs.js';

/** A paused-op status carrying only the fields {@link getResolutionRefs} reads. */
function status(
	type: GitPausedOperationStatus['type'],
	options?: { head?: string; stepCommit?: string; noMergeBase?: boolean },
): GitPausedOperationStatus {
	return {
		type: type,
		repoPath: '/repo',
		// The trap this module exists for: `HEAD` is the operation's INCOMING pseudo-ref, never git's HEAD.
		HEAD: { ref: options?.head ?? 'incoming-sha' },
		current: { ref: 'refs/heads/main' },
		incoming: { ref: 'refs/heads/feature' },
		mergeBase: options?.noMergeBase ? undefined : 'base-sha',
		steps: {
			current: { number: 1, commit: options?.stepCommit != null ? { ref: options.stepCommit } : undefined },
			total: 1,
		},
	} as unknown as GitPausedOperationStatus;
}

suite('coretools/conflict/resolutionRefs', () => {
	test('never diffs a side against itself', () => {
		// The regression this exists for: both call sites read `status.HEAD` as "ours", but it is the
		// incoming ref for every operation type — so the prompt's three-way diff carried the same diff
		// twice, which reads to the model as "both sides made the same change" rather than a conflict.
		for (const type of ['merge', 'cherry-pick', 'revert', 'rebase'] as const) {
			const refs = getResolutionRefs(status(type));
			assert.notStrictEqual(refs?.ours, refs?.theirs, `${type} must diff two different sides`);
		}
	});

	test('maps a merge to HEAD vs MERGE_HEAD', () => {
		assert.deepStrictEqual(getResolutionRefs(status('merge', { head: 'merge-head-sha' })), {
			ours: 'HEAD',
			theirs: 'merge-head-sha',
			base: 'base-sha',
		});
	});

	test('maps a cherry-pick to HEAD vs CHERRY_PICK_HEAD', () => {
		assert.deepStrictEqual(getResolutionRefs(status('cherry-pick', { head: 'pick-sha' })), {
			ours: 'HEAD',
			theirs: 'pick-sha',
			base: 'base-sha',
		});
	});

	test('maps a revert to the parent of REVERT_HEAD, not the commit itself', () => {
		// git's "theirs" in a revert is the state BEFORE the reverted commit. Both call sites used to
		// send the commit itself — the state being undone, i.e. the opposite of the intent.
		assert.strictEqual(getResolutionRefs(status('revert', { head: 'revert-sha' }))?.theirs, 'revert-sha^');
	});

	test('maps a rebase to HEAD vs the commit being applied', () => {
		// "ours" is git's HEAD rather than `onto`/`current`: from step 2 on, ours is onto PLUS the
		// already-applied commits, and only HEAD points at that.
		assert.deepStrictEqual(
			getResolutionRefs(status('rebase', { head: 'rebase-head-sha', stepCommit: 'step-commit-sha' })),
			{ ours: 'HEAD', theirs: 'step-commit-sha', base: 'base-sha' },
		);
	});

	test('falls back to REBASE_HEAD when the step commit is unknown', () => {
		assert.strictEqual(getResolutionRefs(status('rebase', { head: 'rebase-head-sha' }))?.theirs, 'rebase-head-sha');
	});

	test('omits base when the merge base is unknown', () => {
		// `base` is optional on `ResolutionRefs` and the library computes its own when absent, so an
		// explicit `undefined` must not be sent.
		const refs = getResolutionRefs(status('merge', { noMergeBase: true }));

		assert.strictEqual(refs != null && 'base' in refs, false);
	});

	test('returns undefined without a paused operation', () => {
		assert.strictEqual(getResolutionRefs(undefined), undefined);
	});
});
