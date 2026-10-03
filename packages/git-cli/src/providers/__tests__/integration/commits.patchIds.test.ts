import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as sinon from 'sinon';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	checkout,
	cloneTestRepo,
	createBranch,
	createTestRepo,
	getHeadSha,
	getRootSha,
	mergeBranch,
	rebaseCurrentOnto,
} from './helpers.js';

const baseLines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);

/** The base file with the given (zero-based) lines replaced */
function fileWith(edits: Record<number, string>): string {
	const lines = [...baseLines];
	for (const [index, text] of Object.entries(edits)) {
		lines[Number(index)] = text;
	}
	return `${lines.join('\n')}\n`;
}

function git(repoPath: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: repoPath, stdio: 'pipe' });
}

/** Commits what is already in the working tree, optionally flipping the executable bit through the index so it works on every platform */
function commitFile(repoPath: string, filename: string, message: string, options?: { executable?: boolean }): string {
	git(repoPath, 'add', filename);
	if (options?.executable != null) {
		git(repoPath, 'update-index', options.executable ? '--chmod=+x' : '--chmod=-x', filename);
	}
	git(repoPath, 'commit', '-m', message);
	if (options?.executable != null) {
		// The index mode was changed behind the working tree's back, which would otherwise block the next checkout
		git(repoPath, 'checkout', 'HEAD', '--', filename);
	}
	return getHeadSha(repoPath);
}

suite('CommitsSubProvider.getCommitPatchIds', () => {
	let repo: TestRepo;
	let baseSha: string;

	setup(async () => {
		repo = createTestRepo();
		addCommit(repo.path, 'f.txt', fileWith({}), 'Add f');
		baseSha = getHeadSha(repo.path);
		// Pin the guard that makes every assertion below meaningful: verbatim ids need a git that has them
		assert.ok(await repo.provider.git.supports('git:patch-id:verbatim'), 'these tests need git >= 2.39');
	});

	teardown(() => {
		repo.cleanup();
	});

	/** A commit on its own branch off the base, leaving the checkout where it was */
	function commitOnBranch(branch: string, build: () => string): string {
		createBranch(repo.path, branch, { checkout: true });
		const sha = build();
		checkout(repo.path, 'main');
		return sha;
	}

	test('a rebased commit has the same id as its original, even after the base edits the same hunk', async () => {
		// Distant from the feature's edit, so the rebased diff has the same context as the original
		addCommit(repo.path, 'g.txt', 'unrelated\n', 'Unrelated base commit');
		createBranch(repo.path, 'feat', { checkout: true });
		const original = (() => {
			addCommit(repo.path, 'f.txt', fileWith({ 9: 'feature' }), 'Feature edit');
			return getHeadSha(repo.path);
		})();
		checkout(repo.path, 'main');
		addCommit(repo.path, 'g.txt', 'unrelated, moved on\n', 'Base moves on');
		checkout(repo.path, 'feat');
		rebaseCurrentOnto(repo.path, 'main');
		const rebased = getHeadSha(repo.path);
		assert.notStrictEqual(rebased, original, 'rebasing mints a new sha');

		// The base then lands the rebased change and edits the very same hunk
		checkout(repo.path, 'main');
		git(repo.path, 'merge', '--ff-only', 'feat');
		addCommit(repo.path, 'f.txt', fileWith({ 9: 'feature', 10: 'edited after' }), 'Edit the same hunk');
		const later = getHeadSha(repo.path);

		for (const verbatim of [false, true]) {
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [original, rebased, later], {
				verbatim: verbatim,
			});
			assert.ok(ids != null, `ids should be available (verbatim: ${verbatim})`);
			assert.ok(ids.get(original), 'the original has an id');
			assert.strictEqual(ids.get(rebased), ids.get(original), `same change, same id (verbatim: ${verbatim})`);
			assert.notStrictEqual(ids.get(later), ids.get(original), 'a different change has a different id');
		}
	});

	test('a whitespace-only difference changes verbatim ids but not stable ones', async () => {
		const spaced = commitOnBranch('spaced', () => {
			writeFileSync(join(repo.path, 'f.txt'), fileWith({ 3: 'foo bar' }));
			return commitFile(repo.path, 'f.txt', 'Spaced');
		});
		const joined = commitOnBranch('joined', () => {
			writeFileSync(join(repo.path, 'f.txt'), fileWith({ 3: 'foobar' }));
			return commitFile(repo.path, 'f.txt', 'Joined');
		});

		const stable = await repo.provider.commits.getCommitPatchIds(repo.path, [spaced, joined]);
		assert.ok(stable != null);
		assert.strictEqual(stable.get(spaced), stable.get(joined), 'stable ids ignore whitespace');

		const explicit = await repo.provider.commits.getCommitPatchIds(repo.path, [spaced, joined], {
			verbatim: false,
		});
		assert.deepStrictEqual(explicit, stable, 'stable is the default');

		const verbatim = await repo.provider.commits.getCommitPatchIds(repo.path, [spaced, joined], { verbatim: true });
		assert.ok(verbatim != null);
		assert.ok(verbatim.get(spaced) && verbatim.get(joined));
		assert.notStrictEqual(verbatim.get(spaced), verbatim.get(joined), 'verbatim ids hash whitespace');
	});

	test('a change that also sets the executable bit differs from the same content change without it', async () => {
		const executable = commitOnBranch('exec', () => {
			writeFileSync(join(repo.path, 'f.txt'), fileWith({ 5: 'changed' }));
			return commitFile(repo.path, 'f.txt', 'Change and chmod +x', { executable: true });
		});
		const plain = commitOnBranch('plain', () => {
			writeFileSync(join(repo.path, 'f.txt'), fileWith({ 5: 'changed' }));
			return commitFile(repo.path, 'f.txt', 'Change only');
		});

		for (const verbatim of [false, true]) {
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [executable, plain], {
				verbatim: verbatim,
			});
			assert.ok(ids != null);
			assert.ok(ids.get(executable) && ids.get(plain), `both have ids (verbatim: ${verbatim})`);
			assert.notStrictEqual(
				ids.get(executable),
				ids.get(plain),
				`the mode is part of the change (verbatim: ${verbatim})`,
			);
		}
	});

	test('a mode-only change is a change with its own id', async () => {
		const content = commitOnBranch('content', () => {
			writeFileSync(join(repo.path, 'f.txt'), fileWith({ 5: 'changed' }));
			return commitFile(repo.path, 'f.txt', 'Content');
		});
		const modeOnly = commitOnBranch('mode', () =>
			commitFile(repo.path, 'f.txt', 'Mode only', { executable: true }),
		);

		for (const verbatim of [false, true]) {
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [content, modeOnly], {
				verbatim: verbatim,
			});
			assert.ok(ids != null);
			assert.ok(ids.get(modeOnly), `a mode-only commit is not empty (verbatim: ${verbatim})`);
			assert.notStrictEqual(ids.get(modeOnly), ids.get(content));
		}
	});

	test('a binary change has an id that follows the content', async () => {
		const first = commitOnBranch('bin-a', () => {
			writeFileSync(join(repo.path, 'b.bin'), Buffer.from([0, 1, 2, 3]));
			return commitFile(repo.path, 'b.bin', 'Binary A');
		});
		const twin = commitOnBranch('bin-b', () => {
			writeFileSync(join(repo.path, 'b.bin'), Buffer.from([0, 1, 2, 3]));
			return commitFile(repo.path, 'b.bin', 'Binary A, again');
		});
		const other = commitOnBranch('bin-c', () => {
			writeFileSync(join(repo.path, 'b.bin'), Buffer.from([0, 1, 2, 4]));
			return commitFile(repo.path, 'b.bin', 'Binary C');
		});

		for (const verbatim of [false, true]) {
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [first, twin, other], {
				verbatim: verbatim,
			});
			assert.ok(ids != null);
			assert.ok(ids.get(first), `a binary change has an id (verbatim: ${verbatim})`);
			assert.strictEqual(ids.get(twin), ids.get(first), 'the same bytes are the same change');
			assert.notStrictEqual(ids.get(other), ids.get(first), 'different bytes are a different change');
		}
	});

	test('merge commits and empty commits are absent', async () => {
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'g.txt', 'feature\n', 'Feature');
		const feat = getHeadSha(repo.path);
		checkout(repo.path, 'main');
		addCommit(repo.path, 'h.txt', 'main\n', 'Main');
		mergeBranch(repo.path, 'feat', 'Merge feat');
		const merge = getHeadSha(repo.path);
		git(repo.path, 'commit', '--allow-empty', '-m', 'Empty');
		const empty = getHeadSha(repo.path);

		const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [merge, feat, empty]);
		assert.ok(ids != null);
		assert.deepStrictEqual([...ids.keys()], [feat], 'only the real change is present');

		const onlyMerge = await repo.provider.commits.getCommitPatchIds(repo.path, [merge]);
		assert.ok(onlyMerge != null, 'no ids is an answer, not a failure');
		assert.strictEqual(onlyMerge.size, 0);
	});

	test('paths limit which commits are present and what their ids cover', async () => {
		const both = commitOnBranch('both', () => {
			writeFileSync(join(repo.path, 'a.txt'), 'same\n');
			writeFileSync(join(repo.path, 'b.txt'), 'one\n');
			git(repo.path, 'add', 'a.txt');
			return commitFile(repo.path, 'b.txt', 'Touch a and b');
		});
		const otherB = commitOnBranch('other-b', () => {
			writeFileSync(join(repo.path, 'a.txt'), 'same\n');
			writeFileSync(join(repo.path, 'b.txt'), 'two\n');
			git(repo.path, 'add', 'a.txt');
			return commitFile(repo.path, 'b.txt', 'Touch a and a different b');
		});
		const onlyB = commitOnBranch('only-b', () => {
			writeFileSync(join(repo.path, 'b.txt'), 'three\n');
			return commitFile(repo.path, 'b.txt', 'Touch b only');
		});

		const whole = await repo.provider.commits.getCommitPatchIds(repo.path, [both, otherB, onlyB]);
		assert.ok(whole != null);
		assert.strictEqual(whole.size, 3);
		assert.notStrictEqual(whole.get(both), whole.get(otherB), 'whole changes differ');

		const limited = await repo.provider.commits.getCommitPatchIds(repo.path, [both, otherB, onlyB], {
			paths: ['a.txt'],
		});
		assert.ok(limited != null);
		assert.strictEqual(limited.get(both), limited.get(otherB), 'the same change to a.txt, whatever b.txt did');
		assert.notStrictEqual(limited.get(both), whole.get(both), 'the id covers only the limited paths');
		assert.ok(!limited.has(onlyB), 'a commit with no change to the paths is absent');

		// The limited answer must not be served from the unlimited one's cache entries, or vice versa
		const again = await repo.provider.commits.getCommitPatchIds(repo.path, [both], {});
		assert.strictEqual(again?.get(both), whole.get(both));

		const glob = await repo.provider.commits.getCommitPatchIds(repo.path, [both, otherB], { paths: ['*.txt'] });
		assert.ok(glob != null);
		assert.strictEqual(glob.size, 0, 'paths are literal, never globs');
	});

	test('a range selects its non-merge commits, honoring paths', async () => {
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a\n', 'Feature A');
		addCommit(repo.path, 'b.txt', 'b\n', 'Feature B');
		const featB = getHeadSha(repo.path);
		checkout(repo.path, 'main');
		mergeBranch(repo.path, 'feat', 'Merge feat');
		const merge = getHeadSha(repo.path);

		const all = await repo.provider.commits.getCommitPatchIds(repo.path, `${baseSha}..${merge}`);
		assert.ok(all != null);
		assert.strictEqual(all.size, 2, 'both feature commits, but not the merge');
		assert.ok(all.has(featB) && !all.has(merge));

		const limited = await repo.provider.commits.getCommitPatchIds(repo.path, `${baseSha}..${merge}`, {
			paths: ['b.txt'],
		});
		assert.deepStrictEqual([...(limited?.keys() ?? [])], [featB]);

		const none = await repo.provider.commits.getCommitPatchIds(repo.path, `${merge}..${merge}`);
		assert.strictEqual(none?.size, 0, 'an empty range is an empty answer');
	});

	test('a range with paths includes commits reached only through a merge’s other parent', async () => {
		createBranch(repo.path, 'side', { checkout: true });
		addCommit(repo.path, 'a.txt', 'same\n', 'Side change to a');
		const side = getHeadSha(repo.path);
		checkout(repo.path, 'main');
		// The same change lands on main directly, so the merge is TREESAME to its first parent for a.txt and
		// git's default history simplification would follow only that parent, never listing the side commit
		addCommit(repo.path, 'a.txt', 'same\n', 'Main change to a');
		const main = getHeadSha(repo.path);
		mergeBranch(repo.path, 'side', 'Merge side');
		const merge = getHeadSha(repo.path);

		const ids = await repo.provider.commits.getCommitPatchIds(repo.path, `${baseSha}..${merge}`, {
			paths: ['a.txt'],
		});
		assert.ok(ids != null);
		assert.deepStrictEqual([...ids.keys()].sort(), [main, side].sort());
		assert.strictEqual(ids.get(side), ids.get(main), 'and they are the same change');
	});

	test('more commits than limit answers undefined, never a partial map', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		addCommit(repo.path, 'a.txt', '2\n', 'Two');
		addCommit(repo.path, 'a.txt', '3\n', 'Three');
		const head = getHeadSha(repo.path);
		const range = `${baseSha}..${head}` as const;

		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, range, { limit: 2 }), undefined);
		assert.strictEqual((await repo.provider.commits.getCommitPatchIds(repo.path, range, { limit: 3 }))?.size, 3);
		assert.strictEqual((await repo.provider.commits.getCommitPatchIds(repo.path, range))?.size, 3);

		const revs = ['HEAD', 'HEAD~1', 'HEAD~2'];
		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, revs, { limit: 2 }), undefined);
		assert.strictEqual((await repo.provider.commits.getCommitPatchIds(repo.path, revs, { limit: 3 }))?.size, 3);

		const merge = await (async () => {
			createBranch(repo.path, 'feat', { checkout: true });
			addCommit(repo.path, 'z.txt', 'z\n', 'Feature');
			checkout(repo.path, 'main');
			mergeBranch(repo.path, 'feat', 'Merge feat');
			return getHeadSha(repo.path);
		})();
		assert.strictEqual(
			(await repo.provider.commits.getCommitPatchIds(repo.path, `${head}..${merge}`, { limit: 1 }))?.size,
			1,
			'merge commits do not count against the limit',
		);
	});

	test('full shas are read without resolving them first, and a merge among them is still absent', async () => {
		createBranch(repo.path, 'feat', { checkout: true });
		addCommit(repo.path, 'g.txt', 'feature\n', 'Feature');
		const feat = getHeadSha(repo.path);
		checkout(repo.path, 'main');
		addCommit(repo.path, 'h.txt', 'main\n', 'Main');
		mergeBranch(repo.path, 'feat', 'Merge feat');
		const merge = getHeadSha(repo.path);

		const spy = sinon.spy(repo.provider.git, 'run');
		const commandsRun = () => spy.getCalls().flatMap(c => c.args.slice(1).filter(a => typeof a === 'string'));
		try {
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [merge, feat, feat]);
			assert.ok(ids != null);
			assert.deepStrictEqual([...ids.keys()], [feat], 'the merge is absent and a repeated sha answers once');
			assert.ok(!commandsRun().includes('rev-list'), 'full shas need no resolution');

			spy.resetHistory();
			const abbreviated = await repo.provider.commits.getCommitPatchIds(repo.path, [feat.slice(0, 10)]);
			assert.deepStrictEqual(abbreviated, new Map([[feat, ids.get(feat)!]]));
			assert.ok(commandsRun().includes('rev-list'), 'an abbreviation still needs it');
		} finally {
			spy.restore();
		}
	});

	test('a shallow clone’s boundary commit is absent and never cached, since its own change is unknowable', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		const middle = getHeadSha(repo.path);
		addCommit(repo.path, 'b.txt', '2\n', 'Two');
		const head = getHeadSha(repo.path);
		const expected = await repo.provider.commits.getCommitPatchIds(repo.path, [middle, head]);
		assert.ok(expected != null, 'the full clone answers');
		assert.strictEqual(expected.size, 2);

		const clone = cloneTestRepo(repo.path, { depth: 2 });
		try {
			const shallow = await clone.provider.commits.getCommitPatchIds(clone.path, [middle, head]);
			assert.deepStrictEqual(
				shallow,
				new Map([[head, expected.get(head)!]]),
				'the boundary commit would otherwise hash as its whole tree',
			);

			git(clone.path, 'fetch', '--unshallow');
			const deep = await clone.provider.commits.getCommitPatchIds(clone.path, [middle, head]);
			assert.deepStrictEqual(deep, expected, 'once its parent is present the commit has its real id');
		} finally {
			clone.cleanup();
		}
	});

	test('abbreviated shas and refs are resolved, and the map is keyed by full sha', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		const head = getHeadSha(repo.path);

		const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [
			head.slice(0, 7),
			'HEAD',
			'main',
			baseSha.slice(0, 10),
		]);
		assert.ok(ids != null);
		assert.deepStrictEqual([...ids.keys()].sort(), [baseSha, head].sort());
	});

	test('a root commit is its whole tree, and an empty list is an empty answer', async () => {
		const root = getRootSha(repo.path);

		const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [root]);
		assert.ok(ids?.get(root), 'the parentless commit has an id');

		const empty = await repo.provider.commits.getCommitPatchIds(repo.path, []);
		assert.strictEqual(empty?.size, 0);
	});

	test('unusable input answers undefined rather than throwing', async () => {
		const head = getHeadSha(repo.path);

		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, ['no-such-rev-abcdef']), undefined);
		assert.strictEqual(
			await repo.provider.commits.getCommitPatchIds(repo.path, [head, 'no-such-rev-abcdef']),
			undefined,
		);
		assert.strictEqual(
			await repo.provider.commits.getCommitPatchIds(repo.path, ['--all']),
			undefined,
			'an option is not a revision',
		);
		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, `no-such-rev..${head}`), undefined);
		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, `--all..${head}`), undefined);
	});

	test('a list names commits, never a range to walk', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		addCommit(repo.path, 'a.txt', '2\n', 'Two');
		const head = getHeadSha(repo.path);

		assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, [`^${baseSha}`, head]), undefined);
		assert.strictEqual(
			await repo.provider.commits.getCommitPatchIds(repo.path, [`${baseSha}..${head}`]),
			undefined,
		);
		assert.strictEqual(
			(await repo.provider.commits.getCommitPatchIds(repo.path, ['HEAD^']))?.size,
			1,
			'a parent is one commit',
		);
	});

	test('a range may use any revision syntax git accepts', async () => {
		createBranch(repo.path, 'feature/#1234-x', { checkout: true });
		addCommit(repo.path, 'a.txt', 'a\n', 'Feature A');
		addCommit(repo.path, 'b.txt', 'b\n', 'Feature B');
		const featB = getHeadSha(repo.path);

		const parent = await repo.provider.commits.getCommitPatchIds(repo.path, 'HEAD~1..HEAD');
		assert.deepStrictEqual([...(parent?.keys() ?? [])], [featB]);
		assert.strictEqual(
			(await repo.provider.commits.getCommitPatchIds(repo.path, 'main..feature/#1234-x'))?.size,
			2,
		);
	});

	test('verbatim is unavailable, not silently downgraded, on a git without it', async () => {
		const head = getHeadSha(repo.path);
		const stub = sinon
			.stub(repo.provider.git, 'supports')
			.callsFake(feature => feature !== 'git:patch-id:verbatim');
		try {
			assert.strictEqual(
				await repo.provider.commits.getCommitPatchIds(repo.path, [head], { verbatim: true }),
				undefined,
			);
			assert.strictEqual(
				await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head, { verbatim: true }),
				undefined,
			);
			assert.ok(
				(await repo.provider.commits.getCommitPatchIds(repo.path, [head]))?.get(head),
				'stable still works',
			);
		} finally {
			stub.restore();
		}
	});

	test('binary data is read only from a git whose patch-id hashes it', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		const head = getHeadSha(repo.path);
		const spy = sinon.spy(repo.provider.git, 'run');
		const binaryDiffs = () =>
			spy.getCalls().filter(c => c.args.includes('diff-tree') && c.args.includes('--binary'));
		try {
			await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head);
			assert.strictEqual(binaryDiffs().length, 0, 'patch-id hashes the blob ids, so the data is waste');

			const stub = sinon
				.stub(repo.provider.git, 'supports')
				.callsFake(feature => feature !== 'git:patch-id:binary-oids');
			try {
				await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head);
				assert.strictEqual(binaryDiffs().length, 1, 'an older patch-id has only the data to go on');
			} finally {
				stub.restore();
			}
		} finally {
			spy.restore();
		}
	});

	test('a split patch fails the read rather than answering for part of a change', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		const head = getHeadSha(repo.path);
		// What a patch-id before 2.39 prints after a binary diff: the rest of the patch under an all-zero commit id
		const split = `${'f'.repeat(head.length)} ${'0'.repeat(head.length)}\n`;
		const run = repo.provider.git.run.bind(repo.provider.git);
		const stub = sinon.stub(repo.provider.git, 'run').callsFake(async (options, ...args) => {
			const result = await run(options, ...args);
			return args.includes('patch-id') ? { ...result, stdout: `${result.stdout}${split}` } : result;
		});
		try {
			assert.strictEqual(await repo.provider.commits.getCommitPatchIds(repo.path, [head]), undefined);
			assert.strictEqual(await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head), undefined);
		} finally {
			stub.restore();
		}

		assert.ok(
			(await repo.provider.commits.getCommitPatchIds(repo.path, [head]))?.get(head),
			'and nothing of it is cached',
		);
	});

	test('a cancelled call rejects with its cancellation rather than answering undefined', async () => {
		const head = getHeadSha(repo.path);
		const controller = new AbortController();
		controller.abort();

		await assert.rejects(
			repo.provider.commits.getCommitPatchIds(repo.path, [head], undefined, controller.signal),
			(ex: unknown) => isCancellationError(ex),
		);
		await assert.rejects(
			repo.provider.commits.getDiffPatchId(repo.path, baseSha, head, undefined, controller.signal),
			(ex: unknown) => isCancellationError(ex),
		);
	});

	test('ids are cached per sha, paths and verbatim', async () => {
		addCommit(repo.path, 'a.txt', '1\n', 'One');
		const head = getHeadSha(repo.path);
		const spy = sinon.spy(repo.provider.git, 'run');
		const diffTreeRuns = () => spy.getCalls().filter(c => c.args.includes('diff-tree')).length;
		try {
			const first = await repo.provider.commits.getCommitPatchIds(repo.path, [head]);
			assert.strictEqual(diffTreeRuns(), 1);

			const second = await repo.provider.commits.getCommitPatchIds(repo.path, [head.slice(0, 8)]);
			assert.deepStrictEqual(second, first);
			assert.strictEqual(diffTreeRuns(), 1, 'a commit is immutable, so its id is read once');

			await repo.provider.commits.getCommitPatchIds(repo.path, [head], { verbatim: true });
			await repo.provider.commits.getCommitPatchIds(repo.path, [head], { paths: ['a.txt'] });
			assert.strictEqual(diffTreeRuns(), 3, 'verbatim and paths each key their own entry');

			await repo.provider.commits.getCommitPatchIds(repo.path, [head], { paths: ['a.txt'] });
			assert.strictEqual(diffTreeRuns(), 3, 'and are served from it afterwards');
		} finally {
			spy.restore();
		}
	});

	test('no user diff setting can change an id', async () => {
		addCommit(repo.path, 'f.txt', fileWith({ 9: 'feature' }), 'Feature edit');
		const head = getHeadSha(repo.path);
		const expected = (await repo.provider.commits.getCommitPatchIds(repo.path, [head]))?.get(head);
		assert.ok(expected);

		// `GIT_DIFF_OPTS` beats even an explicit `-U<n>`, so unless it is unset it changes the context lines that get hashed
		const noisy = createTestRepo({ gitOptions: { env: { GIT_DIFF_OPTS: '-u0' } } });
		try {
			addCommit(noisy.path, 'f.txt', fileWith({}), 'Add f');
			addCommit(noisy.path, 'f.txt', fileWith({ 9: 'feature' }), 'Feature edit');
			const noisyHead = getHeadSha(noisy.path);
			git(noisy.path, 'config', 'diff.context', '0');
			git(noisy.path, 'config', 'diff.noprefix', 'true');
			git(noisy.path, 'config', 'diff.algorithm', 'patience');
			git(noisy.path, 'config', 'diff.renames', 'copies');

			const actual = await noisy.provider.commits.getCommitPatchIds(noisy.path, [noisyHead]);
			assert.strictEqual(actual?.get(noisyHead), expected);
		} finally {
			noisy.cleanup();
		}
	});

	test('the diff settings plumbing still reads cannot change an id', async () => {
		// A blank context line, a second file and an insertion git could slide either way, so each setting has
		// something to change: a suppressed blank throws off `patch-id`'s line counts, and the slide moves the hunk
		function commitChange(target: TestRepo): string {
			addCommit(target.path, 'x.txt', '1\n2\na\n\nb\n3\n4\n', 'Add x');
			addCommit(target.path, 'y.txt', 'p\n\nq\n', 'Add y');
			writeFileSync(join(target.path, 'x.txt'), '1\n2\na\n\nb\na\n\nb\n3\n4\n');
			writeFileSync(join(target.path, 'y.txt'), 'p\n\nQ\n');
			git(target.path, 'add', 'x.txt');
			return commitFile(target.path, 'y.txt', 'Change both');
		}

		const head = commitChange(repo);
		const expected = {
			stable: (await repo.provider.commits.getCommitPatchIds(repo.path, [head]))?.get(head),
			verbatim: (await repo.provider.commits.getCommitPatchIds(repo.path, [head], { verbatim: true }))?.get(head),
		};
		assert.ok(expected.stable && expected.verbatim);

		for (const [key, value] of [
			['diff.suppressBlankEmpty', 'true'],
			['diff.indentHeuristic', 'false'],
		]) {
			const noisy = createTestRepo();
			try {
				const noisyHead = commitChange(noisy);
				git(noisy.path, 'config', key, value);

				const stable = await noisy.provider.commits.getCommitPatchIds(noisy.path, [noisyHead]);
				assert.strictEqual(stable?.get(noisyHead), expected.stable, `${key}=${value} (stable)`);
				const verbatim = await noisy.provider.commits.getCommitPatchIds(noisy.path, [noisyHead], {
					verbatim: true,
				});
				assert.strictEqual(verbatim?.get(noisyHead), expected.verbatim, `${key}=${value} (verbatim)`);
			} finally {
				noisy.cleanup();
			}
		}
	});
});

suite('CommitsSubProvider.getDiffPatchId', () => {
	let repo: TestRepo;
	let baseSha: string;

	setup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'f.txt', fileWith({}), 'Add f');
		baseSha = getHeadSha(repo.path);
	});

	teardown(() => {
		repo.cleanup();
	});

	test("a branch's net change equals the patch id of its squash commit", async () => {
		createBranch(repo.path, 'feature', { checkout: true });
		addCommit(repo.path, 'f.txt', fileWith({ 4: 'first' }), 'First');
		addCommit(repo.path, 'g.txt', 'new file\n', 'Second');
		addCommit(repo.path, 'f.txt', fileWith({ 4: 'first', 14: 'third' }), 'Third');
		checkout(repo.path, 'main');
		// The base moved on before the squash, so its sha and surroundings differ from the branch's merge base
		addCommit(repo.path, 'h.txt', 'unrelated\n', 'Base moves on');
		// Explicit `--ff`, so a user's `merge.ff=only` can't refuse the diverged squash
		git(repo.path, 'merge', '--squash', '--ff', 'feature');
		git(repo.path, 'commit', '-m', 'Squash feature');
		const squash = getHeadSha(repo.path);

		for (const verbatim of [false, true]) {
			const net = await repo.provider.commits.getDiffPatchId(repo.path, baseSha, 'feature', {
				verbatim: verbatim,
			});
			const ids = await repo.provider.commits.getCommitPatchIds(repo.path, [squash], { verbatim: verbatim });
			assert.ok(net, `the branch has a net change (verbatim: ${verbatim})`);
			assert.strictEqual(net, ids?.get(squash), `net change and squash commit agree (verbatim: ${verbatim})`);
		}

		const limited = await repo.provider.commits.getDiffPatchId(repo.path, baseSha, 'feature', { paths: ['g.txt'] });
		assert.ok(limited);
		assert.notStrictEqual(limited, await repo.provider.commits.getDiffPatchId(repo.path, baseSha, 'feature'));
		assert.strictEqual(
			limited,
			(await repo.provider.commits.getCommitPatchIds(repo.path, [squash], { paths: ['g.txt'] }))?.get(squash),
		);
	});

	test('no change, an unknown revision, or an option answers undefined', async () => {
		addCommit(repo.path, 'g.txt', 'g\n', 'G');
		const head = getHeadSha(repo.path);

		assert.strictEqual(await repo.provider.commits.getDiffPatchId(repo.path, head, head), undefined);
		assert.strictEqual(
			await repo.provider.commits.getDiffPatchId(repo.path, baseSha, 'no-such-rev-abcdef'),
			undefined,
		);
		assert.strictEqual(await repo.provider.commits.getDiffPatchId(repo.path, '--stat', head), undefined);
		assert.strictEqual(
			await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head, { paths: ['f.txt'] }),
			undefined,
			'no change within the paths',
		);
		assert.ok(
			await repo.provider.commits.getDiffPatchId(repo.path, baseSha, head),
			'while a real change has an id',
		);
	});
});
