import * as assert from 'assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

/**
 * Cross-checks the in-memory `GitIgnoreFilter` (root + nested `.gitignore`, `info/exclude`, `core.excludesFile`)
 * against git's own verdict, so the walk and precedence rules can't drift from what git actually does.
 */
suite('GitIgnoreFilter matches git check-ignore', () => {
	let repo: TestRepo;

	// [path, ignored] — git's verdict is asserted too, so a broken fixture can't make the cross-check pass vacuously
	const cases: [string, boolean][] = [
		['root-only.txt', true],
		['pkg/root-only.txt', false],
		['error.log', true],
		['pkg/error.log', true],
		['important.log', true],
		['pkg/important.log', false],
		['pkg/out', true],
		['pkg/out/a.js', true],
		['out/a.js', false],
		['pkg/sub/out', false],
		['build/', true],
		['build/x.js', true],
		['pkg/build/x.js', true],
		['pkg/gen/', true],
		['pkg/gen/x.ts', true],
		['gen/x.ts', false],
		['vendor/', true],
		['vendor/lib.js', true],
		['a.tmp', true],
		['keep.tmp', false],
		['secret/key', true],
		['pkg/sub/', false],
		['pkg/sub/debug.log', false],
		['pkg/sub/local.txt', true],
		['pkg/local.txt', false],
		['pkg/cache/', false],
		['pkg/cache/x.txt', false],
		['src/index.ts', false],
	];

	function write(relativePath: string, content: string): void {
		const path = join(repo.path, relativePath);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
	}

	function git(...args: string[]): void {
		execFileSync('git', args, { cwd: repo.path, stdio: 'pipe' });
	}

	suiteSetup(() => {
		repo = createTestRepo();

		// A repo-local core.excludesFile keeps the user's global excludes out of both verdicts
		const excludesFile = join(repo.path, '.git', 'test-excludes');
		writeFileSync(excludesFile, '*.tmp\n');
		git('config', 'core.excludesFile', excludesFile);

		write('.git/info/exclude', 'secret/\n');
		write('.gitignore', '/root-only.txt\n*.log\nbuild/\nvendor/\n!keep.tmp\npkg/cache/\n');
		write('pkg/.gitignore', '/out\n!important.log\ngen/\n!cache/\n');
		// Untracked but not ignored — git reads it
		write('pkg/sub/.gitignore', '!debug.log\nlocal.txt\n');
		// Inside ignored directories — git never reads these, tracked or not
		write('vendor/.gitignore', '!*\n!lib.js\n');
		write('secret/.gitignore', '!key\n');
		git('add', '.gitignore', 'pkg/.gitignore');
		git('add', '-f', 'vendor/.gitignore');
		git('commit', '-m', 'Add ignore files');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	test('isIgnored agrees with git for root, nested, info/exclude and core.excludesFile patterns', async () => {
		const filter = repo.provider.getIgnoreFilter(repo.path);
		await filter.ready();

		const expected = cases.map(([path, ignored]) => `${ignored ? 'ignored' : 'kept'}\t${path}`);

		const fromGit = cases.map(([path]) => {
			const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: repo.path });
			assert.ok(result.status === 0 || result.status === 1, `git check-ignore failed for ${path}`);
			return `${result.status === 0 ? 'ignored' : 'kept'}\t${path}`;
		});
		assert.deepStrictEqual(fromGit, expected, 'fixture: git verdicts');

		const fromFilter = cases.map(([path]) => `${filter.isIgnored(path) ? 'ignored' : 'kept'}\t${path}`);
		assert.deepStrictEqual(fromFilter, fromGit);
	});

	test('matches case the way `core.ignorecase` says, not the platform default', async () => {
		// The opposite of the platform default, so following the platform would disagree with git
		const ignoreCase = process.platform === 'linux';
		const caseRepo = createTestRepo();
		try {
			execFileSync('git', ['config', 'core.ignorecase', ignoreCase ? 'yes' : 'off'], {
				cwd: caseRepo.path,
				stdio: 'pipe',
			});
			writeFileSync(join(caseRepo.path, '.gitignore'), 'build/\n');

			const filter = caseRepo.provider.getIgnoreFilter(caseRepo.path);
			await filter.ready();

			const result = spawnSync('git', ['check-ignore', '--no-index', '-q', 'Build/x.js'], { cwd: caseRepo.path });
			assert.strictEqual(result.status === 0, ignoreCase, 'fixture: git verdict');
			assert.strictEqual(filter.isIgnored('Build/x.js'), ignoreCase);
			assert.ok(filter.isIgnored('build/x.js'));
		} finally {
			caseRepo.cleanup();
		}
	});
});

suite('GitIgnoreFilter reads global excludes where git does', () => {
	const envKeys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'XDG_CONFIG_HOME', 'HOME'] as const;
	let savedEnv: Partial<Record<(typeof envKeys)[number], string | undefined>>;
	let sandbox: string;

	setup(() => {
		savedEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
		sandbox = mkdtempSync(join(tmpdir(), 'gitlens-excludes-'));
		// Isolate from the machine's own global and system config, which may set `core.excludesFile`
		process.env.GIT_CONFIG_GLOBAL = join(sandbox, 'gitconfig');
		process.env.GIT_CONFIG_NOSYSTEM = '1';
		process.env.XDG_CONFIG_HOME = join(sandbox, 'xdg');
		process.env.HOME = join(sandbox, 'home');
		mkdirSync(join(sandbox, 'xdg', 'git'), { recursive: true });
		mkdirSync(join(sandbox, 'home'), { recursive: true });
		writeFileSync(join(sandbox, 'gitconfig'), '');
	});

	teardown(() => {
		for (const k of envKeys) {
			const value = savedEnv[k];
			if (value == null) {
				Reflect.deleteProperty(process.env, k);
			} else {
				process.env[k] = value;
			}
		}
		rmSync(sandbox, { recursive: true, force: true });
	});

	async function assertAgreesWithGit(path: string, ignored: boolean): Promise<void> {
		const repo = createTestRepo();
		try {
			const filter = repo.provider.getIgnoreFilter(repo.path);
			await filter.ready();

			const result = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: repo.path });
			assert.strictEqual(result.status === 0, ignored, 'fixture: git verdict');
			assert.strictEqual(filter.isIgnored(path), ignored);
		} finally {
			repo.cleanup();
		}
	}

	test('reads $XDG_CONFIG_HOME/git/ignore when core.excludesFile is unset', async () => {
		writeFileSync(join(sandbox, 'xdg', 'git', 'ignore'), '*.xdg\n');
		await assertAgreesWithGit('a.xdg', true);
	});

	test('resolves a relative core.excludesFile from the repository root, as git does', async () => {
		const repo = createTestRepo();
		try {
			execFileSync('git', ['config', 'core.excludesFile', 'rel-excludes'], { cwd: repo.path, stdio: 'pipe' });
			writeFileSync(join(repo.path, 'rel-excludes'), '*.rel\n');

			const filter = repo.provider.getIgnoreFilter(repo.path);
			await filter.ready();

			const result = spawnSync('git', ['check-ignore', '--no-index', '-q', 'a.rel'], { cwd: repo.path });
			assert.strictEqual(result.status, 0, 'fixture: git verdict');
			assert.ok(filter.isIgnored('a.rel'));
		} finally {
			repo.cleanup();
		}
	});

	test('expands a `~/` core.excludesFile the way git does', async () => {
		writeFileSync(join(sandbox, 'gitconfig'), '[core]\n\texcludesFile = ~/my-excludes\n');
		writeFileSync(join(sandbox, 'home', 'my-excludes'), '*.home\n');
		await assertAgreesWithGit('a.home', true);
	});
});
