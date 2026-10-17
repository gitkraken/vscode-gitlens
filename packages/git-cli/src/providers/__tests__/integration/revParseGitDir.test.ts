import * as assert from 'assert';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Git, GitError } from '../../../exec/git.js';
import { findGitPath } from '../../../exec/locator.js';
import { createTestRepo } from './helpers.js';

suite('Git.rev_parse__git_dir (real git)', () => {
	const git = new Git(() => findGitPath(null));

	test('resolves undefined outside a repository', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'gitlens-notrepo-'));
		try {
			// Stop git from discovering a repository in a parent of the temp dir
			const prev = process.env.GIT_CEILING_DIRECTORIES;
			process.env.GIT_CEILING_DIRECTORIES = tmpdir();
			try {
				assert.strictEqual(await git.rev_parse__git_dir(dir), undefined);
			} finally {
				if (prev === undefined) {
					delete process.env.GIT_CEILING_DIRECTORIES;
				} else {
					process.env.GIT_CEILING_DIRECTORIES = prev;
				}
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('resolves undefined for a directory that does not exist', async () => {
		const repo = createTestRepo();
		const missing = join(repo.path, 'deleted');
		try {
			mkdirSync(missing);
			rmSync(missing, { recursive: true });
			assert.strictEqual(await git.rev_parse__git_dir(missing), undefined);
		} finally {
			repo.cleanup();
		}
	});

	test('resolves the git dir of a repository', async () => {
		const repo = createTestRepo();
		try {
			const result = await git.rev_parse__git_dir(repo.path);
			assert.ok(result?.path.endsWith('/.git'), `unexpected path: ${result?.path}`);
		} finally {
			repo.cleanup();
		}
	});

	test('rejects when git cannot read the directory', async function () {
		if (process.platform === 'win32' || process.getuid?.() === 0) return this.skip();

		const repo = createTestRepo();
		const locked = join(repo.path, 'locked');
		try {
			mkdirSync(locked);
			chmodSync(locked, 0o000);
			await assert.rejects(git.rev_parse__git_dir(locked), (ex: unknown) => ex instanceof GitError);
		} finally {
			chmodSync(locked, 0o755);
			repo.cleanup();
		}
	});
});
