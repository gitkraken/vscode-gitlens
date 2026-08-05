import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

/** Builds `feature` and `main` edits of README.md that conflict with each other. */
function setupDivergedBranches(r: TestRepo): void {
	execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nfeature edit\n', 'Feature edit README');
	execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nmain edit\n', 'Main edit README');
}

/** Cherry-picks `feature`'s commit onto `main`, pausing on the README.md conflict. */
function setupConflictedCherryPick(r: TestRepo): void {
	setupDivergedBranches(r);

	try {
		execFileSync('git', ['cherry-pick', 'feature'], { cwd: r.path, stdio: 'pipe' });
		assert.fail('Expected the cherry-pick to pause on a conflict');
	} catch {
		// Expected: the cherry-pick pauses on the README.md conflict
	}
}

/** Reverts `main`'s last commit, pausing on the README.md conflict a later edit creates. */
function setupConflictedRevert(r: TestRepo): void {
	addCommit(r.path, 'README.md', '# Test Repository\nalpha\n', 'Add alpha');
	const target = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: r.path, encoding: 'utf-8' }).trim();
	addCommit(r.path, 'README.md', '# Test Repository\nbeta\n', 'Replace alpha with beta');

	try {
		execFileSync('git', ['revert', '--no-edit', target], { cwd: r.path, stdio: 'pipe' });
		assert.fail('Expected the revert to pause on a conflict');
	} catch {
		// Expected: the revert pauses on the README.md conflict
	}
}

function resolveReadme(r: TestRepo, content: string): void {
	writeFileSync(join(r.path, 'README.md'), content);
	execFileSync('git', ['add', 'README.md'], { cwd: r.path, stdio: 'pipe' });
}

function getCommitCount(r: TestRepo): number {
	return Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: r.path, encoding: 'utf-8' }).trim());
}

function getSubject(r: TestRepo, rev = 'HEAD'): string {
	return execFileSync('git', ['log', '--format=%s', '-1', rev], { cwd: r.path, encoding: 'utf-8' }).trim();
}

/**
 * Starts a rebase of `feature` onto `main` that pauses with a content conflict in README.md,
 * then resolves and stages the conflict, leaving the repo ready for `rebase --continue`.
 */
function setupConflictedRebase(r: TestRepo): void {
	execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nfeature edit\n', 'Feature edit README');
	execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nmain edit\n', 'Main edit README');
	execFileSync('git', ['checkout', 'feature'], { cwd: r.path, stdio: 'pipe' });

	try {
		execFileSync('git', ['rebase', 'main'], { cwd: r.path, stdio: 'pipe' });
		assert.fail('Expected the rebase to pause on a conflict');
	} catch {
		// Expected: the rebase pauses on the README.md conflict
	}

	writeFileSync(join(r.path, 'README.md'), '# Test Repository\nresolved edit\n');
	execFileSync('git', ['add', 'README.md'], { cwd: r.path, stdio: 'pipe' });
}

/**
 * Starts a rebase of `feature` (two commits, both editing README.md) onto `main`, pausing on the
 * first step's conflict — so skipping or continuing step 1 lands on step 2's conflict.
 */
function setupTwoStepConflictedRebase(r: TestRepo): void {
	execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nfeature one\n', 'Feature commit one');
	addCommit(r.path, 'README.md', '# Test Repository\nfeature two\n', 'Feature commit two');
	execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });
	addCommit(r.path, 'README.md', '# Test Repository\nmain edit\n', 'Main edit README');
	execFileSync('git', ['checkout', 'feature'], { cwd: r.path, stdio: 'pipe' });

	try {
		execFileSync('git', ['rebase', 'main'], { cwd: r.path, stdio: 'pipe' });
		assert.fail('Expected the rebase to pause on a conflict');
	} catch {
		// Expected: the rebase pauses on the first step's README.md conflict
	}
}

suite('PausedOperationsGitSubProvider.continuePausedOperation', () => {
	// `--skip`/`--continue` drive the WHOLE rebase, so a LATER step's conflict exits the command
	// non-zero even though this step did what was asked — and git words it identically to a refusal.
	// Consumers therefore can't trust the reason alone; they have to compare state. Locking that in:
	// the throw and the advance must BOTH happen, so anything reporting "cannot skip" has to check.
	test('a skip that lands on the next step conflicts still advances, despite rejecting', async () => {
		const r = createTestRepo();
		try {
			setupTwoStepConflictedRebase(r);

			const before = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.ok(before?.type === 'rebase');
			assert.strictEqual(before.steps.current.number, 1);

			await assert.rejects(
				r.provider.pausedOps.continuePausedOperation(r.path, { skip: true }),
				(ex: unknown) => PausedOperationContinueError.is(ex, 'conflicts'),
				'Expected the skip to report unresolved conflicts',
			);

			const after = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.ok(after?.type === 'rebase', 'Expected the rebase to still be paused, on the NEXT step');
			assert.strictEqual(after.steps.current.number, 2, 'Expected the skip to have advanced a step');
			assert.notStrictEqual(
				after.steps.current.commit?.ref,
				before.steps.current.commit?.ref,
				'Expected the paused commit to have moved on',
			);
		} finally {
			r.cleanup();
		}
	});

	test('with messageEditor completes a conflicted rebase headlessly and preserves the commit message', async () => {
		const r = createTestRepo();
		try {
			// Force any editor invocation to fail, so success proves the editor was suppressed
			execFileSync('git', ['config', 'core.editor', 'false'], { cwd: r.path, stdio: 'pipe' });
			setupConflictedRebase(r);

			await r.provider.pausedOps.continuePausedOperation(r.path, { messageEditor: 'true' });

			const message = execFileSync('git', ['log', '--format=%s', '-1'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(message, 'Feature edit README');

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.strictEqual(status, undefined, 'Expected the rebase to be finished');
		} finally {
			r.cleanup();
		}
	});

	// The merge backend's `rebase --continue` opens the commit-message editor after a conflicted
	// step; this locks in that assumption (without messageEditor a headless continue fails).
	// An ambient GIT_EDITOR would take precedence over the repo-local core.editor and break the
	// forced failure, so skip in that case.
	(process.env.GIT_EDITOR ? test.skip : test)(
		'without messageEditor a headless continue of a conflicted rebase surfaces the editor failure',
		async () => {
			const r = createTestRepo();
			try {
				execFileSync('git', ['config', 'core.editor', 'false'], { cwd: r.path, stdio: 'pipe' });
				setupConflictedRebase(r);

				await assert.rejects(
					r.provider.pausedOps.continuePausedOperation(r.path),
					(ex: unknown) => ex instanceof PausedOperationContinueError,
				);
			} finally {
				r.cleanup();
			}
		},
	);

	test('with allowEmpty records the empty commit and concludes the cherry-pick', async () => {
		const r = createTestRepo();
		try {
			// The allowEmpty commit passes no `core.editor`/`GIT_EDITOR` of its own — it relies solely on
			// `--no-edit`. Force any editor invocation to fail so a regression that drops it can't pass.
			execFileSync('git', ['config', 'core.editor', 'false'], { cwd: r.path, stdio: 'pipe' });
			setupConflictedCherryPick(r);
			// Resolving to main's own content leaves the pick with nothing to apply
			resolveReadme(r, '# Test Repository\nmain edit\n');

			await assert.rejects(
				r.provider.pausedOps.continuePausedOperation(r.path, { messageEditor: 'true' }),
				(ex: unknown) => PausedOperationContinueError.is(ex, 'emptyCommit'),
			);

			const before = getCommitCount(r);
			await r.provider.pausedOps.continuePausedOperation(r.path, { allowEmpty: true, messageEditor: 'true' });

			assert.strictEqual(getCommitCount(r), before + 1, 'Expected the empty commit to be recorded');
			assert.strictEqual(getSubject(r), 'Feature edit README');

			const diff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(diff, '', 'Expected the recorded commit to be empty');

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.strictEqual(status, undefined, 'Expected the cherry-pick to be finished');
		} finally {
			r.cleanup();
		}
	});

	test('with allowEmpty records the empty commit and concludes the revert', async () => {
		const r = createTestRepo();
		try {
			execFileSync('git', ['config', 'core.editor', 'false'], { cwd: r.path, stdio: 'pipe' });
			setupConflictedRevert(r);
			// Resolving to HEAD's own content leaves the revert with nothing to apply
			resolveReadme(r, '# Test Repository\nbeta\n');

			await assert.rejects(
				r.provider.pausedOps.continuePausedOperation(r.path, { messageEditor: 'true' }),
				(ex: unknown) => PausedOperationContinueError.is(ex, 'emptyCommit'),
			);

			const before = getCommitCount(r);
			await r.provider.pausedOps.continuePausedOperation(r.path, { allowEmpty: true, messageEditor: 'true' });

			assert.strictEqual(getCommitCount(r), before + 1, 'Expected the empty commit to be recorded');
			assert.strictEqual(getSubject(r), 'Revert "Add alpha"');

			const diff = execFileSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(diff, '', 'Expected the recorded commit to be empty');

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.strictEqual(status, undefined, 'Expected the revert to be finished');
		} finally {
			r.cleanup();
		}
	});

	test('completes a conflicted revert headlessly', async () => {
		const r = createTestRepo();
		try {
			// Force any editor invocation to fail, so success proves the editor was suppressed
			execFileSync('git', ['config', 'core.editor', 'false'], { cwd: r.path, stdio: 'pipe' });
			setupConflictedRevert(r);
			resolveReadme(r, '# Test Repository\nresolved\n');

			await r.provider.pausedOps.continuePausedOperation(r.path, { messageEditor: 'true' });

			assert.strictEqual(getSubject(r), 'Revert "Add alpha"');

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.strictEqual(status, undefined, 'Expected the revert to be finished');
		} finally {
			r.cleanup();
		}
	});
});

suite('PausedOperationsGitSubProvider.getPausedOperationStatus', () => {
	test('a paused cherry-pick names the commit it is applying', async () => {
		const r = createTestRepo();
		try {
			setupConflictedCherryPick(r);

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.ok(status?.type === 'cherry-pick');
			assert.strictEqual(status.incoming.message, 'Feature edit README');
			assert.strictEqual(status.HEAD.message, 'Feature edit README');
		} finally {
			r.cleanup();
		}
	});

	test('a paused revert names the commit it is reverting', async () => {
		const r = createTestRepo();
		try {
			setupConflictedRevert(r);

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.ok(status?.type === 'revert');
			assert.strictEqual(status.incoming.message, 'Add alpha');
		} finally {
			r.cleanup();
		}
	});

	// Once a conflicted step is committed by hand, CHERRY_PICK_HEAD is gone and only `sequencer/todo`
	// describes the run — the subject has to come off the todo line itself.
	test('a sequencer-driven cherry-pick names the commit from its todo line', async () => {
		const r = createTestRepo();
		try {
			execFileSync('git', ['checkout', '-b', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'README.md', '# Test Repository\nfeature one\n', 'Feature commit one');
			addCommit(r.path, 'README.md', '# Test Repository\nfeature two\n', 'Feature commit two');
			execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'README.md', '# Test Repository\nmain edit\n', 'Main edit README');

			try {
				execFileSync('git', ['cherry-pick', 'feature~1', 'feature'], { cwd: r.path, stdio: 'pipe' });
				assert.fail('Expected the cherry-pick to pause on a conflict');
			} catch {
				// Expected: the first pick conflicts
			}

			resolveReadme(r, '# Test Repository\nresolved\n');
			execFileSync('git', ['commit', '--no-edit'], { cwd: r.path, stdio: 'pipe' });

			const status = await r.provider.pausedOps.getPausedOperationStatus(r.path, { force: true });
			assert.ok(status?.type === 'cherry-pick');
			assert.strictEqual(status.incoming.message, 'Feature commit one');
		} finally {
			r.cleanup();
		}
	});
});
