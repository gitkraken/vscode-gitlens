import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo } from './helpers.js';

suite('GraphSubProvider with a remote whose own name contains a slash', () => {
	let local: TestRepo;
	let remote: TestRepo;

	suiteSetup(() => {
		remote = createTestRepo();
		local = createTestRepo();
		execFileSync('git', ['remote', 'add', 'team/fork', remote.path], { cwd: local.path, stdio: 'pipe' });
		execFileSync('git', ['fetch', 'team/fork'], { cwd: local.path, stdio: 'pipe' });
	});

	suiteTeardown(() => {
		local.cleanup();
		remote.cleanup();
	});

	test('a remote tip is owned by that remote, not by its first segment', async () => {
		const graph = await local.provider.graph.getGraph(local.path, undefined);

		const remoteHeads = graph.rows.flatMap(row => row.remotes ?? []);
		const main = remoteHeads.find(r => r.name === 'main');
		assert.ok(main != null, `Expected a remote head named main in ${JSON.stringify(remoteHeads)}`);
		assert.strictEqual(main.owner, 'team/fork');
	});

	test('a local branch named under a slash remote stays a local head', async () => {
		const repo = createTestRepo();
		try {
			execFileSync('git', ['remote', 'add', 'team/fork', remote.path], { cwd: repo.path, stdio: 'pipe' });
			execFileSync('git', ['fetch', 'team/fork'], { cwd: repo.path, stdio: 'pipe' });
			createBranch(repo.path, 'team/fork/work', { checkout: true });

			const graph = await repo.provider.graph.getGraph(repo.path, undefined);

			const row = graph.rows.find(r => r.heads?.some(h => h.name === 'team/fork/work'));
			assert.ok(row != null, 'Expected a row with a team/fork/work head');
			assert.strictEqual(row.heads!.find(h => h.name === 'team/fork/work')!.isCurrentHead, true);
			assert.ok(!row.remotes?.some(r => r.name === 'work'), 'Expected no remote head for the local branch');
		} finally {
			repo.cleanup();
		}
	});

	test('a local branch and a remote-tracking ref of the same name on the same commit stay distinct', async () => {
		const upstream = createTestRepo();
		const repo = createTestRepo();
		try {
			createBranch(upstream.path, 'work');
			execFileSync('git', ['remote', 'add', 'team/fork', upstream.path], { cwd: repo.path, stdio: 'pipe' });
			execFileSync('git', ['fetch', 'team/fork'], { cwd: repo.path, stdio: 'pipe' });
			// Same short name as `refs/remotes/team/fork/work`, on the same commit
			execFileSync('git', ['checkout', '-b', 'team/fork/work', 'refs/remotes/team/fork/work'], {
				cwd: repo.path,
				stdio: 'pipe',
			});

			const graph = await repo.provider.graph.getGraph(repo.path, undefined);

			const row = graph.rows.find(r => r.heads?.some(h => h.name === 'team/fork/work'));
			assert.ok(row != null, 'Expected a row with a team/fork/work head');
			const local = row.heads!.find(h => h.name === 'team/fork/work')!;
			assert.strictEqual(local.isCurrentHead, true);
			assert.strictEqual(local.id, `${repo.path}|heads/team/fork/work`);
			assert.ok(local.worktree != null, 'Expected the checked-out local head to carry its worktree');
			assert.strictEqual(local.worktree.isDefault, true);

			const remoteHead = row.remotes?.find(r => r.name === 'work');
			assert.ok(remoteHead != null, `Expected a remote head named work in ${JSON.stringify(row.remotes)}`);
			assert.strictEqual(remoteHead.owner, 'team/fork');
			assert.strictEqual(remoteHead.id, `${repo.path}|remotes/team/fork/work`);
		} finally {
			repo.cleanup();
			upstream.cleanup();
		}
	});

	test('a local branch named like a remote-tracking ref stays local beside that ref', async () => {
		const upstream = createTestRepo();
		const repo = createTestRepo();
		try {
			createBranch(upstream.path, 'x');
			execFileSync('git', ['remote', 'add', 'origin', upstream.path], { cwd: repo.path, stdio: 'pipe' });
			execFileSync('git', ['fetch', 'origin'], { cwd: repo.path, stdio: 'pipe' });
			execFileSync('git', ['branch', 'origin/x', 'refs/remotes/origin/x'], { cwd: repo.path, stdio: 'pipe' });

			const graph = await repo.provider.graph.getGraph(repo.path, undefined);

			const heads = graph.rows.flatMap(r => r.heads ?? []).filter(h => h.name === 'origin/x');
			assert.strictEqual(heads.length, 1, `Expected one origin/x local head in ${JSON.stringify(heads)}`);
			assert.strictEqual(heads[0].id, `${repo.path}|heads/origin/x`);

			const remotes = graph.rows.flatMap(r => r.remotes ?? []).filter(r => r.name === 'x');
			assert.strictEqual(remotes.length, 1, `Expected one remote head x in ${JSON.stringify(remotes)}`);
			assert.strictEqual(remotes[0].owner, 'origin');
			assert.strictEqual(remotes[0].id, `${repo.path}|remotes/origin/x`);
		} finally {
			repo.cleanup();
			upstream.cleanup();
		}
	});

	test('a tip of a remote named `remotes` is a remote head, not a local head', async () => {
		const repo = createTestRepo();
		try {
			execFileSync('git', ['remote', 'add', 'remotes', remote.path], { cwd: repo.path, stdio: 'pipe' });
			execFileSync('git', ['fetch', 'remotes'], { cwd: repo.path, stdio: 'pipe' });

			const graph = await repo.provider.graph.getGraph(repo.path, undefined);

			const remotes = graph.rows.flatMap(r => r.remotes ?? []).filter(r => r.owner === 'remotes');
			assert.strictEqual(remotes.length, 1, `Expected one remote head of remotes in ${JSON.stringify(remotes)}`);
			assert.strictEqual(remotes[0].name, 'main');
			assert.ok(
				!graph.rows.some(r => r.heads?.some(h => h.name === 'remotes/main')),
				'Expected no local head for the remote-tracking ref',
			);
		} finally {
			repo.cleanup();
		}
	});

	test('a head tracking a local branch links to that local branch', async () => {
		const repo = createTestRepo();
		try {
			execFileSync('git', ['branch', '--track', 'feature', 'main'], { cwd: repo.path, stdio: 'pipe' });

			const graph = await repo.provider.graph.getGraph(repo.path, undefined);

			const heads = graph.rows.flatMap(r => r.heads ?? []);
			const main = heads.find(h => h.name === 'main');
			const feature = heads.find(h => h.name === 'feature');
			assert.ok(main != null && feature != null, `Expected main and feature heads in ${JSON.stringify(heads)}`);
			assert.strictEqual(feature.upstream?.name, 'main');
			assert.strictEqual(feature.upstream.id, main.id);
		} finally {
			repo.cleanup();
		}
	});
});
