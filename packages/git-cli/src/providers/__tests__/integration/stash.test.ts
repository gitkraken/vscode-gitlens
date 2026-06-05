import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TestRepo } from './helpers.js';
import { addCommit, createStash, createTestRepo, getHeadSha } from './helpers.js';

suite('StashSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		createStash(repo.path, 'Test stash 1');
		createStash(repo.path, 'Test stash 2');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getStash returns stashes', async () => {
		const stash = await repo.provider.stash?.getStash(repo.path);
		assert.ok(stash, 'Stash should not be undefined');
		assert.ok(stash.stashes?.size, 'Should have stash entries');
		assert.ok(stash.stashes.size >= 2, `Expected at least 2 stashes, got ${stash.stashes.size}`);
	});

	test('stash commits have messages', async () => {
		const stash = await repo.provider.stash?.getStash(repo.path);
		assert.ok(stash?.stashes, 'Should have stash entries');

		for (const [, commit] of stash.stashes) {
			assert.ok(commit.message, `Stash ${commit.sha.slice(0, 8)} should have a message`);
		}
	});
});

suite('StashSubProvider.createStash', () => {
	test('returns SHA when working tree is dirty', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'README.md'), '# Test Repository\nmodified\n');
			const sha = await r.provider.stash?.createStash(r.path, 'snapshot');
			assert.ok(sha, 'Expected a SHA from createStash');
			assert.match(sha, /^[0-9a-f]{40}$/, 'Expected a full git SHA');

			// Working tree should still be dirty — createStash does NOT push onto the stash list
			// or reset the index/working tree. Verify by reading the file.
			const content = readFileSync(join(r.path, 'README.md'), 'utf-8');
			assert.ok(content.includes('modified'), 'createStash should not reset the working tree');

			// Stash list should remain empty
			const list = await r.provider.stash?.getStash(r.path);
			assert.strictEqual(list?.stashes.size ?? 0, 0, 'createStash should not add to the stash list');
		} finally {
			r.cleanup();
		}
	});

	test('returns undefined when working tree is clean', async () => {
		const r = createTestRepo();
		try {
			const sha = await r.provider.stash?.createStash(r.path);
			assert.strictEqual(sha, undefined, 'Expected undefined on clean repo');
		} finally {
			r.cleanup();
		}
	});
});

suite('StashSubProvider.applyStash (by SHA)', () => {
	test('applies a stash-like commit by SHA (no stash list entry required)', async () => {
		const r = createTestRepo();
		try {
			// Dirty the tree, snapshot via createStash (no list entry), reset, then apply by SHA
			writeFileSync(join(r.path, 'applied.txt'), 'applied content\n');
			execFileSync('git', ['add', 'applied.txt'], { cwd: r.path, stdio: 'pipe' });

			const sha = await r.provider.stash?.createStash(r.path, 'snapshot');
			assert.ok(sha, 'Expected a SHA');

			// Reset to a clean state — file gone
			execFileSync('git', ['reset', '--hard', 'HEAD'], { cwd: r.path, stdio: 'pipe' });
			assert.throws(
				() => readFileSync(join(r.path, 'applied.txt'), 'utf-8'),
				'File should not exist after reset',
			);

			const result = await r.provider.stash?.applyStash(r.path, sha);
			assert.ok(result, 'Expected a result');
			assert.strictEqual(result.conflicted, false);
			assert.strictEqual(readFileSync(join(r.path, 'applied.txt'), 'utf-8'), 'applied content\n');
		} finally {
			r.cleanup();
		}
	});
});

suite('StashSubProvider.saveStash', () => {
	test('keeps staged changes when including untracked files (no pathspecs)', async () => {
		// Regression for #5281: "Stash Unstaged Changes" (with an untracked file involved) must keep
		// staged changes intact. The SCM group action passes { includeUntracked: true, keepIndex: true }
		// with no pathspecs, which must run `git stash push --keep-index --include-untracked`. A prior
		// bug dropped --keep-index whenever --include-untracked was present, stashing everything —
		// including the staged changes.
		const r = createTestRepo();
		try {
			// One committed file we'll stage a change to, and another we'll modify but leave unstaged
			addCommit(r.path, 'staged.txt', 'staged base\n', 'add staged.txt');
			addCommit(r.path, 'unstaged.txt', 'unstaged base\n', 'add unstaged.txt');

			// Staged change
			writeFileSync(join(r.path, 'staged.txt'), 'staged base\nstaged edit\n');
			execFileSync('git', ['add', 'staged.txt'], { cwd: r.path, stdio: 'pipe' });
			// Unstaged change to a tracked file
			writeFileSync(join(r.path, 'unstaged.txt'), 'unstaged base\nunstaged edit\n');
			// Untracked file
			writeFileSync(join(r.path, 'untracked.txt'), 'untracked\n');

			await r.provider.stash?.saveStash(r.path, 'unstaged + untracked', undefined, {
				includeUntracked: true,
				keepIndex: true,
			});

			// The staged change must still be staged (kept in the index)
			const staged = execFileSync('git', ['diff', '--cached', '--name-only'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(
				staged,
				'staged.txt',
				'Staged change must remain staged after stashing unstaged + untracked',
			);

			// The unstaged change must have been stashed away (file reverted to its committed content)
			assert.strictEqual(
				readFileSync(join(r.path, 'unstaged.txt'), 'utf-8'),
				'unstaged base\n',
				'Unstaged change should have been stashed',
			);
			// The untracked file must have been stashed away (removed from the working tree)
			assert.throws(
				() => readFileSync(join(r.path, 'untracked.txt'), 'utf-8'),
				'Untracked file should have been stashed',
			);

			// Exactly one stash entry should have been created
			const stash = await r.provider.stash?.getStash(r.path);
			assert.strictEqual(stash?.stashes.size, 1, 'Expected exactly one stash entry');
		} finally {
			r.cleanup();
		}
	});

	test('avoids the git --keep-index + --include-untracked pathspec bug', async () => {
		// `git stash push --keep-index --include-untracked -- <untracked>` errors in git
		// ("error: pathspec ... did not match any file(s) known to git"). When pathspecs are supplied
		// alongside includeUntracked, --keep-index must be dropped so the stash still succeeds.
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'untracked.txt'), 'untracked\n');

			await assert.doesNotReject(
				() =>
					r.provider.stash?.saveStash(r.path, 'untracked only', [join(r.path, 'untracked.txt')], {
						includeUntracked: true,
						keepIndex: true,
					}),
				'Stashing an untracked file by pathspec should not hit the git --keep-index bug',
			);

			const stash = await r.provider.stash?.getStash(r.path);
			assert.strictEqual(stash?.stashes.size, 1, 'Expected the untracked file to be stashed');
		} finally {
			r.cleanup();
		}
	});
});

suite('CommitsSubProvider.getLog with stashes after rebase', () => {
	test('does not include pre-rebase commits anchored only by the stash', async () => {
		// Regression: a stash on a branch was anchoring its parent chain into the branch
		// log via `git log <ref> --stdin <stash> <stash^2>`, leaking commits no longer
		// reachable from the branch tip after a rebase / reset.
		const r = createTestRepo();
		try {
			// Layout:
			//   A (initial) - B - C   <- stash created on top of C
			// After reset:
			//   A - D                 <- main now; B and C unreachable from main
			const shaA = getHeadSha(r.path);
			addCommit(r.path, 'b.txt', 'b\n', 'Commit B', { date: '2024-01-02T00:00:00Z' });
			const shaB = getHeadSha(r.path);
			addCommit(r.path, 'c.txt', 'c\n', 'Commit C', { date: '2024-01-03T00:00:00Z' });
			const shaC = getHeadSha(r.path);

			createStash(r.path, 'wip');

			execFileSync('git', ['reset', '--hard', shaA], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'd.txt', 'd\n', 'Commit D', { date: '2024-01-04T00:00:00Z' });
			const shaD = getHeadSha(r.path);

			// Use 'main' (not 'HEAD') so `getStash({reachableFrom})` matches `stashOnRef`
			// (parsed from the `On main: …` stash subject) and the stash actually reaches
			// the merge step — otherwise the leak path isn't exercised.
			const log = await r.provider.commits.getLog(r.path, 'main', { stashes: true, limit: 50 });
			assert.ok(log, 'Expected a log result');

			const shas = new Set(log.commits.keys());
			assert.ok(shas.has(shaA), 'Branch tip ancestor A must be present');
			assert.ok(shas.has(shaD), 'New tip D must be present');
			assert.strictEqual(shas.has(shaB), false, 'Pre-reset commit B must not leak via stash');
			assert.strictEqual(shas.has(shaC), false, 'Pre-reset commit C must not leak via stash');

			// The stash's first parent (C) was reset away, so the stash has no anchor in the
			// branch result and is dropped. The dedicated Stashes view still surfaces it.
			const stashCount = [...log.commits.values()].filter(c => c.refType === 'stash').length;
			assert.strictEqual(stashCount, 0, 'Stash without a reachable parent should not appear in this view');
		} finally {
			r.cleanup();
		}
	});

	test('places a stash directly above its parent commit when the parent is in the branch', async () => {
		// Layout:
		//   A - B - C   <- stash created on top of B (not C)
		// Branch is unchanged. The stash's parent (B) is still reachable, so the stash should
		// sit immediately above B in the result, not be ordered purely by date.
		const r = createTestRepo();
		try {
			addCommit(r.path, 'b.txt', 'b\n', 'Commit B', { date: '2024-01-02T00:00:00Z' });
			const shaB = getHeadSha(r.path);

			// Create the stash on top of B (parent[0] = B)
			createStash(r.path, 'wip-on-b');

			// Now add C on top of B (after stash, but C has a more recent date than the stash)
			addCommit(r.path, 'c.txt', 'c\n', 'Commit C', { date: '2024-12-31T00:00:00Z' });
			const shaC = getHeadSha(r.path);

			const log = await r.provider.commits.getLog(r.path, 'main', { stashes: true, limit: 50 });
			assert.ok(log, 'Expected a log result');

			// Walk the result map (preserves insertion order) and assert ordering: C → stash → B
			const order = Array.from(log.commits.values(), c => ({ sha: c.sha, isStash: c.refType === 'stash' }));
			const cIdx = order.findIndex(e => e.sha === shaC);
			const bIdx = order.findIndex(e => e.sha === shaB);
			const stashIdx = order.findIndex(e => e.isStash);

			assert.ok(cIdx >= 0 && bIdx >= 0 && stashIdx >= 0, 'C, B, and stash must all be present');
			assert.ok(
				cIdx < stashIdx && stashIdx < bIdx,
				`Stash should sit between C and its parent B (got order: C@${cIdx}, stash@${stashIdx}, B@${bIdx}). ` +
					`Pure date-sorting would have placed C above the stash; parent-matching anchors the stash to B.`,
			);
		} finally {
			r.cleanup();
		}
	});
});
