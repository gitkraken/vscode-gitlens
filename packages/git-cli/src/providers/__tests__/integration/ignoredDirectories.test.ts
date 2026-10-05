import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

suite('CliGitProvider getIgnoredDirectories', () => {
	let repo: TestRepo;

	function write(relativePath: string, content = 'x\n'): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function git(...args: string[]): void {
		execFileSync('git', args, { cwd: repo.path, stdio: 'pipe' });
	}

	suiteSetup(() => {
		repo = createTestRepo();

		// A repo-local core.excludesFile keeps the user's global excludes out of the result
		const excludesFile = join(repo.path, '.git', 'test-excludes');
		writeFileSync(excludesFile, '');
		git('config', 'core.excludesFile', excludesFile);

		write('.gitignore', '/dist/\n*.log\nbuild/\n/\\[id\\]/\n');
		write('pkg/.gitignore', '/out\n');
		git('add', '.gitignore', 'pkg/.gitignore');
		git('commit', '-m', 'Add ignore files');

		// Matched by a rule
		write('dist/a.js');
		write('pkg/out/b.js');
		write('build/x.js');
		write('build/cache/y.js');
		write('[id]/z.js');
		// Contents all ignored, but no rule matches the directory itself
		write('logs/a.log');
		write('logs/b.log');
		// Has a file git doesn't ignore
		write('src/index.ts');
		write('src/debug.log');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('returns the directories a rule matches, including nested ones', async () => {
		const result = await repo.provider.getIgnoredDirectories(repo.path);

		assert.ok(result.includes('dist'), 'dist');
		assert.ok(result.includes('pkg/out'), 'pkg/out');
	});

	test('does not return a directory whose contents are all ignored but which no rule matches', async () => {
		const result = await repo.provider.getIgnoredDirectories(repo.path);

		assert.ok(!result.includes('logs'), 'logs');
		assert.ok(!result.includes('src'), 'src');
	});

	test('collapses nested entries into the outermost ignored directory', async () => {
		const result = await repo.provider.getIgnoredDirectories(repo.path);

		assert.ok(result.includes('build'), 'build');
		assert.ok(!result.includes('build/cache'), 'build/cache');
	});

	test('drops a directory whose name contains glob metacharacters', async () => {
		const result = await repo.provider.getIgnoredDirectories(repo.path);

		// The fixture is ignored by git, so its absence is the filter's doing
		execFileSync('git', ['check-ignore', '-q', '[id]/z.js'], { cwd: repo.path });
		assert.ok(!result.some(d => d.includes('[')), '[id]');
	});

	test('returns the entries sorted, and nothing else', async () => {
		const result = await repo.provider.getIgnoredDirectories(repo.path);

		assert.deepStrictEqual(result, ['build', 'dist', 'pkg/out']);
	});

	test('returns an empty set when no directory is ignored', async () => {
		const clean = createTestRepo();
		try {
			const result = await clean.provider.getIgnoredDirectories(clean.path);
			assert.deepStrictEqual(result, []);
		} finally {
			clean.cleanup();
		}
	});
});
