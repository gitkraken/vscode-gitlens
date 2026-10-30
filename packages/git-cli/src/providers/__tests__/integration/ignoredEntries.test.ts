import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as sinon from 'sinon';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('CliGitProvider getIgnoredEntries / getIgnoredPaths', () => {
	let repo: TestRepo;

	function write(relativePath: string, content = 'x\n'): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function git(...args: string[]): string {
		return execFileSync('git', args, { cwd: repo.path, stdio: 'pipe', encoding: 'utf8' });
	}

	suiteSetup(() => {
		repo = createTestRepo();

		// A repo-local core.excludesFile keeps the user's global excludes out of the result
		const excludesFile = join(repo.path, '.git', 'test-excludes');
		writeFileSync(excludesFile, '');
		git('config', 'core.excludesFile', excludesFile);

		write('.gitignore', '/root.tmp\n*.log\nbuild/\n*.tmp\n');
		write('src/index.ts');
		write('tracked.log');
		git('add', '-f', '.gitignore', 'src/index.ts', 'tracked.log');
		git('commit', '-m', 'Add files');

		write('root.tmp');
		write('src/cache.tmp');
		write('build/x.js');
		write('build/cache/y.js');
		write('logs/a.log');
		write('logs/b.log');
		write('with space/a file.tmp');
		write('ünï/çødé.tmp');
		mkdirSync(join(repo.path, 'empty'));
		write('untracked.txt');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('getIgnoredEntries lists the same set as status --ignored', async () => {
		const status = git(
			'-c',
			'status.renames=false',
			'status',
			'--porcelain=v1',
			'-z',
			'--ignored',
			'--untracked-files=normal',
			'--ignore-submodules=all',
		);
		const expected = status
			.split('\0')
			.filter(r => r.startsWith('!! '))
			.map(r => r.substring(3))
			.sort();

		const result = await repo.provider.getIgnoredEntries(repo.path);

		assert.deepStrictEqual(result, expected);
		assert.deepStrictEqual(result, ['build/', 'logs/', 'root.tmp', 'src/cache.tmp', 'with space/', 'ünï/']);
	});

	test('getIgnoredEntries omits empty and not-ignored entries and .git/', async () => {
		const result = await repo.provider.getIgnoredEntries(repo.path);

		assert.ok(!result.includes('empty/'), 'empty/');
		assert.ok(!result.includes('untracked.txt'), 'untracked.txt');
		assert.ok(!result.includes('.git/'), '.git/');
	});

	test('getIgnoredPaths returns the subset git ignores, as given', async () => {
		const result = await repo.provider.getIgnoredPaths(repo.path, [
			'root.tmp',
			'with space/a file.tmp',
			'ünï/çødé.tmp',
			'build/',
			'untracked.txt',
			'src/index.ts',
		]);

		assert.deepStrictEqual(
			[...result].sort(),
			['build/', 'root.tmp', 'with space/a file.tmp', 'ünï/çødé.tmp'].sort(),
		);
	});

	test('getIgnoredPaths does not report a tracked file a rule matches', async () => {
		const result = await repo.provider.getIgnoredPaths(repo.path, ['tracked.log', 'logs/a.log']);

		assert.deepStrictEqual([...result], ['logs/a.log']);
	});

	test('getIgnoredPaths returns an empty set for no paths or no matches', async () => {
		assert.strictEqual((await repo.provider.getIgnoredPaths(repo.path, [])).size, 0);
		assert.strictEqual((await repo.provider.getIgnoredPaths(repo.path, ['untracked.txt'])).size, 0);
	});

	test('getIgnoredEntries lists ignored entries inside a new untracked folder', async () => {
		// Last: it commits a new rule and adds files to the shared fixture
		write('newpkg/index.ts');
		write('newpkg/debug.log');
		write('newpkg/node_modules/b/y');
		write('newpkg/sub/z.log');
		write('newpkg/inner/keep.ts');
		write('newpkg/inner/inner.log');
		write('[id]/page.ts');
		write('[id]/x.log');
		write('i/y.ts');
		write('i/z.log');
		write('.gitignore', '/root.tmp\n*.log\nbuild/\n*.tmp\nnode_modules/\n');
		git('add', '-f', '.gitignore');
		git('commit', '-m', 'Ignore node_modules');

		const status = git(
			'-c',
			'status.renames=false',
			'status',
			'--porcelain=v1',
			'-z',
			'--ignored',
			'--untracked-files=normal',
			'--ignore-submodules=all',
		);
		const expected = status
			.split('\0')
			.filter(r => r.startsWith('!! '))
			.map(r => r.substring(3))
			.sort();

		const result = await repo.provider.getIgnoredEntries(repo.path);

		assert.deepStrictEqual(result, expected);
		for (const entry of ['newpkg/debug.log', 'newpkg/node_modules/', 'newpkg/sub/']) {
			assert.ok(result.includes(entry), entry);
		}
		for (const entry of ['newpkg/inner/inner.log', '[id]/x.log', 'i/z.log']) {
			assert.strictEqual(result.filter(e => e === entry).length, 1, entry);
		}
		assert.ok(!result.includes('newpkg/'), 'newpkg/');
		assert.ok(!result.includes('newpkg/index.ts'), 'newpkg/index.ts');
	});

	test('getIgnoredPaths checks a path as that exact file, never as pathspec magic', async () => {
		// Last: it adds files and a rule to the shared fixture
		write('.gitignore', '/root.tmp\n*.log\nbuild/\n*.tmp\nnode_modules/\nsecret\n');
		write('secret');
		write(':secret');
		write(':ign.log');

		const result = await repo.provider.getIgnoredPaths(repo.path, ['secret', ':secret']);
		assert.deepStrictEqual([...result], ['secret']);

		const spelled = await repo.provider.getIgnoredPaths(repo.path, [':ign.log', ':other.txt', './a.log']);
		assert.deepStrictEqual([...spelled].sort(), ['./a.log', ':ign.log']);
	});
});

suite('CliGitProvider getIgnoredEntries scoped to paths', () => {
	let repo: TestRepo;

	function write(relativePath: string, content = 'x\n'): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function git(...args: string[]): string {
		return execFileSync('git', args, { cwd: repo.path, stdio: 'pipe', encoding: 'utf8' });
	}

	/** The `!! ` records of a status scoped to `scope` — what git itself says is ignored there */
	function oracle(scope: string): string[] {
		return git(
			'-c',
			'status.renames=false',
			'status',
			'--porcelain=v1',
			'-z',
			'--ignored',
			'--untracked-files=normal',
			'--ignore-submodules=all',
			'--',
			`:(literal)${scope}`,
		)
			.split('\0')
			.filter(r => r.startsWith('!! '))
			.map(r => r.substring(3))
			.sort();
	}

	suiteSetup(() => {
		repo = createTestRepo();

		const excludesFile = join(repo.path, '.git', 'test-excludes');
		writeFileSync(excludesFile, '');
		git('config', 'core.excludesFile', excludesFile);

		write('.gitignore', '*.log\n*.tmp\nnode_modules/\n');
		write('src/index.ts');
		git('add', '-f', '.gitignore', 'src/index.ts');
		git('commit', '-m', 'Add files');

		write('src/cache.tmp');
		write('src/keep.log');
		write('src/dist/a.tmp');
		write('src/dist/b.ts');
		write('newpkg/index.ts');
		write('newpkg/debug.log');
		write('newpkg/node_modules/b/y');
		write('newpkg/sub/z.log');
		write('newpkg/sub/k.ts');
		write('node_modules/a/x');
		write('node_modules/a/deep/y');
		write('[id]/page.ts');
		write('[id]/x.log');
		write('i/y.ts');
		write('i/z.log');
		write('other/q.log');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	/** The fixture's ignored files, one in each folder */
	const ignoredFiles = [
		'src/cache.tmp',
		'src/keep.log',
		'src/dist/a.tmp',
		'newpkg/debug.log',
		'newpkg/sub/z.log',
		'[id]/x.log',
		'i/z.log',
		'other/q.log',
	];

	function countCheckIgnoreRuns(run: sinon.SinonSpy): number {
		return run.getCalls().filter(call => call.args[1] === 'check-ignore').length;
	}

	async function assertMatchesStatus(scope: string): Promise<void> {
		const result = await repo.provider.getIgnoredEntries(repo.path, { paths: [scope] });

		assert.deepStrictEqual(result, oracle(scope));
		assert.ok(result.length > 0, 'the scope should hold ignored entries');
	}

	test('matches status scoped to a tracked folder holding ignored files and an ignored folder', () =>
		assertMatchesStatus('src'));
	test('matches status scoped to a new untracked folder', () => assertMatchesStatus('newpkg'));
	test('matches status scoped to a folder inside a new untracked folder', () => assertMatchesStatus('newpkg/sub'));
	test('matches status scoped to a glob-named folder', () => assertMatchesStatus('[id]'));
	test('matches status scoped to the sibling of a glob-named folder', () => assertMatchesStatus('i'));

	test('lists the ignored entries of a tracked folder only', async () => {
		const result = await repo.provider.getIgnoredEntries(repo.path, { paths: ['src'] });

		assert.deepStrictEqual(result, ['src/cache.tmp', 'src/dist/a.tmp', 'src/keep.log']);
	});

	test('literal matching keeps a glob-named folder apart from its sibling', async () => {
		assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path, { paths: ['[id]'] }), ['[id]/x.log']);
		assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path, { paths: ['i'] }), ['i/z.log']);
	});

	test('two scopes list both, sorted and without duplicates', async () => {
		const result = await repo.provider.getIgnoredEntries(repo.path, { paths: ['src', 'newpkg', 'src/dist'] });

		assert.deepStrictEqual(result, [...new Set([...oracle('src'), ...oracle('newpkg')])].sort());
	});

	test('a scope inside a wholly ignored folder is answered as that scope, never an ancestor', async () => {
		const get = (...paths: string[]) => repo.provider.getIgnoredEntries(repo.path, { paths: paths });

		assert.deepStrictEqual(await get('node_modules/a'), ['node_modules/a/']);
		assert.deepStrictEqual(await get('node_modules/a/'), ['node_modules/a/']);
		assert.deepStrictEqual(await get('node_modules/a/x'), ['node_modules/a/x']);
		assert.deepStrictEqual(await get('node_modules/a/deep/'), ['node_modules/a/deep/']);
		assert.deepStrictEqual(await get('node_modules'), ['node_modules/']);
		assert.deepStrictEqual(await get('node_modules/a/missing'), []);
		assert.deepStrictEqual(await get('node_modules/a/', 'src'), [
			'node_modules/a/',
			'src/cache.tmp',
			'src/dist/a.tmp',
			'src/keep.log',
		]);
	});

	test('a scope beyond a symlink, which check-ignore refuses, lists nothing instead of failing the call', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		try {
			const get = (...paths: string[]) => repo.provider.getIgnoredEntries(repo.path, { paths: paths });

			assert.deepStrictEqual(await get('linked/dist'), []);
			assert.deepStrictEqual(await get('linked/dist', 'node_modules/a'), ['node_modules/a/']);
		} finally {
			rmSync(link, { force: true });
		}
	});

	test('many scopes with one beyond a symlink are answered by re-asking only the scopes after it, not one run each', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const run = sinon.spy(repo.provider.git, 'run');
		try {
			const scopes = [
				...ignoredFiles.slice(0, 5),
				'linked/dist',
				...ignoredFiles.slice(5),
				'src/index.ts',
				...Array.from({ length: 14 }, (_, i) => `src/missing${i}`),
			];

			const entries = await repo.provider.getIgnoredEntries(repo.path, { paths: scopes });

			assert.deepStrictEqual(entries, [...ignoredFiles].sort());
			assert.strictEqual(countCheckIgnoreRuns(run), 2);
		} finally {
			run.restore();
			rmSync(link, { force: true });
		}
	});

	test('getIgnoredPaths answers every other path when one is beyond a symlink, re-asking only the paths after it', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const run = sinon.spy(repo.provider.git, 'run');
		try {
			// `:`-prefixed spellings come back in the caller's spelling, whether answered before the refused path or after
			write(':odd.log');
			write(':late.log');
			const paths = [
				...ignoredFiles.slice(0, 5),
				':odd.log',
				'linked/dist/a.tmp',
				':late.log',
				...ignoredFiles.slice(5),
				'src/index.ts',
				...Array.from({ length: 14 }, (_, i) => `src/missing${i}.ts`),
			];

			const result = await repo.provider.getIgnoredPaths(repo.path, paths);

			assert.deepStrictEqual([...result].sort(), [...ignoredFiles, ':late.log', ':odd.log'].sort());
			assert.strictEqual(countCheckIgnoreRuns(run), 2);
		} finally {
			run.restore();
			rmSync(link, { force: true });
			rmSync(join(repo.path, ':odd.log'), { force: true });
			rmSync(join(repo.path, ':late.log'), { force: true });
		}
	});

	test('getIgnoredPaths keeps the leading whitespace of a path answered ahead of a refused path', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const run = sinon.spy(repo.provider.git, 'run');
		try {
			const result = await repo.provider.getIgnoredPaths(repo.path, [' lead.log', 'linked/x.log', '\tafter.log']);

			assert.deepStrictEqual([...result].sort(), ['\tafter.log', ' lead.log']);
			assert.strictEqual(countCheckIgnoreRuns(run), 2);
		} finally {
			run.restore();
			rmSync(link, { force: true });
		}
	});

	test('getIgnoredPaths answers the rest when a refused path holds a line break', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const run = sinon.spy(repo.provider.git, 'run');
		try {
			const result = await repo.provider.getIgnoredPaths(repo.path, [
				'src/keep.log',
				'linked/a\nb.log',
				'src/cache.tmp',
			]);

			assert.deepStrictEqual([...result].sort(), ['src/cache.tmp', 'src/keep.log']);
			assert.strictEqual(countCheckIgnoreRuns(run), 2);
		} finally {
			run.restore();
			rmSync(link, { force: true });
		}
	});

	test('getIgnoredPaths counts every refused path as not ignored, wherever it falls and even alone, in one run plus one per refusal', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const run = sinon.spy(repo.provider.git, 'run');
		try {
			assert.deepStrictEqual(
				[...(await repo.provider.getIgnoredPaths(repo.path, ['linked/x.log', 'src/keep.log', 'linked/y.log']))],
				['src/keep.log'],
			);
			assert.strictEqual(countCheckIgnoreRuns(run), 2);

			// Outside the repository, and empty, are refused the same way
			run.resetHistory();
			assert.deepStrictEqual(
				[
					...(await repo.provider.getIgnoredPaths(repo.path, [
						'src/keep.log',
						'../out.log',
						'',
						'src/cache.tmp',
					])),
				].sort(),
				['src/cache.tmp', 'src/keep.log'],
			);
			assert.strictEqual(countCheckIgnoreRuns(run), 3);

			// The rest of a refused symlink's folder, deeper ones too, goes unasked; a `..` path through it is still asked
			run.resetHistory();
			const refused = [
				...Array.from({ length: 20 }, (_, i) => `linked/f${i}.log`),
				'linked/deep/g.log',
				'linked/../src/keep.log',
			];
			assert.deepStrictEqual(
				[...(await repo.provider.getIgnoredPaths(repo.path, refused))],
				['linked/../src/keep.log'],
			);
			assert.strictEqual(countCheckIgnoreRuns(run), 2);

			run.resetHistory();
			assert.strictEqual((await repo.provider.getIgnoredPaths(repo.path, ['linked/f.log'])).size, 0);
			assert.strictEqual(countCheckIgnoreRuns(run), 1);
		} finally {
			run.restore();
			rmSync(link, { force: true });
		}
	});

	test('getIgnoredPaths throws a failure other than a refused path after one run', async () => {
		const notARepo = mkdtempSync(join(tmpdir(), 'gl-ignored-not-a-repo-'));
		const run = sinon.spy(repo.provider.git, 'run');
		try {
			await assert.rejects(
				repo.provider.getIgnoredPaths(
					notARepo,
					Array.from({ length: 20 }, (_, i) => `f${i}.log`),
				),
				/not a git repository/i,
			);
			assert.strictEqual(countCheckIgnoreRuns(run), 1);
		} finally {
			run.restore();
			rmSync(notARepo, { recursive: true, force: true });
		}
	});

	test('getIgnoredPaths rethrows a cancellation that arrives while re-asking after a refused path', async function () {
		const link = join(repo.path, 'linked');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		// Cancelled once the batch has been refused, so the cancellation lands on the run over the paths after it
		const controller = new AbortController();
		const run = repo.provider.git.run.bind(repo.provider.git);
		const stub = sinon.stub(repo.provider.git, 'run').callsFake(async (options, ...args) => {
			try {
				return await run(options, ...args);
			} finally {
				controller.abort();
			}
		});
		try {
			await assert.rejects(
				repo.provider.getIgnoredPaths(
					repo.path,
					['src/cache.tmp', 'linked/dist', 'src/keep.log'],
					undefined,
					controller.signal,
				),
				(ex: unknown) => isCancellationError(ex),
			);
			assert.strictEqual(countCheckIgnoreRuns(stub), 2);
		} finally {
			stub.restore();
			rmSync(link, { force: true });
		}
	});

	test('getIgnoredPaths counts a path inside a submodule as not ignored and answers the rest', async () => {
		const sub = createTestRepo();
		const main = createTestRepo();
		try {
			execFileSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub.path, 'sm'], {
				cwd: main.path,
				stdio: 'pipe',
			});
			writeFileSync(join(main.path, '.gitignore'), '*.log\n');
			writeFileSync(join(main.path, 'a.log'), 'x\n');
			writeFileSync(join(main.path, 'b.log'), 'x\n');

			const result = await main.provider.getIgnoredPaths(main.path, ['a.log', 'sm/x.log', 'b.log']);

			assert.deepStrictEqual([...result].sort(), ['a.log', 'b.log']);
		} finally {
			main.cleanup();
			sub.cleanup();
		}
	});

	test('getIgnoredPaths does not report a path a `!` rule re-includes, or a tracked file, on either side of a refused path', async function () {
		const other = createTestRepo();
		try {
			writeFileSync(join(other.path, '.gitignore'), '*.log\n!keep.log\n');
			writeFileSync(join(other.path, 'tracked.log'), 'x\n');
			execFileSync('git', ['add', '-f', 'tracked.log'], { cwd: other.path, stdio: 'pipe' });
			mkdirSync(join(other.path, 'src'));
			try {
				symlinkSync(join(other.path, 'src'), join(other.path, 'linked'), 'dir');
			} catch {
				this.skip();
			}

			const result = await other.provider.getIgnoredPaths(other.path, [
				'a.log',
				'keep.log',
				'tracked.log',
				'linked/x.log',
				'keep.log',
				'tracked.log',
				'b.log',
			]);

			assert.deepStrictEqual([...result].sort(), ['a.log', 'b.log']);
		} finally {
			other.cleanup();
		}
	});

	test('an ignored symlink to a folder is answered as a file, as git lists it', async function () {
		const link = join(repo.path, 'vendor-link');
		try {
			symlinkSync(join(repo.path, 'src'), link, 'dir');
		} catch {
			this.skip();
		}

		const exclude = join(repo.path, '.git', 'info', 'exclude');
		mkdirSync(dirname(exclude), { recursive: true });
		writeFileSync(exclude, 'vendor-link\n');
		try {
			assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path, { paths: ['vendor-link'] }), [
				'vendor-link',
			]);
		} finally {
			writeFileSync(exclude, '');
			rmSync(link, { force: true });
		}
	});

	test('an ignored folder is listed only when a file lies somewhere below it', async () => {
		const exclude = join(repo.path, '.git', 'info', 'exclude');
		mkdirSync(dirname(exclude), { recursive: true });
		writeFileSync(exclude, 'cachedir/\n');
		mkdirSync(join(repo.path, 'holder/cachedir'), { recursive: true });
		mkdirSync(join(repo.path, 'nested/cachedir/a/b'), { recursive: true });
		write('deep/cachedir/a/b/f.txt');
		try {
			const get = (...paths: string[]) => repo.provider.getIgnoredEntries(repo.path, { paths: paths });

			assert.deepStrictEqual(await get('holder/cachedir'), []);
			assert.deepStrictEqual(await get('nested/cachedir'), []);
			assert.deepStrictEqual(await get('deep/cachedir'), ['deep/cachedir/']);
			assert.deepStrictEqual(await get('holder/cachedir', 'nested/cachedir', 'deep/cachedir'), [
				'deep/cachedir/',
			]);

			const unscoped = await repo.provider.getIgnoredEntries(repo.path);
			assert.ok(
				unscoped.some(e => e.startsWith('deep/')),
				'deep/',
			);
			assert.ok(!unscoped.some(e => e.startsWith('holder/') || e.startsWith('nested/')), 'empty folders');
		} finally {
			writeFileSync(exclude, '');
			for (const dir of ['holder', 'nested', 'deep']) {
				rmSync(join(repo.path, dir), { recursive: true, force: true });
			}
		}
	});

	test('an empty paths array answers empty', async () => {
		assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path, { paths: [] }), []);
	});

	test('unscoped still lists the whole working tree', async () => {
		const status = git(
			'-c',
			'status.renames=false',
			'status',
			'--porcelain=v1',
			'-z',
			'--ignored',
			'--untracked-files=normal',
			'--ignore-submodules=all',
		);
		const expected = status
			.split('\0')
			.filter(r => r.startsWith('!! '))
			.map(r => r.substring(3))
			.sort();

		assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path), expected);
		assert.deepStrictEqual(await repo.provider.getIgnoredEntries(repo.path, { priority: 'interactive' }), expected);
	});
});

suite('CliGitProvider getIgnoredEntries inside new untracked folders', () => {
	let repo: TestRepo;

	function write(relativePath: string, content = 'x\n'): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, stdio: 'pipe', encoding: 'utf8' });
	}

	suiteSetup(() => {
		repo = createTestRepo();

		const excludesFile = join(repo.path, '.git', 'test-excludes');
		writeFileSync(excludesFile, '');
		git(repo.path, 'config', 'core.excludesFile', excludesFile);

		write('.gitignore', 'node_modules/\n*.log\nbuild/\n/top.tmp\n');
		git(repo.path, 'add', '-f', '.gitignore');
		git(repo.path, 'commit', '-m', 'Add files');

		write('newpkg/index.ts');
		write('newpkg/a.log');
		write('newpkg/node_modules/x/y.js');
		write('newpkg/logs/1.log');
		write('newpkg/logs/2.log');
		write('newpkg/logs/deep/3.log');
		write('newpkg/mixed/keep.ts');
		write('newpkg/mixed/m.log');
		write('newpkg/mixed/node_modules/z');
		write('newpkg/onlymods/node_modules/q');
		write('newpkg/emptyish/e.log');
		mkdirSync(join(repo.path, 'newpkg/emptyish/void'), { recursive: true });
		write('newpkg/nested/inner/keep2.ts');
		write('newpkg/nested/inner/logs/x.log');
		write('newpkg/build/out.js');
		write('newpkg/top.tmp');
		write('other/keep3.ts');
		write('other/sub/only.log');
		write('newpkg/repo/file');
		git(join(repo.path, 'newpkg/repo'), 'init');
		write('newpkg/[id]/g.log');
		write('newpkg/i/h.ts');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('lists the same entries as a traditional status --ignored', async () => {
		const expected = git(
			repo.path,
			'-c',
			'status.renames=false',
			'status',
			'--porcelain',
			'-z',
			'--ignored',
			'--untracked-files=normal',
			'--ignore-submodules=all',
		)
			.split('\0')
			.filter(r => r.startsWith('!! '))
			.map(r => r.substring(3))
			.sort();

		const result = await repo.provider.getIgnoredEntries(repo.path);

		assert.deepStrictEqual(result, expected);
		assert.deepStrictEqual(result, [
			'newpkg/[id]/',
			'newpkg/a.log',
			'newpkg/build/',
			'newpkg/emptyish/',
			'newpkg/logs/',
			'newpkg/mixed/m.log',
			'newpkg/mixed/node_modules/',
			'newpkg/nested/inner/logs/',
			'newpkg/node_modules/',
			'newpkg/onlymods/',
			'other/sub/',
		]);
	});
});
