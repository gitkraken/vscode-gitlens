import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

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

suite('PausedOperationsGitSubProvider.continuePausedOperation', () => {
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
});
