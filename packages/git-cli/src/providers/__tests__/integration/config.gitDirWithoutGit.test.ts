import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GitDir } from '@gitlens/git/models/repository.js';
import type { LogChannel } from '@gitlens/utils/logger.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { GitOptions } from '../../../exec/git.js';
import { createProvider } from './helpers.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

function initRepo(path: string): string {
	mkdirSync(path, { recursive: true });
	git(path, 'init', '-q', '-b', 'main');
	git(path, '-c', 'user.name=Test', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
	return path;
}

function describe(gitDir: GitDir): Record<string, string | undefined> {
	return {
		uri: gitDir.uri.toString(true),
		commonUri: gitDir.commonUri?.toString(true),
		parentUri: gitDir.parentUri?.toString(true),
	};
}

/**
 * `getGitDir` reads ordinary layouts from the filesystem and asks git (`rev-parse --show-toplevel --git-dir
 * --git-common-dir --show-superproject-working-tree`) about anything else. Each case compares its answer with the one
 * the rev-parse path gives, and counts the `rev-parse` processes it ran through `gitOptions.logger`.
 */
suite('getGitDir without running git (real git)', () => {
	let root: string;
	let main: string;
	const revParses: string[] = [];
	const countingLogger: LogChannel = {
		name: 'spawn-counter',
		logLevel: 0,
		dispose: () => {},
		trace: () => {},
		debug: () => {},
		info: (msg: string) => {
			if (msg.includes('• completed') && msg.includes('rev-parse')) {
				revParses.push(msg);
			}
		},
		warn: () => {},
		error: () => {},
	};
	const providers: CliGitProvider[] = [];

	function newProvider(gitOptions?: GitOptions): CliGitProvider {
		const provider = createProvider({ gitOptions: { logger: countingLogger, ...gitOptions } });
		providers.push(provider);
		return provider;
	}

	/** The `getGitDir` answer through rev-parse, the way it read before reading the filesystem */
	async function getGitDirFromRevParse(path: string): Promise<GitDir> {
		const info = await newProvider().config.getRepositoryInfo(path);
		assert.ok(info != null && !Array.isArray(info), `rev-parse resolved no repository for ${path}`);
		return {
			uri: fileUri(info.gitDir),
			commonUri: info.commonGitDir ? fileUri(info.commonGitDir) : undefined,
			parentUri: info.superprojectPath ? fileUri(info.superprojectPath) : undefined,
		};
	}

	async function getGitDir(path: string, gitOptions?: GitOptions): Promise<{ gitDir: GitDir; revParses: number }> {
		const provider = newProvider(gitOptions);
		revParses.length = 0;
		const gitDir = await provider.config.getGitDir(path);
		return { gitDir: gitDir, revParses: revParses.length };
	}

	async function assertReadWithoutGit(path: string): Promise<void> {
		const { gitDir, revParses: count } = await getGitDir(path);
		assert.strictEqual(count, 0, `${path} should resolve without running git`);
		assert.deepStrictEqual(describe(gitDir), describe(await getGitDirFromRevParse(path)));
	}

	async function assertAsksGit(path: string): Promise<void> {
		const { gitDir, revParses: count } = await getGitDir(path);
		assert.ok(count > 0, `${path} should be resolved by git`);
		assert.deepStrictEqual(describe(gitDir), describe(await getGitDirFromRevParse(path)));
	}

	setup(() => {
		// Real path: the fixtures compare paths git prints, which are resolved through symlinks
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gitlens-gitdir-fs-')));
		main = initRepo(join(root, 'main'));
	});

	teardown(() => {
		for (const provider of providers.splice(0)) {
			provider.dispose();
		}
		rmSync(root, { recursive: true, force: true });
	});

	test('reads a main worktree', async () => {
		await assertReadWithoutGit(main);
	});

	test('reads a linked worktree', async () => {
		git(main, 'worktree', 'add', '-q', '-b', 'linked', join(root, 'wt'));
		await assertReadWithoutGit(join(root, 'wt'));
	});

	test('reads a main worktree and a linked worktree reached through symlinks', async () => {
		git(main, 'worktree', 'add', '-q', '-b', 'linked', join(root, 'wt'));
		symlinkSync(main, join(root, 'main-link'));
		symlinkSync(join(root, 'wt'), join(root, 'wt-link'));

		await assertReadWithoutGit(join(root, 'main-link'));
		await assertReadWithoutGit(join(root, 'wt-link'));
	});

	test("reads a linked worktree whose gitdir and commondir lead through a symlink, as git's realpath does", async () => {
		git(main, 'worktree', 'add', '-q', '-b', 'linked', join(root, 'wt'));
		symlinkSync(main, join(root, 'main-link'));
		// Git for Windows marks a worktree's `.git` file hidden, and Windows refuses to overwrite a hidden file
		rmSync(join(root, 'wt', '.git'));
		writeFileSync(join(root, 'wt', '.git'), `gitdir: ${join(root, 'main-link', '.git', 'worktrees', 'wt')}\n`);
		writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), `${join(root, 'main-link', '.git')}\r\n`);

		await assertReadWithoutGit(join(root, 'wt'));
	});

	test('reads a linked worktree with relative paths, reached through a symlink in another folder', async function () {
		try {
			git(main, 'worktree', 'add', '-q', '--relative-paths', '-b', 'linked', join(root, 'wt'));
		} catch {
			this.skip();
		}

		// `../main/...` in the `.git` file resolves from where the worktree is, not from where the link is
		mkdirSync(join(root, 'a', 'b'), { recursive: true });
		symlinkSync(join(root, 'wt'), join(root, 'a', 'b', 'wt-link'));

		await assertReadWithoutGit(join(root, 'wt'));
		await assertReadWithoutGit(join(root, 'a', 'b', 'wt-link'));
	});

	test('reads the linked worktrees of a bare repository', async () => {
		const bare = join(root, 'bare.git');
		git(root, 'clone', '-q', '--bare', main, bare);
		git(bare, 'worktree', 'add', '-q', '-b', 'inside', join(bare, 'inside'));
		git(bare, 'worktree', 'add', '-q', '-b', 'outside', join(root, 'outside'));

		// A bare repository behind a `.git` file, with its worktrees beside it
		const project = join(root, 'project');
		git(root, 'clone', '-q', '--bare', main, join(project, '.bare'));
		writeFileSync(join(project, '.git'), 'gitdir: ./.bare\n');
		git(project, 'worktree', 'add', '-q', '-b', 'feature', join(project, 'feature'));

		await assertReadWithoutGit(join(bare, 'inside'));
		await assertReadWithoutGit(join(root, 'outside'));
		await assertReadWithoutGit(join(project, 'feature'));
	});

	test('asks git about a linked worktree nested in its main worktree, which could track it as a submodule', async () => {
		git(main, 'worktree', 'add', '-q', '-b', 'nested', join(main, 'nested'));
		await assertAsksGit(join(main, 'nested'));

		git(main, 'add', 'nested');
		const { gitDir } = await getGitDir(join(main, 'nested'));
		assert.strictEqual(gitDir.parentUri?.toString(true), fileUri(main).toString(true));
	});

	test('asks git about a submodule', async () => {
		const sub = initRepo(join(root, 'sub'));
		git(main, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'sm');

		await assertAsksGit(join(main, 'sm'));
	});

	test('asks git about a repository nested in another one', async () => {
		initRepo(join(main, 'embedded'));

		await assertAsksGit(join(main, 'embedded'));
	});

	test('asks git about a bare repository', async () => {
		const bare = join(root, 'bare.git');
		git(root, 'clone', '-q', '--bare', main, bare);

		const { revParses: count } = await getGitDir(bare);
		assert.ok(count > 0, 'a bare repository should be resolved by git');
	});

	test('asks git about a repository with core.worktree or core.bare set', async () => {
		git(main, 'config', 'core.worktree', main);
		await assertAsksGit(main);

		git(main, 'config', '--unset', 'core.worktree');
		git(main, 'config', 'core.bare', 'true');
		const { revParses: count } = await getGitDir(main);
		assert.ok(count > 0, 'core.bare should be resolved by git');
	});

	test('asks git about core.worktree or core.bare set on the line of its section header', async () => {
		const config = join(main, '.git', 'config');
		const original = readFileSync(config, 'utf8');

		// Forward slashes: git rejects the whole config over a backslash that isn't a valid escape (`C:\Users`)
		writeFileSync(config, `${original}[core] worktree = ${main.replaceAll('\\', '/')}\n`);
		await assertAsksGit(main);

		writeFileSync(config, `${original}[core] bare = true\n`);
		const { revParses: count } = await getGitDir(main);
		assert.ok(count > 0, 'core.bare should be resolved by git');
	});

	test('asks git when its environment sets GIT_DIR, and not when only the inherited one does', async () => {
		const decoy = initRepo(join(root, 'decoy'));

		const { gitDir, revParses: count } = await getGitDir(main, { env: { GIT_DIR: join(decoy, '.git') } });
		assert.ok(count > 0, 'a GIT_DIR git sees should be resolved by git');
		assert.strictEqual(gitDir.uri.toString(true), fileUri(join(decoy, '.git')).toString(true));

		const original = process.env.GIT_DIR;
		process.env.GIT_DIR = join(decoy, '.git');
		try {
			// The base environment drops an inherited GIT_DIR, so git never sees it
			await assertReadWithoutGit(main);
		} finally {
			if (original === undefined) {
				delete process.env.GIT_DIR;
			} else {
				process.env.GIT_DIR = original;
			}
		}
	});

	test('asks git when its environment passes a core.worktree override', async () => {
		const { revParses: count } = await getGitDir(main, {
			env: { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: main },
		});
		assert.ok(count > 0, 'a core.worktree override should be resolved by git');

		await assertReadWithoutGit(main);
	});

	test('runs no rev-parse for the git dirs of linked worktrees (spawn count)', async () => {
		const worktreeCount = 5;
		const paths: string[] = [];
		for (let i = 0; i < worktreeCount; i++) {
			const path = join(root, `wt-${i}`);
			git(main, 'worktree', 'add', '-q', '-b', `task-${i}`, path);
			paths.push(path);
		}

		async function count(gitOptions?: GitOptions): Promise<number> {
			const provider = newProvider(gitOptions);
			revParses.length = 0;
			for (const path of paths) {
				await provider.config.getGitDir(path);
			}
			return revParses.length;
		}

		// An override that changes nothing for git, but that sends every read through it
		const before = await count({ env: { GIT_CONFIG_PARAMETERS: "'include.path'='/nonexistent'" } });
		const after = await count();
		console.log(
			`[measure] getGitDir for ${worktreeCount} linked worktrees: rev-parse before=${before} after=${after}`,
		);

		assert.strictEqual(before, worktreeCount);
		assert.strictEqual(after, 0);
	});
});
