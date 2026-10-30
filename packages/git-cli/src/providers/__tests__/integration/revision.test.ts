import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { uncommittedStaged } from '@gitlens/git/models/revision.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo, getHeadSha, revParse } from './helpers.js';

suite('RevisionSubProvider.resolveShas', () => {
	let repo: TestRepo;
	let headSha: string;
	let parentSha: string;

	suiteSetup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		headSha = getHeadSha(repo.path);
		parentSha = execFileSync('git', ['rev-parse', 'HEAD~1'], { cwd: repo.path, encoding: 'utf-8' }).trim();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('resolves a full commit sha to itself', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha]));
		assert.deepStrictEqual([...resolved], [headSha]);
	});

	test('resolves a short (unambiguous) prefix to the full commit sha', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha.slice(0, 8)]));
		assert.deepStrictEqual([...resolved], [headSha]);
	});

	test('resolves multiple full shas to all of them', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([headSha, parentSha]));
		assert.strictEqual(resolved.size, 2);
		assert.ok(resolved.has(headSha), 'should include HEAD');
		assert.ok(resolved.has(parentSha), 'should include HEAD~1');
	});

	test('filters out non-commit objects (blob)', async () => {
		// A blob oid is hex 4-40, so it's routed through disambiguation then dropped as a non-commit.
		// This is the crux of the ambiguity fix: a prefix matching a commit + blob keeps only the commit.
		const blobOid = execFileSync('git', ['hash-object', '-w', '--stdin'], {
			cwd: repo.path,
			input: 'a loose blob\n',
			encoding: 'utf-8',
		}).trim();
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set([blobOid]));
		assert.strictEqual(resolved.size, 0);
	});

	test('passes through non-hex values (ref name, suffixed sha) unchanged', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set(['main', 'HEAD^']));
		assert.deepStrictEqual([...resolved].sort(), ['HEAD^', 'main']);
	});

	test('returns empty for a hex prefix that matches no object', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set(['abcdef0123']));
		assert.strictEqual(resolved.size, 0);
	});

	test('returns empty for an empty input set', async () => {
		const resolved = await repo.provider.revision.resolveShas(repo.path, new Set());
		assert.strictEqual(resolved.size, 0);
	});
});

suite('RevisionSubProvider.resolveRevision — force bypasses the cache', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	test('an unforced read stays stale after an external move; force sees the new sha and stores it', async () => {
		const oldSha = getHeadSha(repo.path);

		const warmed = await repo.provider.revision.resolveRevision(repo.path, 'main');
		assert.strictEqual(warmed.sha, oldSha);

		// Moves `main` outside the provider — GitLens's cache-invalidation hooks never fire.
		addCommit(repo.path, 'file1.txt', 'content', 'Second commit');
		const newSha = getHeadSha(repo.path);
		assert.notStrictEqual(newSha, oldSha);

		const stale = await repo.provider.revision.resolveRevision(repo.path, 'main');
		assert.strictEqual(stale.sha, oldSha, 'an unforced read must still answer from the cache');

		const forced = await repo.provider.revision.resolveRevision(repo.path, 'main', undefined, { force: true });
		assert.strictEqual(forced.sha, newSha, 'a forced read must see the external move');

		const afterForce = await repo.provider.revision.resolveRevision(repo.path, 'main');
		assert.strictEqual(afterForce.sha, newSha, 'the forced answer must be stored for later unforced reads');
	});
});

suite('RevisionSubProvider.getEmptyTreeSha', () => {
	let repo: TestRepo;

	suiteSetup(() => {
		repo = createTestRepo();
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('a normal (SHA-1) repository', async () => {
		const sha = await repo.provider.revision.getEmptyTreeSha(repo.path);
		assert.strictEqual(sha, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
	});

	test('a SHA-256 repository (git >= 2.29)', async function () {
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-test-sha256-'));
		try {
			execFileSync('git', ['init', '-b', 'main', '--object-format=sha256', parent], { stdio: 'pipe' });
		} catch {
			// The installed git predates --object-format (2.29) and refused to create the repository.
			rmSync(parent, { recursive: true, force: true });
			this.skip();
		}

		try {
			const sha = await repo.provider.revision.getEmptyTreeSha(parent);
			assert.strictEqual(sha, '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321');
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});
});

suite('RevisionSubProvider scoped listings', () => {
	let repo: TestRepo;
	let headSha: string;

	function write(relativePath: string): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, 'x\n');
	}

	suiteSetup(() => {
		repo = createTestRepo();
		for (const file of ['src/a.ts', 'src/sub/b.ts', '[id]/page.ts', '[id]/in/z.ts', 'i/y.ts', 'top.ts']) {
			write(file);
		}
		execFileSync('git', ['add', '-A'], { cwd: repo.path });
		execFileSync('git', ['commit', '-m', 'Add files'], { cwd: repo.path });
		headSha = getHeadSha(repo.path);
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	suite('getTrackedFiles', () => {
		test('unscoped lists the whole index', async () => {
			const files = await repo.provider.revision.getTrackedFiles(repo.path);

			assert.deepStrictEqual(
				[...files].sort(),
				['README.md', '[id]/in/z.ts', '[id]/page.ts', 'i/y.ts', 'src/a.ts', 'src/sub/b.ts', 'top.ts'].sort(),
			);
		});

		test('scoped to a folder', async () => {
			const files = await repo.provider.revision.getTrackedFiles(repo.path, { paths: ['src'] });

			assert.deepStrictEqual([...files].sort(), ['src/a.ts', 'src/sub/b.ts']);
		});

		test('scoped to two folders', async () => {
			const files = await repo.provider.revision.getTrackedFiles(repo.path, { paths: ['src/sub', 'i'] });

			assert.deepStrictEqual([...files].sort(), ['i/y.ts', 'src/sub/b.ts']);
		});

		test('scoped to overlapping folders lists each file once', async () => {
			const files = await repo.provider.revision.getTrackedFiles(repo.path, { paths: ['src', 'src/sub'] });

			assert.deepStrictEqual([...files].sort(), ['src/a.ts', 'src/sub/b.ts']);
		});

		test('scoped to a glob-named folder leaves its sibling out', async () => {
			const files = await repo.provider.revision.getTrackedFiles(repo.path, { paths: ['[id]'] });

			assert.deepStrictEqual([...files].sort(), ['[id]/in/z.ts', '[id]/page.ts']);
		});

		test('an empty paths array answers empty', async () => {
			assert.deepStrictEqual(await repo.provider.revision.getTrackedFiles(repo.path, { paths: [] }), []);
		});
	});

	suite('getTreeForRevision', () => {
		async function paths(options?: { paths?: readonly string[] }): Promise<string[]> {
			const entries = await repo.provider.revision.getTreeForRevision(repo.path, headSha, options);
			return entries.map(e => e.path).sort();
		}

		test('unscoped lists the whole tree', async () => {
			assert.deepStrictEqual(await paths(), [
				'README.md',
				'[id]',
				'[id]/in',
				'[id]/in/z.ts',
				'[id]/page.ts',
				'i',
				'i/y.ts',
				'src',
				'src/a.ts',
				'src/sub',
				'src/sub/b.ts',
				'top.ts',
			]);
		});

		test('scoped to a folder', async () => {
			assert.deepStrictEqual(await paths({ paths: ['src'] }), ['src', 'src/a.ts', 'src/sub', 'src/sub/b.ts']);
		});

		test('scoped to a nested folder also lists its ancestor', async () => {
			assert.deepStrictEqual(await paths({ paths: ['src/sub'] }), ['src', 'src/sub', 'src/sub/b.ts']);
		});

		test('scoped to two folders lists each entry once', async () => {
			assert.deepStrictEqual(await paths({ paths: ['src/sub', 'i', 'src'] }), [
				'i',
				'i/y.ts',
				'src',
				'src/a.ts',
				'src/sub',
				'src/sub/b.ts',
			]);
		});

		test('scoped to a glob-named folder leaves its sibling out', async () => {
			assert.deepStrictEqual(await paths({ paths: ['[id]'] }), [
				'[id]',
				'[id]/in',
				'[id]/in/z.ts',
				'[id]/page.ts',
			]);
		});

		test('an empty paths array answers empty', async () => {
			assert.deepStrictEqual(await paths({ paths: [] }), []);
		});

		test('an aborted signal rejects with a cancellation error', async () => {
			const controller = new AbortController();
			controller.abort();

			await assert.rejects(
				repo.provider.revision.getTreeForRevision(repo.path, headSha, { paths: ['src'] }, controller.signal),
				ex => isCancellationError(ex),
			);
			await assert.rejects(
				repo.provider.revision.getTreeForRevision(repo.path, headSha, undefined, controller.signal),
				ex => isCancellationError(ex),
			);
		});

		test('aborting one of two concurrent reads leaves the other intact', async () => {
			const controller = new AbortController();
			controller.abort();

			const [aborted, intact] = await Promise.allSettled([
				repo.provider.revision.getTreeForRevision(repo.path, headSha, { paths: ['src'] }, controller.signal),
				repo.provider.revision.getTreeForRevision(repo.path, headSha, { paths: ['src'] }),
			]);

			assert.strictEqual(aborted.status, 'rejected');
			assert.ok(isCancellationError(aborted.reason));
			assert.strictEqual(intact.status, 'fulfilled');
			assert.deepStrictEqual(
				(intact as PromiseFulfilledResult<{ path: string }[]>).value.map(e => e.path).sort(),
				['src', 'src/a.ts', 'src/sub', 'src/sub/b.ts'],
			);
		});

		test('a single-entry read still works alongside scoped reads', async () => {
			const [entry, scoped] = await Promise.all([
				repo.provider.revision.getTreeEntryForRevision(repo.path, 'src/a.ts', headSha),
				paths({ paths: ['src'] }),
			]);

			assert.strictEqual(entry?.path, 'src/a.ts');
			assert.strictEqual(scoped.length, 4);
		});
	});
});

suite('RevisionSubProvider glob-like file names', () => {
	let repo: TestRepo;

	function write(relativePath: string, content: string): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	suiteSetup(() => {
		repo = createTestRepo();
		// `[id]` as a pathspec is a character class that also matches `i` and `d`
		write('[id]/page.ts', 'one\n');
		write('i/page.ts', 'two\n');
		write('d/gone.ts', 'three\n');
		execFileSync('git', ['add', '-A'], { cwd: repo.path });
		execFileSync('git', ['commit', '-m', 'Add files'], { cwd: repo.path });

		write('[id]/page.ts', 'one staged\n');
		write('i/page.ts', 'two staged\n');
		execFileSync('git', ['add', '-A'], { cwd: repo.path });
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getBlobIds (index) reads only the literally named file', async () => {
		const ids = await repo.provider.revision.getBlobIds(repo.path, ['[id]/page.ts'], 'index');

		assert.deepStrictEqual([...ids], [['[id]/page.ts', revParse(repo.path, ':[id]/page.ts')]]);
	});

	test('getBlobIds (working) hashes the literally named file', async () => {
		const ids = await repo.provider.revision.getBlobIds(repo.path, ['[id]/page.ts'], 'working');

		assert.deepStrictEqual([...ids], [['[id]/page.ts', revParse(repo.path, ':[id]/page.ts')]]);
	});

	test('exists does not count a glob-matching sibling', async () => {
		assert.strictEqual(await repo.provider.revision.exists(repo.path, '[d]/gone.ts'), false);
		assert.strictEqual(await repo.provider.revision.exists(repo.path, 'd/gone.ts'), true);
	});

	test('getTreeEntryForRevision (staged) does not read a glob-matching sibling', async () => {
		const missing = await repo.provider.revision.getTreeEntryForRevision(
			repo.path,
			'[i]/page.ts',
			uncommittedStaged,
		);
		assert.strictEqual(missing, undefined);

		const entry = await repo.provider.revision.getTreeEntryForRevision(
			repo.path,
			'[id]/page.ts',
			uncommittedStaged,
		);
		assert.strictEqual(entry?.oid, revParse(repo.path, ':[id]/page.ts'));
	});
});

suite('RevisionSubProvider.getBlobIds (working) with paths hash-object cannot read', () => {
	let repo: TestRepo;
	let submoduleHead: string;

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	function hashObject(path: string): string {
		return git(repo.path, 'hash-object', '--', path);
	}

	suiteSetup(() => {
		repo = createTestRepo();
		writeFileSync(join(repo.path, 'a.txt'), 'a\n');
		writeFileSync(join(repo.path, 'b.txt'), 'b\n');
		// A repository inside the working tree, added as a gitlink — what a submodule is to the outer index
		const sub = join(repo.path, 'sub');
		mkdirSync(sub);
		git(sub, 'init', '-b', 'main');
		git(sub, '-c', 'user.name=Test', '-c', 'user.email=test@gitlens.test', 'commit', '--allow-empty', '-m', 'one');
		git(repo.path, 'add', 'a.txt', 'b.txt', 'sub');
		git(repo.path, 'commit', '-m', 'Add files and a submodule');

		// Changes on disk: both files, a new commit checked out in the submodule, and a plain directory
		writeFileSync(join(repo.path, 'a.txt'), 'a changed\n');
		writeFileSync(join(repo.path, 'b.txt'), 'b changed\n');
		git(sub, '-c', 'user.name=Test', '-c', 'user.email=test@gitlens.test', 'commit', '--allow-empty', '-m', 'two');
		submoduleHead = git(sub, 'rev-parse', 'HEAD');
		mkdirSync(join(repo.path, 'dir'));
		writeFileSync(join(repo.path, 'dir', 'c.txt'), 'c\n');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('hashes the paths after a submodule and a directory, and gives the submodule its checked-out commit', async () => {
		const ids = await repo.provider.revision.getBlobIds(
			repo.path,
			['a.txt', 'sub', 'dir', 'b.txt', 'missing.txt', 'dir/c.txt'],
			'working',
		);

		assert.deepStrictEqual(
			new Map(ids),
			new Map([
				['a.txt', hashObject('a.txt')],
				['sub', submoduleHead],
				['b.txt', hashObject('b.txt')],
				['dir/c.txt', hashObject('dir/c.txt')],
			]),
		);
	});

	test('the index records the submodule commit the same way', async () => {
		const ids = await repo.provider.revision.getBlobIds(repo.path, ['sub'], 'index');

		assert.deepStrictEqual([...ids], [['sub', revParse(repo.path, ':sub')]]);
		assert.notStrictEqual(ids.get('sub'), submoduleHead);
	});
});
