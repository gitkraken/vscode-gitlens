import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

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
});
