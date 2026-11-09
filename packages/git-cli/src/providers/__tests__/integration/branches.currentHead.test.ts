import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createProvider, createTestRepo, createWorktree, supportsReftable } from './helpers.js';

function git(cwd: string, ...args: string[]): string {
	return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

/** What `git status --porcelain=v2 --branch` says HEAD is, as the `getCurrentHead` shape */
function statusHead(cwd: string): { branch: string | undefined; sha: string | undefined } {
	const lines = git(cwd, 'status', '--porcelain=v2', '--branch').split('\n');
	const head = lines.find(l => l.startsWith('# branch.head '))?.substring('# branch.head '.length);
	const oid = lines.find(l => l.startsWith('# branch.oid '))?.substring('# branch.oid '.length);
	return {
		branch: head == null || head === '(detached)' ? undefined : head,
		sha: oid == null || oid === '(initial)' ? undefined : oid,
	};
}

/** A scratch repository with commit config set but no commits, optionally with extra `git init` arguments */
function initEmptyRepo(...initArgs: string[]): { path: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'gitlens-currenthead-'));
	try {
		git(dir, 'init', '-q', ...initArgs);
		git(dir, 'config', 'user.email', 'test@gitlens.test');
		git(dir, 'config', 'user.name', 'Test User');
		git(dir, 'config', 'commit.gpgsign', 'false');
		git(dir, 'config', 'gc.auto', '0');
		git(dir, 'config', 'maintenance.auto', 'false');
	} catch (ex) {
		rmSync(dir, { recursive: true, force: true });
		throw ex;
	}
	return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

suite('BranchesSubProvider.getCurrentHead (real git)', () => {
	const cleanups: (() => void)[] = [];
	const providers: CliGitProvider[] = [];

	function newProvider(): CliGitProvider {
		const provider = createProvider();
		providers.push(provider);
		return provider;
	}

	function newRepo(): TestRepo {
		const repo = createTestRepo();
		cleanups.push(repo.cleanup);
		return repo;
	}

	teardown(() => {
		for (const p of providers.splice(0)) {
			p.dispose();
		}
		for (const c of cleanups.splice(0).reverse()) {
			c();
		}
	});

	test('names the branch and commit HEAD is on', async () => {
		const repo = newRepo();
		addCommit(repo.path, 'a.txt', 'a', 'Second');

		const head = await repo.provider.branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(head, { ...statusHead(repo.path), rebasing: false });
		assert.strictEqual(head.branch, 'main');
	});

	test('leaves the sha out unless asked', async () => {
		const repo = newRepo();

		const head = await repo.provider.branches.getCurrentHead(repo.path);

		assert.deepStrictEqual(head, { branch: 'main', sha: undefined, rebasing: false });
	});

	test('reads a detached HEAD as no branch', async () => {
		const repo = newRepo();
		git(repo.path, 'checkout', '-q', '--detach');

		const head = await repo.provider.branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(head, { ...statusHead(repo.path), rebasing: false });
		assert.strictEqual(head.branch, undefined);
		assert.ok(head.sha);
	});

	/** Starts an interactive rebase of `repoPath`'s whole history that stops to edit its first commit */
	function pauseRebaseAtRoot(repoPath: string): void {
		const dir = mkdtempSync(join(tmpdir(), 'gitlens-currenthead-editor-'));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
		const editor = join(dir, 'mark-edit.cjs');
		writeFileSync(
			editor,
			"const fs=require('fs');const f=process.argv[2];fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/^pick/m,'edit'));",
		);
		execFileSync('git', ['rebase', '-i', '--root'], {
			cwd: repoPath,
			stdio: 'pipe',
			env: { ...process.env, GIT_SEQUENCE_EDITOR: `node "${editor}"` },
		});
	}

	test('names the branch a paused rebase is rebasing', async () => {
		const repo = newRepo();
		addCommit(repo.path, 'a.txt', 'a', 'Second');
		pauseRebaseAtRoot(repo.path);

		const head = await repo.provider.branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(head, { branch: 'main', sha: statusHead(repo.path).sha, rebasing: true });
	});

	test('names no branch for a paused rebase started on a detached HEAD', async () => {
		const repo = newRepo();
		addCommit(repo.path, 'a.txt', 'a', 'Second');
		git(repo.path, 'checkout', '-q', '--detach');
		pauseRebaseAtRoot(repo.path);

		const head = await repo.provider.branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(head, { branch: undefined, sha: statusHead(repo.path).sha, rebasing: true });
	});

	test('reads an unborn branch as a name with no commit', async () => {
		const repo = initEmptyRepo('-b', 'fresh');
		cleanups.push(repo.cleanup);

		const head = await newProvider().branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(head, { branch: 'fresh', sha: undefined, rebasing: false });
	});

	test('reads a linked worktree its own HEAD', async () => {
		const repo = newRepo();
		git(repo.path, 'branch', 'side');
		const wt = createWorktree(repo.path, 'side');
		cleanups.push(wt.cleanup);
		addCommit(wt.path, 'w.txt', 'w', 'On the worktree');

		const inWorktree = await repo.provider.branches.getCurrentHead(wt.path, { sha: true });
		const inMain = await repo.provider.branches.getCurrentHead(repo.path, { sha: true });

		assert.deepStrictEqual(inWorktree, { ...statusHead(wt.path), rebasing: false });
		assert.strictEqual(inWorktree.branch, 'side');
		assert.deepStrictEqual(inMain, { ...statusHead(repo.path), rebasing: false });
		assert.strictEqual(inMain.branch, 'main');
	});

	test('answers right after a switch no watcher reported', async () => {
		const repo = newRepo();
		assert.strictEqual((await repo.provider.branches.getCurrentHead(repo.path)).branch, 'main');
		assert.strictEqual((await repo.provider.branches.getBranch(repo.path))?.name, 'main');

		git(repo.path, 'checkout', '-q', '-b', 'other');

		assert.strictEqual((await repo.provider.branches.getCurrentHead(repo.path)).branch, 'other');
	});

	test('reads a reftable repository through git', async function () {
		if (!supportsReftable()) return this.skip();

		const repo = initEmptyRepo('--ref-format=reftable', '-b', 'main');
		cleanups.push(repo.cleanup);
		addCommit(repo.path, 'a.txt', 'a', 'First');
		const provider = newProvider();

		const head = await provider.branches.getCurrentHead(repo.path, { sha: true });
		assert.deepStrictEqual(head, { ...statusHead(repo.path), rebasing: false });
		assert.strictEqual(head.branch, 'main');

		git(repo.path, 'checkout', '-q', '--detach');
		const detached = await provider.branches.getCurrentHead(repo.path, { sha: true });
		assert.deepStrictEqual(detached, { branch: undefined, sha: statusHead(repo.path).sha, rebasing: false });
	});

	test('reads a HEAD kept as a symlink', async function () {
		const repo = newRepo();
		git(repo.path, 'config', 'core.preferSymlinkRefs', 'true');
		git(repo.path, 'checkout', '-q', '-b', 'linked');
		if (!lstatSync(join(repo.path, '.git', 'HEAD')).isSymbolicLink()) return this.skip();

		const head = await repo.provider.branches.getCurrentHead(repo.path);

		assert.strictEqual(head.branch, 'linked');
	});

	test('rejects when the folder is not a repository', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'gitlens-notrepo-'));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

		await assert.rejects(newProvider().branches.getCurrentHead(dir));
	});
});
