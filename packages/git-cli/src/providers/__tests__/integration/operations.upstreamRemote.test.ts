import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PushError } from '@gitlens/git/errors.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { TestRepo } from './helpers.js';
import { addCommit, checkout, createBranch, createTestRepo, getHeadSha, getRefTips, revParse } from './helpers.js';

function git(cwd: string, ...args: string[]): void {
	execFileSync('git', args, { cwd: cwd, stdio: 'pipe' });
}

function createBare(): { path: string; cleanup: () => void } {
	const path = mkdtempSync(join(tmpdir(), 'gitlens-test-bare-'));
	git(path, 'init', '--bare', '-b', 'main');
	return { path: path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}

suite('OperationsGitSubProvider.push — an upstream whose remote is not what its name suggests', () => {
	let local: TestRepo;
	const bares: { cleanup: () => void }[] = [];

	function bare(): { path: string; cleanup: () => void } {
		const b = createBare();
		bares.push(b);
		return b;
	}

	setup(() => {
		local = createTestRepo();
	});

	teardown(() => {
		local.cleanup();
		for (const b of bares.splice(0)) {
			b.cleanup();
		}
	});

	test("the cold current-branch read keeps a local upstream apart from a remote of the upstream's first segment", async () => {
		const release = bare();
		git(local.path, 'remote', 'add', 'release', release.path);
		git(local.path, 'push', 'release', 'main');

		createBranch(local.path, 'release/2.0');
		createBranch(local.path, 'feature', { checkout: true });
		git(local.path, 'branch', '--set-upstream-to=release/2.0', 'feature');
		addCommit(local.path, 'f.txt', 'f', 'Feature commit');
		const before = getRefTips(release.path);

		// A fresh provider has nothing cached, so this is the `rev-parse` read, not the branch list
		const reference = await local.provider.branches.getCurrentBranchReference(local.path);
		assert.strictEqual(reference?.name, 'feature');
		assert.strictEqual(reference.upstream?.name, 'release/2.0');
		assert.strictEqual(reference.upstream.local, true);
		assert.strictEqual(reference.upstream.remote, undefined);

		await assert.rejects(
			local.provider.ops.push(local.path, { reference: reference, force: true }),
			(ex: unknown) => PushError.is(ex, 'noUpstream'),
		);
		assert.deepStrictEqual(getRefTips(release.path), before);
	});

	test('the cold current-branch read carries the remote of an upstream a custom refspec fetches into refs/heads/', async () => {
		const origin = bare();
		git(local.path, 'remote', 'add', 'origin', origin.path);
		git(local.path, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/fetched/*');
		createBranch(local.path, 'x', { checkout: true });
		git(local.path, 'push', 'origin', 'x');
		git(local.path, 'fetch', 'origin');
		git(local.path, 'config', 'branch.x.remote', 'origin');
		git(local.path, 'config', 'branch.x.merge', 'refs/heads/x');

		const reference = await local.provider.branches.getCurrentBranchReference(local.path);
		assert.strictEqual(reference?.name, 'x');
		assert.strictEqual(reference.upstream?.remote, 'origin');
		assert.strictEqual(reference.upstream.remoteBranch, 'x');
		assert.strictEqual('local' in reference.upstream, false);
	});

	test('a held reference to a branch whose remote was removed no longer pushes to a same-named path', async () => {
		const origin = bare();
		git(local.path, 'remote', 'add', 'origin', origin.path);
		createBranch(local.path, 'feature', { checkout: true });
		git(local.path, 'push', '-u', 'origin', 'feature');
		addCommit(local.path, 'f.txt', 'f', 'Feature commit');

		const held = await local.provider.branches.getBranch(local.path, 'feature');
		assert.strictEqual(held?.upstream?.remote, 'origin');

		git(local.path, 'remote', 'remove', 'origin');
		// `origin` is now a path relative to the work tree, which git accepts as a destination
		git(local.path, 'init', '--bare', 'origin');
		const pathRepo = join(local.path, 'origin');

		await assert.rejects(local.provider.ops.push(local.path, { reference: held, force: true }), (ex: unknown) =>
			PushError.is(ex, 'noUpstream'),
		);
		assert.deepStrictEqual(getRefTips(pathRepo), new Map());
	});

	test('an upstream a custom refspec fetches into refs/heads/ keeps its remote, so a push lands on that remote', async () => {
		const origin = bare();
		git(local.path, 'remote', 'add', 'origin', origin.path);
		git(local.path, 'config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/fetched/*');
		createBranch(local.path, 'x', { checkout: true });
		git(local.path, 'push', 'origin', 'x');
		git(local.path, 'fetch', 'origin');
		git(local.path, 'branch', '--set-upstream-to=fetched/x', 'x');
		assert.strictEqual(
			execFileSync('git', ['config', 'branch.x.remote'], { cwd: local.path, encoding: 'utf-8' }).trim(),
			'origin',
		);

		addCommit(local.path, 'x.txt', 'x', 'X commit');
		const sha = getHeadSha(local.path);

		const branch = await local.provider.branches.getBranch(local.path, 'x');
		assert.strictEqual(branch?.upstream?.name, 'fetched/x');
		assert.strictEqual(branch.upstream.remote, 'origin');
		assert.strictEqual(branch.upstream.remoteBranch, 'x');
		assert.strictEqual('local' in branch.upstream, false);

		checkout(local.path, 'main');
		await local.provider.ops.push(local.path, { reference: branch, force: true });
		assert.strictEqual(revParse(origin.path, 'refs/heads/x'), sha);
	});

	test('a hand-built reference to a branch tracking a local branch is looked up, so a push does not go to a remote named for its first segment', async () => {
		const release = bare();
		git(local.path, 'remote', 'add', 'release', release.path);
		git(local.path, 'push', 'release', 'main');

		createBranch(local.path, 'release/2.0');
		createBranch(local.path, 'feature', { checkout: true });
		git(local.path, 'branch', '--set-upstream-to=release/2.0', 'feature');
		addCommit(local.path, 'f.txt', 'f', 'Feature commit');
		const before = getRefTips(release.path);

		const reference = createReference('feature', local.path, {
			refType: 'branch',
			name: 'feature',
			remote: false,
			upstream: { name: 'release/2.0', missing: false },
		});

		await assert.rejects(
			local.provider.ops.push(local.path, { reference: reference, force: true }),
			(ex: unknown) => PushError.is(ex, 'noUpstream'),
		);
		assert.deepStrictEqual(getRefTips(release.path), before);
	});

	test('a hand-built reference to a branch tracking a remote still pushes to that remote', async () => {
		const origin = bare();
		git(local.path, 'remote', 'add', 'origin', origin.path);
		createBranch(local.path, 'feature', { checkout: true });
		git(local.path, 'push', '-u', 'origin', 'feature');
		addCommit(local.path, 'f.txt', 'f', 'Feature commit');
		const sha = getHeadSha(local.path);

		const reference = createReference('feature', local.path, {
			refType: 'branch',
			name: 'feature',
			remote: false,
			upstream: { name: 'origin/feature', missing: false },
		});

		checkout(local.path, 'main');
		await local.provider.ops.push(local.path, { reference: reference, force: true });
		assert.strictEqual(revParse(origin.path, 'refs/heads/feature'), sha);
	});
});
