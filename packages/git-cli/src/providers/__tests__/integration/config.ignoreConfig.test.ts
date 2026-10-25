import * as assert from 'assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createProvider, createTestRepo, createWorktree, setConfig } from './helpers.js';

/**
 * Every checkout of a repository shares one read of the config its gitignore filter loads (`core.excludesFile`,
 * `core.ignorecase`), unless that config can differ by checkout. Processes are told apart by the `• completed` line
 * each logs.
 */
suite('Ignore config is read once per repository', () => {
	const envKeys = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM'] as const;
	const completed: string[] = [];
	const logger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed')) {
				completed.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};

	let repo: TestRepo;
	let provider: CliGitProvider;
	let worktrees: { path: string; cleanup: () => void }[];
	let sandbox: string;
	let previousEnv: Record<(typeof envKeys)[number], string | undefined>;

	setup(() => {
		// The user's own global config would put `core.excludesFile` and `core.ignorecase` in every listing
		sandbox = mkdtempSync(join(tmpdir(), 'gitlens-ignore-config-'));
		previousEnv = {
			GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
			GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
		};
		process.env.GIT_CONFIG_GLOBAL = join(sandbox, 'gitconfig');
		process.env.GIT_CONFIG_NOSYSTEM = '1';
		repo = createTestRepo();
		provider = createProvider({ gitOptions: { logger: logger } });
		worktrees = [];
		completed.length = 0;
	});

	teardown(() => {
		provider.dispose();
		for (const wt of worktrees) {
			wt.cleanup();
		}
		repo.cleanup();
		for (const key of envKeys) {
			if (previousEnv[key] === undefined) {
				Reflect.deleteProperty(process.env, key);
			} else {
				process.env[key] = previousEnv[key];
			}
		}
		rmSync(sandbox, { recursive: true, force: true });
	});

	function linkedWorktree(branch: string): string {
		createBranch(repo.path, branch);
		const wt = createWorktree(repo.path, branch);
		worktrees.push(wt);
		return wt.path;
	}

	async function register(...paths: string[]): Promise<void> {
		for (const path of paths) {
			provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
		}
	}

	function writeExcludes(name: string, content: string): string {
		const path = join(repo.path, '.git', name);
		writeFileSync(path, content);
		return path;
	}

	async function loadFilter(path: string): Promise<ReturnType<CliGitProvider['getIgnoreFilter']>> {
		const filter = provider.getIgnoreFilter(path);
		await filter.ready();
		return filter;
	}

	const listingReads = (): string[] => completed.filter(m => m.includes(' config --null --get-regexp '));
	const ownReads = (): string[] =>
		completed.filter(
			m => m.includes(' config --get core.excludesFile') || m.includes(' config --get core.ignorecase'),
		);

	test('two checkouts load their filters from one listing and spawn no read of their own', async () => {
		const excludes = writeExcludes('shared-excludes', '*.shared\n');
		setConfig(repo.path, 'core.excludesFile', excludes);
		const first = linkedWorktree('first');
		const second = linkedWorktree('second');
		await register(repo.path, first, second);

		completed.length = 0;
		const filters = [await loadFilter(repo.path), await loadFilter(first), await loadFilter(second)];

		for (const filter of filters) {
			assert.ok(filter.isIgnored('a.shared'));
			assert.ok(!filter.isIgnored('a.other'));
		}
		const ignoreListings = listingReads().filter(m => m.includes('core\\.excludesfile'));
		assert.strictEqual(ignoreListings.length, 1, completed.join('\n'));
		assert.deepStrictEqual(ownReads(), [], completed.join('\n'));
	});

	test('a checkout-specific core.excludesFile in config.worktree is honoured by that checkout', async () => {
		const mainExcludes = writeExcludes('main-excludes', '*.mainonly\n');
		setConfig(repo.path, 'core.excludesFile', mainExcludes);
		setConfig(repo.path, 'extensions.worktreeConfig', 'true');
		const linked = linkedWorktree('linked');
		const linkedExcludes = writeExcludes('linked-excludes', '*.linkedonly\n');
		execFileSync('git', ['config', '--worktree', 'core.excludesFile', linkedExcludes], {
			cwd: linked,
			stdio: 'pipe',
		});
		await register(repo.path, linked);

		completed.length = 0;
		const mainFilter = await loadFilter(repo.path);
		assert.deepStrictEqual(ownReads(), [], 'the main checkout takes the shared listing');
		const linkedFilter = await loadFilter(linked);
		assert.strictEqual(ownReads().length, 2, 'the linked checkout reads its own');

		assert.ok(mainFilter.isIgnored('a.mainonly'));
		assert.ok(!mainFilter.isIgnored('a.linkedonly'));
		assert.ok(linkedFilter.isIgnored('a.linkedonly'));
		assert.ok(!linkedFilter.isIgnored('a.mainonly'));
	});

	test('a conditional include that follows a checkout’s branch is read by that checkout', async () => {
		const featureExcludes = writeExcludes('feature-excludes', '*.feature\n');
		const include = writeExcludes('feature-config', `[core]\n\texcludesFile = ${featureExcludes}\n`);
		setConfig(repo.path, 'includeIf.onbranch:feature.path', include);
		const linked = linkedWorktree('feature');
		await register(repo.path, linked);

		completed.length = 0;
		const mainFilter = await loadFilter(repo.path);
		assert.deepStrictEqual(ownReads(), [], 'the main checkout takes the shared listing');
		const linkedFilter = await loadFilter(linked);
		assert.strictEqual(ownReads().length, 2, 'the linked checkout reads its own');

		assert.ok(linkedFilter.isIgnored('a.feature'));
		assert.ok(!mainFilter.isIgnored('a.feature'));
	});

	test('a config change makes the next read spawn the listing again', async () => {
		const before = writeExcludes('before-excludes', '*.before\n');
		const after = writeExcludes('after-excludes', '*.after\n');
		setConfig(repo.path, 'core.excludesFile', before);
		const linked = linkedWorktree('linked');
		await register(repo.path, linked);

		completed.length = 0;
		assert.strictEqual((await provider.config.getIgnoreConfig(linked)).excludesFile, before);
		setConfig(repo.path, 'core.excludesFile', after);
		assert.strictEqual(
			(await provider.config.getIgnoreConfig(linked)).excludesFile,
			before,
			'the read is cached until a change is reported',
		);
		assert.strictEqual(listingReads().length, 1, completed.join('\n'));

		provider.cache.onRepositoryChanged(repo.path, ['config']);
		assert.strictEqual((await provider.config.getIgnoreConfig(linked)).excludesFile, after);
		assert.strictEqual(listingReads().length, 2, completed.join('\n'));
	});

	test('a core.ignorecase set without a value is true', async () => {
		appendFileSync(join(repo.path, '.git', 'config'), '[core]\n\tignorecase\n');
		writeFileSync(join(repo.path, '.gitignore'), 'build/\n');
		const linked = linkedWorktree('linked');
		await register(repo.path, linked);

		assert.strictEqual((await provider.config.getIgnoreConfig(repo.path)).ignoreCase, 'true');
		assert.strictEqual((await provider.config.getIgnoreConfig(linked)).ignoreCase, 'true');

		const filter = await loadFilter(repo.path);
		assert.ok(filter.isIgnored('Build/x.js'));
	});

	test('the last value of a repeated key wins, as in git', async () => {
		execFileSync('git', ['config', '--add', 'core.excludesFile', '/first'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['config', '--add', 'core.excludesFile', '/last'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['config', '--add', 'core.ignorecase', 'false'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['config', '--add', 'core.ignorecase', 'true'], { cwd: repo.path, stdio: 'pipe' });
		await register(repo.path);

		assert.deepStrictEqual(await provider.config.getIgnoreConfig(repo.path), {
			excludesFile: '/last',
			ignoreCase: 'true',
		});
	});

	test('an unset key reads as undefined and the empty answer is cached', async () => {
		// `git init` records it on a case-insensitive filesystem
		spawnSync('git', ['config', '--unset', 'core.ignorecase'], { cwd: repo.path });
		const linked = linkedWorktree('linked');
		await register(repo.path, linked);

		completed.length = 0;
		for (const path of [repo.path, linked, repo.path]) {
			assert.deepStrictEqual(await provider.config.getIgnoreConfig(path), {
				excludesFile: undefined,
				ignoreCase: undefined,
			});
		}
		assert.strictEqual(listingReads().length, 1, completed.join('\n'));
		assert.deepStrictEqual(ownReads(), [], completed.join('\n'));
	});

	test('a failed listing read is not cached, and the checkout reads its own meanwhile', async () => {
		const excludes = writeExcludes('later-excludes', '*.later\n');
		await register(repo.path);
		const config = join(repo.path, '.git', 'config');
		const valid = readFileSync(config, 'utf-8');
		writeFileSync(config, `${valid}[core\n`);

		completed.length = 0;
		assert.deepStrictEqual(await provider.config.getIgnoreConfig(repo.path), {
			excludesFile: undefined,
			ignoreCase: undefined,
		});
		assert.strictEqual(listingReads().length, 1, completed.join('\n'));

		writeFileSync(config, `${valid}[core]\n\texcludesFile = ${excludes}\n`);
		await provider.config.getIgnoreConfig(repo.path);
		assert.strictEqual(listingReads().length, 2, completed.join('\n'));
	});

	test('a read still in flight when config changes is not joined by the next one', async () => {
		await register(repo.path);
		let release!: () => void;
		const held = new Promise<void>(resolve => (release = resolve));

		const stale = provider.cache.getIgnoreConfigListing(repo.path, async () => {
			await held;
			return 'stale';
		});
		provider.cache.onRepositoryChanged(repo.path, ['config']);
		const fresh = provider.cache.getIgnoreConfigListing(repo.path, () => 'fresh');
		release();

		assert.strictEqual(await fresh, 'fresh');
		assert.strictEqual(await stale, 'stale');
	});

	test('a checkout in the main checkout re-reads config its branch selects', async () => {
		const featureExcludes = writeExcludes('feature-excludes', '*.feature\n');
		const include = writeExcludes('feature-config', `[core]\n\texcludesFile = ${featureExcludes}\n`);
		setConfig(repo.path, 'includeIf.onbranch:feature.path', include);
		await register(repo.path);

		assert.strictEqual((await provider.config.getIgnoreConfig(repo.path)).excludesFile, undefined);
		execFileSync('git', ['checkout', '-q', '-b', 'feature'], { cwd: repo.path, stdio: 'pipe' });
		provider.cache.onRepositoryChanged(repo.path, ['head']);

		assert.strictEqual((await provider.config.getIgnoreConfig(repo.path)).excludesFile, featureExcludes);
	});
});
