import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SigningErrorReason } from '@gitlens/git/errors.js';
import { CommitError, MergeError, SigningError } from '@gitlens/git/errors.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import { addCommit, createBranch, createTestRepo } from './helpers.js';

suite('OperationsGitSubProvider.merge', () => {
	test('returns { conflicted: false } on clean fast-forward merge', async () => {
		const r = createTestRepo();
		try {
			createBranch(r.path, 'feature', { checkout: true });
			addCommit(r.path, 'feature.txt', 'feature content\n', 'Add feature');
			execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });

			const result = await r.provider.ops?.merge(r.path, 'feature');
			assert.ok(result, 'Expected a result');
			assert.strictEqual(result.conflicted, false);
			assert.strictEqual(result.conflicts, undefined);
		} finally {
			r.cleanup();
		}
	});

	test('returns { conflicted: true, conflicts } when merge has conflicts', async () => {
		const r = createTestRepo();
		try {
			// Modify README.md (present in the ancestor) on both branches to force a
			// content/content conflict that matches the library's conflict regex.
			createBranch(r.path, 'feature');
			addCommit(r.path, 'README.md', '# Test Repository\nmain edit\n', 'Main edit README');

			execFileSync('git', ['checkout', 'feature'], { cwd: r.path, stdio: 'pipe' });
			addCommit(r.path, 'README.md', '# Test Repository\nfeature edit\n', 'Feature edit README');

			execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });

			// Pass fastForward: false so git attempts a merge commit (default may refuse diverging merges)
			const result = await r.provider.ops?.merge(r.path, 'feature', { fastForward: false });
			assert.ok(result, 'Expected a result (not a thrown error)');
			assert.strictEqual(result.conflicted, true);
			assert.ok(result.conflicts, 'Expected conflicts list');
			assert.ok(result.conflicts.length > 0, 'Expected at least one conflict');
			assert.ok(
				result.conflicts.some(c => c.path === 'README.md'),
				`Expected 'README.md' in conflicts, got ${result.conflicts.map(c => c.path).join(', ')}`,
			);

			// Clean up merge state
			execFileSync('git', ['merge', '--abort'], { cwd: r.path, stdio: 'pipe' });
		} finally {
			r.cleanup();
		}
	});

	test('throws MergeError on uncommitted changes (non-conflict failure)', async () => {
		const r = createTestRepo();
		try {
			createBranch(r.path, 'feature', { checkout: true });
			addCommit(r.path, 'feature.txt', 'feature content\n', 'Add feature');
			execFileSync('git', ['checkout', 'main'], { cwd: r.path, stdio: 'pipe' });

			// Uncommitted change to a file that the merge would touch
			writeFileSync(join(r.path, 'feature.txt'), 'uncommitted local change\n');

			await assert.rejects(
				() => r.provider.ops.merge(r.path, 'feature'),
				ex => MergeError.is(ex),
				'Expected a MergeError to be thrown for non-conflict failures',
			);
		} finally {
			r.cleanup();
		}
	});
});

suite('OperationsGitSubProvider.commit', () => {
	test('commits staged changes with the given message', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'new.txt'), 'hello\n');
			execFileSync('git', ['add', 'new.txt'], { cwd: r.path, stdio: 'pipe' });

			await r.provider.ops.commit(r.path, 'Add new.txt');

			const log = execFileSync('git', ['log', '-1', '--format=%s'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(log, 'Add new.txt');
		} finally {
			r.cleanup();
		}
	});

	test('throws CommitError with reason "nothingToCommit" on clean working tree', async () => {
		const r = createTestRepo();
		try {
			await assert.rejects(
				() => r.provider.ops.commit(r.path, 'empty commit'),
				ex => CommitError.is(ex, 'nothingToCommit'),
				'Expected CommitError with reason nothingToCommit',
			);
		} finally {
			r.cleanup();
		}
	});

	test('allowEmpty permits committing with no staged changes', async () => {
		const r = createTestRepo();
		try {
			await r.provider.ops.commit(r.path, 'empty', { allowEmpty: true });

			const log = execFileSync('git', ['log', '-1', '--format=%s'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(log, 'empty');
		} finally {
			r.cleanup();
		}
	});

	test('author option sets commit author', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'authored.txt'), 'content\n');
			execFileSync('git', ['add', 'authored.txt'], { cwd: r.path, stdio: 'pipe' });

			await r.provider.ops.commit(r.path, 'Authored by someone else', {
				author: 'Someone Else <someone@else.test>',
			});

			const author = execFileSync('git', ['log', '-1', '--format=%an <%ae>'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(author, 'Someone Else <someone@else.test>');
		} finally {
			r.cleanup();
		}
	});

	test('all option stages modified tracked files', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'README.md'), '# modified\n');

			await r.provider.ops.commit(r.path, 'edit README', { all: true });

			const status = execFileSync('git', ['status', '--porcelain'], {
				cwd: r.path,
				encoding: 'utf-8',
			});
			assert.strictEqual(status, '', 'Working tree should be clean after `all: true` commit');
		} finally {
			r.cleanup();
		}
	});

	test('amend option rewrites the last commit', async () => {
		const r = createTestRepo();
		try {
			writeFileSync(join(r.path, 'fixup.txt'), 'a\n');
			execFileSync('git', ['add', 'fixup.txt'], { cwd: r.path, stdio: 'pipe' });
			await r.provider.ops.commit(r.path, 'original');

			writeFileSync(join(r.path, 'fixup.txt'), 'b\n');
			execFileSync('git', ['add', 'fixup.txt'], { cwd: r.path, stdio: 'pipe' });
			await r.provider.ops.commit(r.path, 'amended', { amend: true });

			const log = execFileSync('git', ['log', '--format=%s'], {
				cwd: r.path,
				encoding: 'utf-8',
			})
				.trim()
				.split('\n');
			assert.strictEqual(log[0], 'amended');
			// The original commit was amended, not appended — check that only one commit exists after initial
			assert.strictEqual(log.length, 2, 'Expected 2 commits total (initial + amended)');
		} finally {
			r.cleanup();
		}
	});
});

suite('OperationsGitSubProvider signing', () => {
	test('commit throws SigningError and fires onSigningFailed when gpg program fails', async () => {
		const calls: Array<{ reason: SigningErrorReason; format: SigningFormat; source: unknown }> = [];
		const r = createTestRepo({
			hooks: {
				commits: {
					onSigningFailed: (reason, format, source) =>
						calls.push({ reason: reason, format: format, source: source }),
				},
			},
		});
		try {
			execFileSync('git', ['config', 'commit.gpgsign', 'true'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['config', 'gpg.format', 'openpgp'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['config', 'gpg.program', 'node --eval process.exit(1)'], {
				cwd: r.path,
				stdio: 'pipe',
			});

			writeFileSync(join(r.path, 'signed.txt'), 'content\n');
			execFileSync('git', ['add', 'signed.txt'], { cwd: r.path, stdio: 'pipe' });

			const sentinel = { caller: 'test-sentinel' };
			await assert.rejects(
				() => r.provider.ops.commit(r.path, 'should fail to sign', { source: sentinel }),
				ex =>
					SigningError.is(ex) &&
					// Any real signing reason is acceptable — different git versions emit different stderr.
					['passphraseFailed', 'noKey', 'gpgNotFound'].includes(ex.details.reason ?? 'unknown'),
				'Expected a SigningError (not CommitError) when gpg sign fails',
			);

			assert.strictEqual(calls.length, 1, 'Expected onSigningFailed hook to fire exactly once');
			assert.ok(
				['passphraseFailed', 'noKey', 'gpgNotFound'].includes(calls[0].reason),
				`Unexpected hook reason: ${calls[0].reason}`,
			);
			// getSigningConfig reads gpg.format from the repo config we set above.
			assert.strictEqual(calls[0].format, 'openpgp');
			assert.strictEqual(calls[0].source, sentinel, 'Expected `source` to be threaded to the hook');
		} finally {
			r.cleanup();
		}
	});

	test('non-signing commit failures still throw CommitError (baseline)', async () => {
		const calls: unknown[] = [];
		const r = createTestRepo({
			hooks: {
				commits: {
					onSigningFailed: (...args) => calls.push(args),
				},
			},
		});
		try {
			// No signing configured; a clean-tree commit should yield CommitError('nothingToCommit'),
			// not SigningError, and the hook must not fire.
			await assert.rejects(
				() => r.provider.ops.commit(r.path, 'empty commit'),
				ex => CommitError.is(ex, 'nothingToCommit'),
				'Expected CommitError with reason nothingToCommit',
			);
			assert.strictEqual(calls.length, 0, 'onSigningFailed must not fire for non-signing failures');
		} finally {
			r.cleanup();
		}
	});
});
