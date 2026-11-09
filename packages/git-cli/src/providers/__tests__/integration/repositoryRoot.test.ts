import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { normalizePath } from '@gitlens/utils/path.js';
import { Git } from '../../../exec/git.js';
import { findGitPath } from '../../../exec/locator.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo, createWorktree } from './helpers.js';

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: cwd, stdio: 'pipe' });
}

suite('Repository root from inside a git dir (real git)', () => {
	const cli = new Git(() => findGitPath(null));
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
	});

	teardown(() => {
		repo.cleanup();
	});

	async function assertResolvesTo(cwd: string, expected: string): Promise<void> {
		const info = await repo.provider.config.getRepositoryInfo(cwd);
		assert.ok(info != null, `getRepositoryInfo(${cwd}) resolved nothing`);
		const repoPath = Array.isArray(info) ? info[1] : info.repoPath;
		assert.strictEqual(repoPath, normalizePath(expected), `getRepositoryInfo(${cwd})`);

		const [, toplevel] = await cli.rev_parse__show_toplevel(cwd);
		assert.strictEqual(toplevel, normalizePath(expected), `rev_parse__show_toplevel(${cwd})`);
	}

	// Some tools drop the `core.bare = false` line `git init` writes; git then guesses "bare" from inside the
	// git dir, which used to make the repo's own `.git` folder look like a second, bare repository
	test('resolves .git to its working tree when core.bare is unset', async () => {
		git(repo.path, 'config', '--unset', 'core.bare');

		await assertResolvesTo(join(repo.path, '.git'), repo.path);
	});

	test('resolves .git/refs to its working tree when core.bare is unset', async () => {
		git(repo.path, 'config', '--unset', 'core.bare');

		await assertResolvesTo(join(repo.path, '.git', 'refs'), repo.path);
	});

	test('resolves a linked worktree git dir to the main working tree when core.bare is unset', async () => {
		git(repo.path, 'config', '--unset', 'core.bare');
		createBranch(repo.path, 'linked');
		const linked = createWorktree(repo.path, 'linked');
		try {
			await assertResolvesTo(join(repo.path, '.git', 'worktrees', basename(linked.path)), repo.path);
		} finally {
			linked.cleanup();
		}
	});

	test('resolves a bare repository outside any working tree to itself', async () => {
		const parent = mkdtempSync(join(tmpdir(), 'gitlens-test-bare-'));
		try {
			const bare = join(parent, 'bare.git');
			git(parent, 'clone', '-q', '--bare', repo.path, bare);

			await assertResolvesTo(bare, bare);
		} finally {
			rmSync(parent, { recursive: true, force: true });
		}
	});

	test('resolves a bare repository nested inside a working tree to itself', async () => {
		const bare = join(repo.path, 'nested.git');
		git(repo.path, 'clone', '-q', '--bare', repo.path, bare);

		await assertResolvesTo(bare, bare);
	});

	test('resolves a bare clone named .git beside its worktrees to itself', async () => {
		const project = join(repo.path, 'project');
		const bare = join(project, '.git');
		git(repo.path, 'clone', '-q', '--bare', repo.path, bare);
		git(bare, 'worktree', 'add', '-q', join(project, 'main'));

		await assertResolvesTo(bare, bare);
	});

	test('resolves a .bare clone behind a .git file to itself', async () => {
		const project = join(repo.path, 'project');
		const bare = join(project, '.bare');
		git(repo.path, 'clone', '-q', '--bare', repo.path, bare);
		writeFileSync(join(project, '.git'), 'gitdir: ./.bare\n');

		await assertResolvesTo(bare, bare);
	});
});
