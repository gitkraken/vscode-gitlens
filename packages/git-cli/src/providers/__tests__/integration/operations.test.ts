import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SigningErrorReason } from '@gitlens/git/errors.js';
import { CommitError, FetchError, MergeError, PullError, SigningError } from '@gitlens/git/errors.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import {
	addCommit,
	checkout,
	cloneTestRepo,
	createBranch,
	createTestRepo,
	createTrackingBranch,
	createWorktree,
	getHeadSha,
	revParse,
} from './helpers.js';

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

	test('host signing override adds -S even when commit.gpgsign is false', async () => {
		const failedCalls: Array<{ reason: SigningErrorReason; format: SigningFormat }> = [];
		const signedCalls: unknown[] = [];
		const r = createTestRepo({
			config: { commits: {}, signing: { enabled: true } },
			hooks: {
				commits: {
					onSigned: (...args) => signedCalls.push(args),
					onSigningFailed: (reason, format) => failedCalls.push({ reason: reason, format: format }),
				},
			},
		});
		try {
			// The helper leaves `commit.gpgsign=false` — without an explicit `-S` from the host
			// override, git would never invoke the (broken) gpg program and the commit would
			// succeed. A SigningError here is the proof that `-S` was passed.
			execFileSync('git', ['config', 'gpg.format', 'openpgp'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['config', 'gpg.program', 'node --eval process.exit(1)'], {
				cwd: r.path,
				stdio: 'pipe',
			});

			writeFileSync(join(r.path, 'override.txt'), 'content\n');
			execFileSync('git', ['add', 'override.txt'], { cwd: r.path, stdio: 'pipe' });

			await assert.rejects(
				() => r.provider.ops.commit(r.path, 'should attempt to sign via override'),
				ex => SigningError.is(ex),
				'Expected a SigningError — the override should force `-S` despite commit.gpgsign=false',
			);

			assert.strictEqual(failedCalls.length, 1, 'Expected onSigningFailed hook to fire exactly once');
			assert.strictEqual(failedCalls[0].format, 'openpgp');
			assert.strictEqual(signedCalls.length, 0, 'onSigned must not fire when signing fails');
		} finally {
			r.cleanup();
		}
	});

	test('without the host override, broken signer config does not affect commits', async () => {
		const calls: unknown[] = [];
		const r = createTestRepo({
			config: { commits: {}, signing: { enabled: false } },
			hooks: {
				commits: {
					onSigned: (...args) => calls.push(args),
					onSigningFailed: (...args) => calls.push(args),
				},
			},
		});
		try {
			// Same broken gpg program as above, but no override and `commit.gpgsign=false` —
			// the commit must go through without ever invoking the signer.
			execFileSync('git', ['config', 'gpg.program', 'node --eval process.exit(1)'], {
				cwd: r.path,
				stdio: 'pipe',
			});

			writeFileSync(join(r.path, 'plain.txt'), 'content\n');
			execFileSync('git', ['add', 'plain.txt'], { cwd: r.path, stdio: 'pipe' });

			await r.provider.ops.commit(r.path, 'unsigned commit');

			const log = execFileSync('git', ['log', '-1', '--format=%s'], {
				cwd: r.path,
				encoding: 'utf-8',
			}).trim();
			assert.strictEqual(log, 'unsigned commit');
			assert.strictEqual(calls.length, 0, 'No signing hooks should fire for an unsigned commit');
		} finally {
			r.cleanup();
		}
	});
});

suite('OperationsGitSubProvider.push', () => {
	function createRepoWithRemote() {
		const r = createTestRepo();
		const bareDir = mkdtempSync(join(tmpdir(), 'gitlens-test-bare-'));
		execFileSync('git', ['clone', '--bare', r.path, bareDir], { stdio: 'pipe' });
		execFileSync('git', ['remote', 'add', 'origin', bareDir], { cwd: r.path, stdio: 'pipe' });
		execFileSync('git', ['fetch', 'origin'], { cwd: r.path, stdio: 'pipe' });
		execFileSync('git', ['branch', '--set-upstream-to', 'origin/main', 'main'], { cwd: r.path, stdio: 'pipe' });
		const origCleanup = r.cleanup;
		return {
			...r,
			cleanup: () => {
				origCleanup();
				rmSync(bareDir, { recursive: true, force: true });
			},
		};
	}

	function getRemoteRef(repoPath: string, ref: string): string {
		const output = execFileSync('git', ['ls-remote', 'origin', ref], {
			cwd: repoPath,
			encoding: 'utf-8',
		}).trim();
		return output.split('\t')[0] ?? '';
	}

	test('pushes to matching upstream branch', async () => {
		const r = createRepoWithRemote();
		try {
			addCommit(r.path, 'file.txt', 'content\n', 'Add file');
			const localSha = getHeadSha(r.path);

			await r.provider.ops?.push(r.path);

			const remoteSha = getRemoteRef(r.path, 'refs/heads/main');
			assert.strictEqual(remoteSha, localSha, 'Remote main should match local HEAD after push');
		} finally {
			r.cleanup();
		}
	});

	test('pushes to differently-named upstream branch using refspec', async () => {
		const r = createRepoWithRemote();
		try {
			execFileSync('git', ['checkout', '-b', 'feature/foo'], { cwd: r.path, stdio: 'pipe' });
			execFileSync('git', ['branch', '--set-upstream-to', 'origin/main', 'feature/foo'], {
				cwd: r.path,
				stdio: 'pipe',
			});
			addCommit(r.path, 'feature.txt', 'feature\n', 'Add feature');
			const localSha = getHeadSha(r.path);

			await r.provider.ops?.push(r.path);

			// Should have pushed to origin/main, not created origin/feature/foo
			const remoteSha = getRemoteRef(r.path, 'refs/heads/main');
			assert.strictEqual(remoteSha, localSha, 'Remote main should have the feature commit');

			// Verify no remote branch was created for feature/foo
			const featureRef = getRemoteRef(r.path, 'refs/heads/feature/foo');
			assert.strictEqual(featureRef, '', 'Remote should not have feature/foo branch');
		} finally {
			r.cleanup();
		}
	});
});

suite('OperationsSubProvider — branch-creating checkout', () => {
	test('checkout -b leaves a predecessor’s metadata alone', async () => {
		const repo = createTestRepo();
		try {
			// Simulates a branch deleted outside GitLens: its persisted base is still on disk under that
			// name. Like `createBranch`, creation never removes persisted metadata — see the note there.
			await repo.provider.config.setGkConfig(repo.path, 'branch.via-checkout.gk-merge-base', 'origin/DEAD');

			await repo.provider.ops.checkout(repo.path, 'main', { createBranch: 'via-checkout' });

			assert.strictEqual(
				await repo.provider.config.getGkConfig(repo.path, 'branch.via-checkout.gk-merge-base'),
				'origin/DEAD',
				'creation must not touch persisted metadata',
			);
		} finally {
			repo.cleanup();
		}
	});
});

suite('OperationsGitSubProvider.pull — fastForward', () => {
	test('fast-forwards a clone that is a strict ancestor of its origin', async () => {
		const origin = createTestRepo();
		const clone = cloneTestRepo(origin.path);
		try {
			addCommit(origin.path, 'advance.txt', 'x', 'origin advances');

			await clone.provider.ops.pull(clone.path, { fastForward: 'only' });

			assert.strictEqual(getHeadSha(clone.path), getHeadSha(origin.path), 'the clone must fast-forward to match');
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('refuses (throws PullError) a pull that cannot fast-forward', async () => {
		const origin = createTestRepo();
		const clone = cloneTestRepo(origin.path);
		try {
			// Diverge both sides from the shared base so neither is an ancestor of the other.
			addCommit(origin.path, 'origin-only.txt', 'x', 'origin advances');
			addCommit(clone.path, 'clone-only.txt', 'y', 'clone advances locally');

			const beforeSha = getHeadSha(clone.path);

			// `GitErrors.noFastForward` matches a PUSH rejection's `(non-fast-forward)`, not `pull --ff-only`'s
			// "Not possible to fast-forward, aborting." message — this maps via the dedicated
			// `notPossibleToFastForward` pattern to the `noFastForward` reason instead.
			await assert.rejects(
				() => clone.provider.ops.pull(clone.path, { fastForward: 'only' }),
				ex => PullError.is(ex, 'noFastForward'),
				'Expected a PullError with the noFastForward reason when the pull cannot fast-forward',
			);

			assert.strictEqual(getHeadSha(clone.path), beforeSha, 'a refused pull must not move the local branch');
		} finally {
			clone.cleanup();
			origin.cleanup();
		}
	});

	test('rejects with PullError "noUpstream" pulling the checked-out branch when it has no upstream', async () => {
		const repo = createTestRepo();
		try {
			createBranch(repo.path, 'no-upstream', { checkout: true });

			await assert.rejects(
				() => repo.provider.ops.pull(repo.path),
				ex => PullError.is(ex, 'noUpstream'),
				'Expected a PullError with the noUpstream reason when the checked-out branch has no upstream',
			);
		} finally {
			repo.cleanup();
		}
	});

	suite('a branch not checked out anywhere', () => {
		function sideRef(repoPath: string): GitBranchReference {
			return createReference('side', repoPath, {
				refType: 'branch',
				name: 'side',
				remote: false,
				upstream: { name: 'origin/side', missing: false },
			});
		}

		test('fast-forwards the local branch without a working tree', async () => {
			const origin = createTestRepo();
			createBranch(origin.path, 'side');
			const clone = cloneTestRepo(origin.path);
			try {
				createTrackingBranch(clone.path, 'side', 'origin/side');
				checkout(origin.path, 'side');
				addCommit(origin.path, 'side-advance.txt', 'x', 'origin side advances');
				const originSide = getHeadSha(origin.path);

				await clone.provider.ops.pull(clone.path, { branch: sideRef(clone.path), fastForward: 'only' });

				assert.strictEqual(revParse(clone.path, 'refs/heads/side'), originSide, 'side must fast-forward');
			} finally {
				clone.cleanup();
				origin.cleanup();
			}
		});

		test('refuses (throws PullError) when the local branch has diverged', async () => {
			const origin = createTestRepo();
			createBranch(origin.path, 'side');
			const clone = cloneTestRepo(origin.path);
			try {
				createTrackingBranch(clone.path, 'side', 'origin/side');
				checkout(clone.path, 'side');
				addCommit(clone.path, 'clone-side.txt', 'y', 'clone side advances locally');
				const beforeSha = getHeadSha(clone.path);
				checkout(clone.path, 'main');
				checkout(origin.path, 'side');
				addCommit(origin.path, 'origin-side.txt', 'x', 'origin side advances');

				await assert.rejects(
					() => clone.provider.ops.pull(clone.path, { branch: sideRef(clone.path), fastForward: 'only' }),
					ex => PullError.is(ex, 'noFastForward'),
				);

				assert.strictEqual(revParse(clone.path, 'refs/heads/side'), beforeSha, 'side must not move');
			} finally {
				clone.cleanup();
				origin.cleanup();
			}
		});

		test('refuses (throws PullError "noUpstream") when the branch has no upstream', async () => {
			const repo = createTestRepo();
			try {
				createBranch(repo.path, 'no-upstream');
				const branch = createReference('no-upstream', repo.path, {
					refType: 'branch',
					name: 'no-upstream',
					remote: false,
				});

				await assert.rejects(
					() => repo.provider.ops.pull(repo.path, { branch: branch, fastForward: 'only' }),
					ex => PullError.is(ex, 'noUpstream'),
					'Expected a PullError with the noUpstream reason when the branch has no upstream',
				);
			} finally {
				repo.cleanup();
			}
		});

		test('refuses (throws PullError) a fast-forward when a stale worktree cache misses a branch checked out outside core', async () => {
			const origin = createTestRepo();
			createBranch(origin.path, 'side');
			const clone = cloneTestRepo(origin.path);
			let worktree: { path: string; cleanup: () => void } | undefined;
			try {
				createTrackingBranch(clone.path, 'side', 'origin/side');
				// Prime the worktree cache BEFORE a worktree checks the branch out — so the provider's
				// cached worktree list is stale by the time `pull` consults it below.
				await clone.provider.worktrees?.getWorktrees(clone.path);

				// Check the branch out in a worktree added OUTSIDE core (bypasses the provider's cache).
				worktree = createWorktree(clone.path, 'side');

				checkout(origin.path, 'side');
				addCommit(origin.path, 'origin-side.txt', 'x', 'origin side advances');
				const beforeSha = revParse(clone.path, 'refs/heads/side');

				await assert.rejects(() =>
					clone.provider.ops.pull(clone.path, { branch: sideRef(clone.path), fastForward: 'only' }),
				);

				assert.strictEqual(
					revParse(clone.path, 'refs/heads/side'),
					beforeSha,
					'a stale worktree cache must not let a checked-out branch move',
				);
			} finally {
				worktree?.cleanup();
				clone.cleanup();
				origin.cleanup();
			}
		});
	});
});

function createBareRemoteFrom(sourceRepoPath: string): { path: string; cleanup: () => void } {
	const bareDir = mkdtempSync(join(tmpdir(), 'gitlens-test-bare-'));
	execFileSync('git', ['clone', '--bare', sourceRepoPath, bareDir], { stdio: 'pipe' });
	return { path: bareDir, cleanup: () => rmSync(bareDir, { recursive: true, force: true }) };
}

suite('OperationsGitSubProvider.fetch — explicit refspecs', () => {
	test('fetches a single ref-to-remote-tracking refspec and moves only that ref', async () => {
		const source = createTestRepo();
		let bare: { path: string; cleanup: () => void } | undefined;
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			createBranch(source.path, 'feature', { checkout: true });
			addCommit(source.path, 'feature.txt', 'feature content', 'Feature commit');
			const featureSha = getHeadSha(source.path);
			checkout(source.path, 'main');

			bare = createBareRemoteFrom(source.path);
			local = createTestRepo();
			execFileSync('git', ['remote', 'add', 'origin', bare.path], { cwd: local.path, stdio: 'pipe' });

			await local.provider.ops.fetch(local.path, {
				remote: 'origin',
				refspecs: ['+refs/heads/feature:refs/remotes/origin/feature'],
			});

			const remoteRefs = execFileSync(
				'git',
				['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/origin'],
				{ cwd: local.path, encoding: 'utf-8' },
			).trim();
			assert.strictEqual(
				remoteRefs,
				`refs/remotes/origin/feature ${featureSha}`,
				'only origin/feature should have moved — nothing else was in the fetched refspec',
			);
		} finally {
			local?.cleanup();
			bare?.cleanup();
			source.cleanup();
		}
	});

	test('rejects (FetchError) fetching into a local branch that is checked out, since no -u is added', async () => {
		const source = createTestRepo();
		let bare: { path: string; cleanup: () => void } | undefined;
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			createBranch(source.path, 'feature', { checkout: true });
			addCommit(source.path, 'feature.txt', 'feature content', 'Feature commit');
			checkout(source.path, 'main');

			bare = createBareRemoteFrom(source.path);
			local = createTestRepo();
			execFileSync('git', ['remote', 'add', 'origin', bare.path], { cwd: local.path, stdio: 'pipe' });
			// With no `-u`, git itself refuses to write into the checked-out branch
			createBranch(local.path, 'feature', { checkout: true });

			await assert.rejects(
				local.provider.ops.fetch(local.path, { remote: 'origin', refspecs: ['feature:feature'] }),
				(ex: unknown) => FetchError.is(ex),
			);
		} finally {
			local?.cleanup();
			bare?.cleanup();
			source.cleanup();
		}
	});
});

suite('OperationsGitSubProvider.fetch — preserveFetchHead', () => {
	function fetchHeadPath(repoPath: string): string {
		return join(repoPath, '.git', 'FETCH_HEAD');
	}

	test('preserveFetchHead: true leaves FETCH_HEAD untouched; a plain fetch writes/updates it', async () => {
		const source = createTestRepo();
		let bare: { path: string; cleanup: () => void } | undefined;
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			bare = createBareRemoteFrom(source.path);
			local = createTestRepo();
			execFileSync('git', ['remote', 'add', 'origin', bare.path], { cwd: local.path, stdio: 'pipe' });

			assert.ok(!existsSync(fetchHeadPath(local.path)), 'sanity: no FETCH_HEAD yet');

			await local.provider.ops.fetch(local.path, { remote: 'origin', preserveFetchHead: true });
			assert.ok(!existsSync(fetchHeadPath(local.path)), 'preserveFetchHead: true must not create FETCH_HEAD');

			await local.provider.ops.fetch(local.path, { remote: 'origin' });
			assert.ok(existsSync(fetchHeadPath(local.path)), 'a plain fetch must write FETCH_HEAD');
			const beforeContent = readFileSync(fetchHeadPath(local.path));

			// Advance the remote (the bare clone doesn't track `source` on its own, so pull the new commit
			// into its own `main` directly) so a plain fetch would have something new to record, then fetch
			// again with preserveFetchHead: true — the existing file must come out byte-identical.
			addCommit(source.path, 'advance.txt', 'x', 'origin advances');
			execFileSync('git', ['fetch', source.path, 'main:main'], { cwd: bare.path, stdio: 'pipe' });
			await local.provider.ops.fetch(local.path, { remote: 'origin', preserveFetchHead: true });

			assert.deepStrictEqual(
				readFileSync(fetchHeadPath(local.path)),
				beforeContent,
				'preserveFetchHead: true must leave an existing FETCH_HEAD byte-identical',
			);
		} finally {
			local?.cleanup();
			bare?.cleanup();
			source.cleanup();
		}
	});
});

suite('OperationsGitSubProvider — announcing a write that failed', () => {
	// A failed write may still have changed the repository, so it announces the way a successful one does:
	// otherwise reads keep serving what they cached before it, until a file watcher catches up (a host with
	// no watcher never does).
	function watch() {
		const changes: string[][] = [];
		const resets: string[][] = [];
		return {
			changes: changes,
			resets: resets,
			hooks: {
				repository: { onChanged: (_repoPath: string, c: readonly string[]) => changes.push([...c]) },
				cache: { onReset: (_repoPath: string, ...types: string[]) => resets.push(types) },
			},
		};
	}

	test('a fetch that rejects after moving one ref leaves no stale branch read', async () => {
		const source = createTestRepo();
		let bare: { path: string; cleanup: () => void } | undefined;
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			createBranch(source.path, 'shared', { checkout: true });
			addCommit(source.path, 'shared.txt', 'one\n', 'Shared commit');
			checkout(source.path, 'main');

			bare = createBareRemoteFrom(source.path);
			local = createTestRepo();
			execFileSync('git', ['remote', 'add', 'origin', bare.path], { cwd: local.path, stdio: 'pipe' });
			execFileSync('git', ['fetch', 'origin', 'refs/heads/shared:refs/remotes/origin/shared'], {
				cwd: local.path,
				stdio: 'pipe',
			});

			// The remote rewrites `shared` (a non-fast-forward for the tracking ref) and gains a new branch
			checkout(source.path, 'shared');
			execFileSync('git', ['commit', '--amend', '-m', 'Rewritten'], { cwd: source.path, stdio: 'pipe' });
			createBranch(source.path, 'fresh');
			execFileSync('git', ['push', '--force', bare.path, 'shared', 'fresh'], {
				cwd: source.path,
				stdio: 'pipe',
			});

			const before = await local.provider.branches.getBranches(local.path);
			assert.ok(!before.values.some(b => b.name === 'origin/fresh'), 'sanity: origin/fresh is not there yet');

			// Refuses `shared` as a non-fast-forward, yet stores `fresh` — git exits non-zero for the run
			await assert.rejects(
				local.provider.ops.fetch(local.path, {
					remote: 'origin',
					refspecs: [
						'refs/heads/shared:refs/remotes/origin/shared',
						'refs/heads/fresh:refs/remotes/origin/fresh',
					],
				}),
				(ex: unknown) => FetchError.is(ex),
			);
			assert.strictEqual(
				execFileSync('git', ['for-each-ref', 'refs/remotes/origin/fresh'], {
					cwd: local.path,
					encoding: 'utf-8',
				}).trim() !== '',
				true,
				'sanity: the rejected fetch still stored origin/fresh',
			);

			const after = await local.provider.branches.getBranches(local.path);
			assert.ok(
				after.values.some(b => b.name === 'origin/fresh'),
				'the branch read must not serve what it cached before the failed fetch',
			);
		} finally {
			local?.cleanup();
			bare?.cleanup();
			source.cleanup();
		}
	});

	test('a fetch that runs nothing announces nothing', async () => {
		const watched = watch();
		const r = createTestRepo({ hooks: watched.hooks });
		try {
			// A branch with no remote has nothing to fetch
			await r.provider.ops.fetch(r.path, {
				branch: createReference('main', r.path, { refType: 'branch', name: 'main', remote: false }),
			});
			assert.deepStrictEqual(watched.changes, []);
			assert.deepStrictEqual(watched.resets, []);
		} finally {
			r.cleanup();
		}
	});

	test('a push the remote rejects still announces', async () => {
		const watched = watch();
		const origin = createTestRepo();
		let bare: { path: string; cleanup: () => void } | undefined;
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			bare = createBareRemoteFrom(origin.path);
			local = cloneTestRepo(bare.path, { hooks: watched.hooks });
			// The remote moves on, so the clone's push is a non-fast-forward
			addCommit(origin.path, 'ahead.txt', 'x', 'Origin advances');
			execFileSync('git', ['push', bare.path, 'main'], { cwd: origin.path, stdio: 'pipe' });
			addCommit(local.path, 'local.txt', 'y', 'Clone advances');

			await assert.rejects(local.provider.ops.push(local.path));

			assert.ok(
				watched.changes.some(c => c.includes('remotes')),
				`the failed push should announce 'remotes', got ${JSON.stringify(watched.changes)}`,
			);
		} finally {
			local?.cleanup();
			bare?.cleanup();
			origin.cleanup();
		}
	});

	test('a pull that stops on a conflict still announces the index', async () => {
		const watched = watch();
		const origin = createTestRepo();
		let local: ReturnType<typeof createTestRepo> | undefined;
		try {
			addCommit(origin.path, 'shared.txt', 'base\n', 'Add shared');
			local = cloneTestRepo(origin.path, { hooks: watched.hooks });
			// `rebase: false` passes no flag, so without this git refuses divergent branches (or follows a global `pull.rebase`)
			execFileSync('git', ['config', 'pull.rebase', 'false'], { cwd: local.path, stdio: 'pipe' });
			addCommit(origin.path, 'shared.txt', 'origin\n', 'Origin edits');
			addCommit(local.path, 'shared.txt', 'local\n', 'Clone edits');

			await assert.rejects(local.provider.ops.pull(local.path, { rebase: false }), (ex: unknown) =>
				PullError.is(ex, 'conflict'),
			);

			assert.ok(
				watched.changes.some(c => c.includes('index')),
				`the conflicted pull should announce 'index', got ${JSON.stringify(watched.changes)}`,
			);
		} finally {
			local?.cleanup();
			origin.cleanup();
		}
	});

	test('a pull in a linked worktree that stops on a conflict announces that worktree', async () => {
		const announced: { repoPath: string; changes: string[] }[] = [];
		const origin = createTestRepo();
		let local: ReturnType<typeof createTestRepo> | undefined;
		let worktree: { path: string; cleanup: () => void } | undefined;
		try {
			createBranch(origin.path, 'side');
			local = cloneTestRepo(origin.path, {
				hooks: {
					repository: {
						onChanged: (repoPath: string, c: readonly string[]) =>
							announced.push({ repoPath: repoPath, changes: [...c] }),
					},
				},
			});
			execFileSync('git', ['config', 'pull.rebase', 'false'], { cwd: local.path, stdio: 'pipe' });
			createTrackingBranch(local.path, 'side', 'origin/side');
			worktree = createWorktree(local.path, 'side');
			checkout(origin.path, 'side');
			addCommit(origin.path, 'shared.txt', 'origin\n', 'Origin edits');
			addCommit(worktree.path, 'shared.txt', 'worktree\n', 'Worktree edits');

			const side = createReference('side', local.path, {
				refType: 'branch',
				name: 'side',
				remote: false,
				upstream: { name: 'origin/side', missing: false },
			});
			await assert.rejects(local.provider.ops.pull(local.path, { branch: side }), (ex: unknown) =>
				PullError.is(ex, 'conflict'),
			);

			const worktreePath = realpathSync(worktree.path);
			assert.ok(
				announced.some(a => realpathSync(a.repoPath) === worktreePath && a.changes.includes('index')),
				`the worktree's index should be announced, got ${JSON.stringify(announced)}`,
			);
		} finally {
			worktree?.cleanup();
			local?.cleanup();
			origin.cleanup();
		}
	});
});
