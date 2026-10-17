import * as assert from 'assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunError } from '../exec.errors.js';
import type { GitResult } from '../exec.types.js';
import { Git, GitError, GitErrors } from '../git.js';

function makeGitError(stderr: string): GitError {
	return new GitError(new RunError({ message: stderr, cmd: 'git', code: 128 }, '', stderr));
}

/** A `Git` whose `run` is replaced, so the failure shapes git can't be coaxed into producing are exercised. */
function makeGit(run: () => Promise<GitResult>): Git {
	const git = new Git(() => Promise.reject(new Error('locator should not be called')));
	(git as unknown as { run: unknown }).run = run;
	return git;
}

suite('Git.rev_parse__git_dir Test Suite', () => {
	test('resolves undefined when git reports the path is not a repository', async () => {
		const git = makeGit(() =>
			Promise.reject(makeGitError('fatal: not a git repository (or any of the parent directories): .git')),
		);
		assert.strictEqual(await git.rev_parse__git_dir('/some/dir'), undefined);
	});

	test('rejects with the GitError, stderr intact, on dubious ownership', async () => {
		const stderr =
			"fatal: detected dubious ownership in repository at '/some/dir'\nTo add an exception for this directory, call:\n\n\tgit config --global --add safe.directory /some/dir";
		const git = makeGit(() => Promise.reject(makeGitError(stderr)));

		await assert.rejects(git.rev_parse__git_dir(tmpdir()), (ex: unknown) => {
			assert.ok(ex instanceof GitError);
			assert.strictEqual(ex.stderr, stderr);
			assert.ok(GitErrors.unsafeRepository.test(ex.stderr ?? ''));
			return true;
		});
	});

	test('resolves undefined when the run fails and the directory does not exist', async () => {
		const git = makeGit(() => Promise.reject(new Error('spawn git ENOENT')));
		assert.strictEqual(
			await git.rev_parse__git_dir(join(tmpdir(), 'gitlens-missing-dir-does-not-exist')),
			undefined,
		);
	});

	test('rejects with non-git errors unchanged', async () => {
		const error = new Error('boom');
		const git = makeGit(() => Promise.reject(error));

		await assert.rejects(git.rev_parse__git_dir(tmpdir()), (ex: unknown) => ex === error);
	});

	test('resolves the git dir from stdout', async () => {
		const git = makeGit(() => Promise.resolve({ stdout: '/repo/.git\n/repo/.git\n' } as GitResult));
		const result = await git.rev_parse__git_dir('/repo');
		assert.strictEqual(result?.path, '/repo/.git');
		assert.strictEqual(result.commonPath, undefined);
	});
});
