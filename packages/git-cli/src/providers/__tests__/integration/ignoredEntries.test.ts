import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
