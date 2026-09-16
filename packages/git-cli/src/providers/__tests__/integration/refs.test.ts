import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { ReferenceUpdateError } from '@gitlens/git/errors.js';
import type { TestRepo } from './helpers.js';
import { addCommit, addWorktree, createBranch, createTag, createTestRepo, getHeadSha, revParse } from './helpers.js';

/** 40 hex chars — well-formed but not an object any test repo here ever writes. */
const unknownSha = 'd34dbeefd34dbeefd34dbeefd34dbeefd34dbeef';

/** The ref's own name when it exists, or an empty string when it doesn't. */
function listRef(repoPath: string, ref: string): string {
	return execFileSync('git', ['for-each-ref', '--format=%(refname)', ref], {
		cwd: repoPath,
		encoding: 'utf-8',
	}).trim();
}

suite('RefsSubProvider', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		createBranch(repo.path, 'feature/refs-test');
		createTag(repo.path, 'v1.0.0');
		addCommit(repo.path, 'file2.txt', 'content', 'Third commit');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('isValidReference validates HEAD', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'HEAD');
		assert.strictEqual(valid, true);
	});

	test('isValidReference validates a branch name', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'main');
		assert.strictEqual(valid, true);
	});

	test('isValidReference validates a tag name', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'v1.0.0');
		assert.strictEqual(valid, true);
	});

	test('isValidReference rejects invalid refs', async () => {
		const valid = await repo.provider.refs.isValidReference(repo.path, 'nonexistent-ref-12345');
		assert.strictEqual(valid, false);
	});

	test('getMergeBase finds common ancestor', async () => {
		const mergeBase = await repo.provider.refs.getMergeBase(repo.path, 'main', 'feature/refs-test');
		assert.ok(mergeBase, 'Should find merge base');
		assert.ok(mergeBase.length >= 7, 'Merge base should be a valid sha');
	});

	test('getMergeBase between HEAD and HEAD~1', async () => {
		const mergeBase = await repo.provider.refs.getMergeBase(repo.path, 'HEAD', 'HEAD~1');
		assert.ok(mergeBase, 'Should find merge base');
		// Merge base of HEAD and HEAD~1 should be HEAD~1
		const head1 = getHeadSha(repo.path).slice(0, 7);
		assert.notStrictEqual(mergeBase.slice(0, 7), head1, 'Merge base should not be HEAD itself');
	});

	test('hasBranchOrTag returns true when branches exist', async () => {
		const has = await repo.provider.refs.hasBranchOrTag(repo.path);
		assert.strictEqual(has, true);
	});

	test('getReference resolves a branch name', async () => {
		const ref = await repo.provider.refs.getReference(repo.path, 'main');
		assert.ok(ref, 'Should resolve main');
		assert.strictEqual(ref.name, 'main');
		assert.strictEqual(ref.refType, 'branch');
	});
});

suite('RefsSubProvider ref updates', () => {
	let repo: TestRepo;
	let c1: string;
	let c2: string;

	setup(() => {
		repo = createTestRepo();
		c1 = getHeadSha(repo.path);
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		c2 = getHeadSha(repo.path);
	});

	teardown(() => {
		repo.cleanup();
	});

	test('CAS update succeeds when expected matches', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c2, { expected: c1 });

		assert.strictEqual(revParse(repo.path, 'refs/kepler/test'), c2);
	});

	test('CAS update rejects conflict when the ref moved', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);

		await assert.rejects(
			repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c2, { expected: c2 }),
			(err: unknown) => ReferenceUpdateError.is(err, 'conflict'),
		);
		assert.strictEqual(
			revParse(repo.path, 'refs/kepler/test'),
			c1,
			'a lost compare-and-swap must not move the ref',
		);
	});

	test("'absent' creates once and conflicts the second time", async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1, { expected: 'absent' });
		assert.strictEqual(revParse(repo.path, 'refs/kepler/test'), c1);

		await assert.rejects(
			repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c2, { expected: 'absent' }),
			(err: unknown) => ReferenceUpdateError.is(err, 'conflict'),
		);
		assert.strictEqual(
			revParse(repo.path, 'refs/kepler/test'),
			c1,
			'the second create-only call must not overwrite',
		);
	});

	test('a plain update with no expected overwrites', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c2);

		assert.strictEqual(revParse(repo.path, 'refs/kepler/test'), c2);
	});

	test('invalidObject for a sha that does not exist in the repo', async () => {
		await assert.rejects(
			repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', unknownSha),
			(err: unknown) => ReferenceUpdateError.is(err, 'invalidObject'),
		);
	});

	test('invalidRef for a malformed ref name', async () => {
		await assert.rejects(
			repo.provider.refs.updateReference(repo.path, 'refs/heads/bad..name', c1),
			(err: unknown) => ReferenceUpdateError.is(err, 'invalidRef'),
		);
	});

	test('deleteReference deletes with a correct expected', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);

		await repo.provider.refs.deleteReference(repo.path, 'refs/kepler/test', { expected: c1 });

		// Asked via `for-each-ref` rather than `rev-parse`: an unresolvable revision is the expected
		// outcome here, and rev-parse would spill its fatal onto the suite's stderr on a passing run.
		assert.strictEqual(listRef(repo.path, 'refs/kepler/test'), '', 'the ref must no longer exist');
	});

	test('deleteReference conflicts on a wrong expected', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);

		await assert.rejects(
			repo.provider.refs.deleteReference(repo.path, 'refs/kepler/test', { expected: c2 }),
			(err: unknown) => ReferenceUpdateError.is(err, 'conflict'),
		);
		assert.strictEqual(
			revParse(repo.path, 'refs/kepler/test'),
			c1,
			'a lost compare-and-swap must not delete the ref',
		);
	});

	test('deleteReference reports notFound for a missing ref with an expected sha', async () => {
		await assert.rejects(
			repo.provider.refs.deleteReference(repo.path, 'refs/kepler/missing', { expected: c1 }),
			(err: unknown) => ReferenceUpdateError.is(err, 'notFound'),
		);
	});

	test('deleteReference with no expected on a missing ref resolves', async () => {
		await repo.provider.refs.deleteReference(repo.path, 'refs/kepler/missing');
	});

	test('deleteReference on a branch removes its config section and GitLens metadata', async () => {
		createBranch(repo.path, 'doomed');
		const config = (key: string) => {
			try {
				return execFileSync('git', ['config', '--get', key], { cwd: repo.path, encoding: 'utf-8' }).trim();
			} catch {
				return undefined;
			}
		};
		execFileSync('git', ['config', 'branch.doomed.remote', 'origin'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'branch.doomed.merge', 'refs/heads/doomed'], { cwd: repo.path, stdio: 'pipe' });
		await repo.provider.config.setGkConfig(repo.path, 'branch.doomed.gk-merge-base', 'main');
		assert.strictEqual(await repo.provider.config.getGkConfig(repo.path, 'branch.doomed.gk-merge-base'), 'main');

		await repo.provider.refs.deleteReference(repo.path, 'refs/heads/doomed', { expected: c2 });

		assert.strictEqual(listRef(repo.path, 'refs/heads/doomed'), '');
		assert.strictEqual(config('branch.doomed.remote'), undefined, 'the upstream must not outlive the branch');
		assert.strictEqual(config('branch.doomed.merge'), undefined);
		assert.strictEqual(
			await repo.provider.config.getGkConfig(repo.path, 'branch.doomed.gk-merge-base'),
			undefined,
			'a later branch reusing the name must not inherit its predecessor’s base',
		);
	});

	test('deleteReference refuses a branch checked out in a worktree, and leaves it in place', async () => {
		createBranch(repo.path, 'in-use');
		const worktreePath = mkdtempSync(join(tmpdir(), 'gitlens-delete-ref-checked-out-'));
		addWorktree(repo.path, worktreePath, 'in-use');
		try {
			await assert.rejects(repo.provider.refs.deleteReference(repo.path, 'refs/heads/in-use'), (err: unknown) =>
				ReferenceUpdateError.is(err, 'checkedOut'),
			);
			assert.strictEqual(listRef(repo.path, 'refs/heads/in-use'), 'refs/heads/in-use');

			await assert.rejects(
				repo.provider.refs.deleteReference(repo.path, 'refs/heads/main'),
				(err: unknown) => ReferenceUpdateError.is(err, 'checkedOut'),
				'the main worktree’s own branch is checked out too',
			);
		} finally {
			execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repo.path, stdio: 'pipe' });
			rmSync(worktreePath, { recursive: true, force: true });
		}
	});

	test('a cancelled update or delete rejects as CancellationError, not ReferenceUpdateError', async () => {
		await repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c1);
		const aborted = AbortSignal.abort();

		// Pinned by name because that is how a consumer outside this package tells a cancellation from a
		// refused compare-and-swap, and only the latter is an answer about the ref.
		const isCancellation = (err: unknown) => err instanceof Error && err.name === 'CancellationError';
		await assert.rejects(
			repo.provider.refs.updateReference(repo.path, 'refs/kepler/test', c2, { expected: c1 }, aborted),
			isCancellation,
		);
		await assert.rejects(
			repo.provider.refs.deleteReference(repo.path, 'refs/kepler/test', { expected: c1 }, aborted),
			isCancellation,
		);
		assert.strictEqual(revParse(repo.path, 'refs/kepler/test'), c1);
	});

	test('hooks fire per namespace', async () => {
		const onReset = sinon.spy();
		const onChanged = sinon.spy();
		const hookedRepo = createTestRepo({
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		});
		try {
			const sha = getHeadSha(hookedRepo.path);

			await hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/heads/hook-test', sha);
			assert.ok(onChanged.calledWith(hookedRepo.path, ['heads']));
			assert.ok(onReset.calledWith(hookedRepo.path, 'branches'));
			onChanged.resetHistory();
			onReset.resetHistory();

			await hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/tags/hook-test', sha);
			assert.ok(onChanged.calledWith(hookedRepo.path, ['tags']));
			assert.ok(onReset.calledWith(hookedRepo.path, 'tags'));
			onChanged.resetHistory();
			onReset.resetHistory();

			await hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/kepler/hook-test', sha);
			assert.ok(onChanged.notCalled, 'a ref outside heads/tags/remotes announces nothing');
			assert.ok(onReset.notCalled);
		} finally {
			hookedRepo.cleanup();
		}
	});

	test('hooks fire on delete too', async () => {
		const onReset = sinon.spy();
		const onChanged = sinon.spy();
		const hookedRepo = createTestRepo({
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		});
		try {
			const sha = getHeadSha(hookedRepo.path);
			await hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/heads/hook-delete', sha);
			onChanged.resetHistory();
			onReset.resetHistory();

			await hookedRepo.provider.refs.deleteReference(hookedRepo.path, 'refs/heads/hook-delete', {
				expected: sha,
			});

			assert.ok(onChanged.calledWith(hookedRepo.path, ['heads']));
			assert.ok(onReset.calledWith(hookedRepo.path, 'branches'));
		} finally {
			hookedRepo.cleanup();
		}
	});

	test('no hooks fire when the update failed', async () => {
		const onReset = sinon.spy();
		const onChanged = sinon.spy();
		const hookedRepo = createTestRepo({
			hooks: { cache: { onReset: onReset }, repository: { onChanged: onChanged } },
		});
		try {
			const sha = getHeadSha(hookedRepo.path);
			await hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/heads/hook-fail', sha);
			onChanged.resetHistory();
			onReset.resetHistory();

			await assert.rejects(
				hookedRepo.provider.refs.updateReference(hookedRepo.path, 'refs/heads/hook-fail', sha, {
					expected: unknownSha,
				}),
				(err: unknown) => ReferenceUpdateError.is(err, 'conflict'),
			);

			assert.strictEqual(onChanged.called, false, 'a rejected compare-and-swap must announce nothing');
			assert.strictEqual(onReset.called, false);
		} finally {
			hookedRepo.cleanup();
		}
	});
});
