import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestRepo } from './helpers.js';

suite('OperationsGitSubProvider.commit with a hook that prints an index.lock failure', () => {
	test('runs the commit, and so the hook, only once', async () => {
		const r = createTestRepo();
		try {
			const runs = join(r.path, 'hook-runs');
			const hooks = join(r.path, '.git', 'hooks');
			mkdirSync(hooks, { recursive: true });
			// A global `core.hooksPath` would otherwise keep the hook from running, and the commit would succeed
			execFileSync('git', ['config', 'core.hooksPath', hooks], { cwd: r.path, stdio: 'pipe' });
			const hook = join(hooks, 'pre-commit');
			writeFileSync(
				hook,
				`#!/bin/sh\necho run >> "${runs}"\necho "fatal: Unable to create '${r.path}/.git/index.lock': File exists." >&2\nexit 1\n`,
			);
			chmodSync(hook, 0o755);
			writeFileSync(join(r.path, 'new.txt'), 'hello\n');
			execFileSync('git', ['add', 'new.txt'], { cwd: r.path, stdio: 'pipe' });

			await assert.rejects(() => r.provider.ops.commit(r.path, 'Add new.txt'));

			assert.strictEqual(readFileSync(runs, 'utf-8'), 'run\n');
		} finally {
			r.cleanup();
		}
	});
});
