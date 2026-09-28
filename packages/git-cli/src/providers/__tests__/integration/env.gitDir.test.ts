import * as assert from 'assert';
import { join } from 'node:path';
import { CliGitProvider } from '../../../cliGitProvider.js';
import { findGitPath } from '../../../exec/locator.js';
import type { TestRepo } from './helpers.js';
import { createBranch, createTestRepo } from './helpers.js';

/**
 * A host launched BY git — a hook, `rebase -x`, an editor invoked as `GIT_EDITOR` — inherits that git
 * process's `GIT_DIR` in `process.env`. If our base environment spread `process.env` wholesale, every
 * command we run would silently operate against THAT repository instead of the `cwd` we pass, no matter
 * which repoPath the caller asked for.
 */
suite('Git base env does not inherit a repository location', () => {
	let decoy: TestRepo;
	let target: TestRepo;

	setup(() => {
		decoy = createTestRepo();
		createBranch(decoy.path, 'decoy', { checkout: true });

		target = createTestRepo();
	});

	teardown(() => {
		decoy.cleanup();
		target.cleanup();
	});

	test('getBranch resolves the requested repoPath, not an inherited GIT_DIR', async () => {
		const originalGitDir = process.env.GIT_DIR;
		process.env.GIT_DIR = join(decoy.path, '.git');

		let provider: CliGitProvider | undefined;
		try {
			// Constructed AFTER polluting process.env — the base env is cached on first use, so an
			// already-running provider wouldn't exercise this at all.
			provider = new CliGitProvider({
				context: target.provider.context,
				locator: () => findGitPath(null),
				gitOptions: { gitTimeout: 30000 },
			});

			const branch = await provider.branches.getBranch(target.path);
			assert.strictEqual(branch?.name, 'main', 'should resolve the TARGET repo, not the decoy');
		} finally {
			if (originalGitDir === undefined) {
				delete process.env.GIT_DIR;
			} else {
				process.env.GIT_DIR = originalGitDir;
			}
			provider?.dispose();
		}
	});
});
