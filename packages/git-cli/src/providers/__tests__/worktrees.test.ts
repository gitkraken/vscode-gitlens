import * as assert from 'assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import type { GitResult } from '@gitlens/git/run.types.js';
import type { CliGitProviderInternal } from '../../cliGitProvider.js';
import type { Git } from '../../exec/git.js';
import { WorktreesGitSubProvider } from '../worktrees.js';

function exited(stdout: string): GitResult {
	return { stdout: stdout, stderr: undefined, exitCode: 0, completion: { status: 'exited', code: 0 } };
}

function failed(): GitResult {
	return {
		stdout: '',
		stderr: undefined,
		completion: { status: 'failed', reason: 'unstarted', error: new Error('spawn failed') },
	};
}

suite('WorktreesGitSubProvider.pruneWorktrees', () => {
	const repoPath = '/repo';
	const listing =
		'worktree /repo\nHEAD abc\nbranch refs/heads/main\n\nworktree /wt\nHEAD def\nbranch refs/heads/side\n';

	let run: sinon.SinonStub;
	let unregisterRepoPath: sinon.SinonSpy;
	let provider: WorktreesGitSubProvider;

	setup(() => {
		run = sinon.stub();
		const git = { ensureSupports: () => Promise.resolve(), run: run } as unknown as Git;
		unregisterRepoPath = sinon.spy();
		const cache = { unregisterRepoPath: unregisterRepoPath } as unknown as Cache;
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			git,
			cache,
			{} as unknown as CliGitProviderInternal,
		);
	});

	test('unregisters a worktree the prune removed', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(exited('worktree /repo\nHEAD abc\nbranch refs/heads/main\n'));

		await provider.pruneWorktrees(repoPath);

		sinon.assert.calledOnceWithExactly(unregisterRepoPath, '/wt');
	});

	test('a failed listing after the prune unregisters nothing', async () => {
		run.onCall(0).resolves(exited(listing));
		run.onCall(1).resolves(exited(''));
		run.onCall(2).resolves(failed());

		await provider.pruneWorktrees(repoPath);

		sinon.assert.notCalled(unregisterRepoPath);
	});
});

suite('WorktreesGitSubProvider.getWorktrees lock reason fallback', () => {
	let root: string;
	let provider: WorktreesGitSubProvider;
	let run: sinon.SinonStub;
	let lockReasonListed: boolean;

	setup(() => {
		root = mkdtempSync(join(tmpdir(), 'gitlens-lock-reason-'));
		run = sinon.stub();
		lockReasonListed = false;
		const cache = {
			getWorktrees: (repoPath: string, load: (p: string, c: unknown, s?: AbortSignal) => unknown) =>
				load(repoPath, { invalidate: () => {} }, undefined),
		} as unknown as Cache;
		provider = new WorktreesGitSubProvider(
			{ hooks: {} } as unknown as GitServiceContext,
			{
				ensureSupports: () => Promise.resolve(),
				run: run,
				supports: (feature: string) => feature !== 'git:worktree:list:lock-reason' || lockReasonListed,
			} as unknown as Git,
			cache,
			{ branches: { getBranches: () => Promise.resolve({ values: [] }) } } as unknown as CliGitProviderInternal,
		);
	});

	teardown(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function addLinked(name: string, gitdir: string, reason?: string): string {
		const wt = join(root, name);
		mkdirSync(wt, { recursive: true });
		writeFileSync(join(wt, '.git'), `gitdir: ${gitdir}\n`);
		mkdirSync(join(root, 'admin', name), { recursive: true });
		if (reason != null) {
			writeFileSync(join(root, 'admin', name, 'locked'), reason);
		}
		return wt;
	}

	function listing(...paths: string[]): GitResult {
		return exited(
			`worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n${paths
				.map(p => `worktree ${p}\nHEAD def\ndetached\nlocked\n`)
				.join('\n')}\n`,
		);
	}

	test('fills a bare lock from the admin dir, absolute or relative', async () => {
		const abs = addLinked('abs', join(root, 'admin', 'abs'), 'kepler:task:1\n');
		const rel = addLinked('rel', '../admin/rel', 'in use');
		run.resolves(listing(abs, rel));

		const worktrees = await provider.getWorktrees('/repo');

		assert.strictEqual(worktrees[1].locked, 'kepler:task:1');
		assert.strictEqual(worktrees[2].locked, 'in use');
	});

	test('reads no admin dir when git lists lock reasons itself', async () => {
		lockReasonListed = true;
		const abs = addLinked('abs', join(root, 'admin', 'abs'), 'kepler:task:1\n');
		run.resolves(listing(abs));

		const worktrees = await provider.getWorktrees('/repo');

		assert.strictEqual(worktrees[1].locked, true, 'a bare `locked` from git 2.31+ means no reason');
	});

	test('keeps a bare lock when the admin file is empty or missing', async () => {
		const empty = addLinked('empty', join(root, 'admin', 'empty'), '\n');
		const missing = addLinked('missing', join(root, 'admin', 'missing'));
		run.resolves(listing(empty, missing, join(root, 'nonexistent')));

		const worktrees = await provider.getWorktrees('/repo');

		assert.deepStrictEqual(
			worktrees.slice(1).map(w => w.locked),
			[true, true, true],
		);
	});
});
