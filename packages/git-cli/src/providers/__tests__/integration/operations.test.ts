import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sinon from 'sinon';
import type { SigningErrorReason } from '@gitlens/git/errors.js';
import { CommitError, FetchError, MergeError, PullError, PushError, SigningError } from '@gitlens/git/errors.js';
import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import type { SigningFormat } from '@gitlens/git/models/signature.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import type { TestRepo } from './helpers.js';
import {
	addCommit,
	checkout,
	cloneTestRepo,
	createBranch,
	createTestRepo,
	createTrackingBranch,
	createWorktree,
	getHeadSha,
	getRefTips,
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

	suite('upstream tracking writes', () => {
		function watch() {
			const changes: string[][] = [];
			return {
				changes: changes,
				hooks: { repository: { onChanged: (_rp: string, c: readonly string[]) => changes.push([...c]) } },
			};
		}

		function setup(hooks?: ReturnType<typeof watch>['hooks']) {
			const origin = createTestRepo();
			const bare = createBareRemoteFrom(origin.path);
			const local = cloneTestRepo(bare.path, { hooks: hooks });
			return {
				origin: origin,
				bare: bare,
				local: local,
				cleanup: () => {
					local.cleanup();
					bare.cleanup();
					origin.cleanup();
				},
			};
		}

		function branchRef(repoPath: string, name: string, upstream?: { name: string; missing: boolean }) {
			return createReference(name, repoPath, {
				refType: 'branch',
				name: name,
				remote: false,
				upstream: upstream,
			});
		}

		function config(repoPath: string, key: string): string {
			try {
				return execFileSync('git', ['config', '--get-all', key], { cwd: repoPath, encoding: 'utf-8' }).trim();
			} catch {
				return '';
			}
		}

		test('a branch tracking a live upstream pushes without -u', async () => {
			const watched = watch();
			const r = setup(watched.hooks);
			try {
				addCommit(r.local.path, 'a.txt', 'a', 'Local commit');
				const localSha = getHeadSha(r.local.path);
				const configPath = join(r.local.path, '.git', 'config');
				const before = readFileSync(configPath, 'utf-8');

				await r.local.provider.ops.push(r.local.path, {
					reference: branchRef(r.local.path, 'main', { name: 'origin/main', missing: false }),
				});

				assert.strictEqual(readFileSync(configPath, 'utf-8'), before, '.git/config must not be rewritten');
				assert.strictEqual(
					execFileSync('git', ['ls-remote', r.bare.path, 'refs/heads/main'], { encoding: 'utf-8' }).split(
						'\t',
					)[0],
					localSha,
				);
				assert.ok(watched.changes.every(c => !c.includes('config')));
			} finally {
				r.cleanup();
			}
		});

		test('a reference whose upstream is missing sets tracking and announces config', async () => {
			const watched = watch();
			const r = setup(watched.hooks);
			try {
				createBranch(r.local.path, 'topic', { checkout: true });
				addCommit(r.local.path, 'topic.txt', 't', 'Topic commit');
				assert.strictEqual(config(r.local.path, 'branch.topic.remote'), '', 'sanity');

				await r.local.provider.ops.push(r.local.path, {
					reference: branchRef(r.local.path, 'topic', { name: 'origin/topic', missing: true }),
				});

				assert.strictEqual(config(r.local.path, 'branch.topic.remote'), 'origin');
				assert.strictEqual(config(r.local.path, 'branch.topic.merge'), 'refs/heads/topic');
				assert.ok(watched.changes.some(c => c.includes('config')));
			} finally {
				r.cleanup();
			}
		});

		suite('a remote whose fetch refspec stores its branches under another name', () => {
			function setupMirror() {
				const r = setup();
				execFileSync('git', ['config', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/mirror/pfx/*'], {
					cwd: r.local.path,
					stdio: 'pipe',
				});
				execFileSync('git', ['fetch', 'origin'], { cwd: r.local.path, stdio: 'pipe' });
				execFileSync('git', ['push', 'origin', 'main:x'], { cwd: r.local.path, stdio: 'pipe' });
				execFileSync('git', ['fetch', 'origin'], { cwd: r.local.path, stdio: 'pipe' });
				createTrackingBranch(r.local.path, 'x', 'mirror/pfx/x');
				checkout(r.local.path, 'x');
				return r;
			}

			function bareRefs(bare: string): string {
				return execFileSync('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], {
					cwd: bare,
					encoding: 'utf-8',
				});
			}

			test('a branch read from the repository reports its branch on the remote', async () => {
				const r = setupMirror();
				try {
					const x = await r.local.provider.branches.getBranch(r.local.path, 'x');
					assert.strictEqual(x?.upstream?.name, 'mirror/pfx/x');
					assert.strictEqual(x.upstream.remote, 'origin');
					assert.strictEqual(x.upstream.remoteBranch, 'x');

					const all = await r.local.provider.branches.getBranches(r.local.path);
					assert.strictEqual(all.values.find(b => b.name === 'x')?.upstream?.remoteBranch, 'x');
				} finally {
					r.cleanup();
				}
			});

			test('a force push of a branch reference lands on the upstream name on the remote', async () => {
				const r = setupMirror();
				try {
					addCommit(r.local.path, 'x.txt', 'x', 'X commit');
					const localSha = getHeadSha(r.local.path);
					const before = bareRefs(r.bare.path);

					const branch = await r.local.provider.branches.getBranch(r.local.path, 'x');
					assert.ok(branch != null);
					await r.local.provider.ops.push(r.local.path, { reference: branch, force: true });

					const after = bareRefs(r.bare.path);
					assert.notStrictEqual(after, before);
					assert.strictEqual(revParse(r.bare.path, 'refs/heads/x'), localSha);
					assert.deepStrictEqual(
						after.split('\n').map(l => l.split(' ')[0]),
						before.split('\n').map(l => l.split(' ')[0]),
						'no other branch is created',
					);
				} finally {
					r.cleanup();
				}
			});

			test('a commit pushed onto the current branch lands on its upstream name on the remote', async () => {
				const r = setupMirror();
				try {
					createTrackingBranch(r.local.path, 'lx', 'mirror/pfx/x');
					checkout(r.local.path, 'lx');
					addCommit(r.local.path, 'lx.txt', 'lx', 'LX commit');
					const localSha = getHeadSha(r.local.path);
					const before = bareRefs(r.bare.path);

					await r.local.provider.ops.push(r.local.path, {
						reference: createReference(localSha, r.local.path, { refType: 'revision' }),
					});

					const after = bareRefs(r.bare.path);
					assert.strictEqual(revParse(r.bare.path, 'refs/heads/x'), localSha);
					assert.deepStrictEqual(
						after.split('\n').map(l => l.split(' ')[0]),
						before.split('\n').map(l => l.split(' ')[0]),
						'no branch named after the local branch is created',
					);
				} finally {
					r.cleanup();
				}
			});
		});

		suite('a reference push without a remote to push to', () => {
			test('a branch tracking a local branch rejects with noUpstream and pushes nothing', async () => {
				const r = setup();
				try {
					createBranch(r.local.path, 'feature', { checkout: true });
					execFileSync('git', ['branch', '--set-upstream-to=main', 'feature'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});
					addCommit(r.local.path, 'f.txt', 'f', 'Feature commit');
					const before = getRefTips(r.bare.path);

					const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
					assert.ok(branch?.upstream != null);
					await assert.rejects(
						r.local.provider.ops.push(r.local.path, { reference: branch, force: true }),
						(ex: unknown) => PushError.is(ex, 'noUpstream'),
					);

					assert.deepStrictEqual(getRefTips(r.bare.path), before);
				} finally {
					r.cleanup();
				}
			});

			test("publishing a branch tracking a local branch creates it on the remote, leaving the local upstream's name alone", async () => {
				const r = setup();
				try {
					createBranch(r.local.path, 'feature', { checkout: true });
					execFileSync('git', ['branch', '--set-upstream-to=main', 'feature'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});
					addCommit(r.local.path, 'f.txt', 'f', 'Feature commit');
					const localSha = getHeadSha(r.local.path);
					const mainBefore = revParse(r.bare.path, 'refs/heads/main');

					const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
					assert.ok(branch?.upstream?.local);
					await r.local.provider.ops.push(r.local.path, { reference: branch, publish: { remote: 'origin' } });

					assert.strictEqual(revParse(r.bare.path, 'refs/heads/feature'), localSha);
					assert.strictEqual(revParse(r.bare.path, 'refs/heads/main'), mainBefore);
				} finally {
					r.cleanup();
				}
			});

			test('a branch tracking a local branch with a slash in its name rejects with noUpstream', async () => {
				const r = setup();
				try {
					createBranch(r.local.path, 'release/2.0');
					createBranch(r.local.path, 'feature', { checkout: true });
					execFileSync('git', ['branch', '--set-upstream-to=release/2.0', 'feature'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});
					addCommit(r.local.path, 'f.txt', 'f', 'Feature commit');
					const before = getRefTips(r.bare.path);

					const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
					assert.strictEqual(branch?.upstream?.name, 'release/2.0');
					await assert.rejects(
						r.local.provider.ops.push(r.local.path, { reference: branch, force: true }),
						(ex: unknown) => PushError.is(ex, 'noUpstream'),
					);

					assert.deepStrictEqual(getRefTips(r.bare.path), before);
				} finally {
					r.cleanup();
				}
			});

			suite('a branch tracking a local branch with a slash in its name', () => {
				function setupUnchecked() {
					const r = setup();
					createBranch(r.local.path, 'release/2.0');
					createBranch(r.local.path, 'feature');
					execFileSync('git', ['branch', '--set-upstream-to=release/2.0', 'feature'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});
					return r;
				}

				test('fetch of the branch runs no fetch and changes no refs', async () => {
					const r = setupUnchecked();
					try {
						const before = getRefTips(r.local.path);

						const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
						assert.strictEqual(branch?.upstream?.name, 'release/2.0');
						await r.local.provider.ops.fetch(r.local.path, { branch: branch });

						assert.deepStrictEqual(getRefTips(r.local.path), before);
					} finally {
						r.cleanup();
					}
				});

				test('a fast-forward-only pull rejects with noUpstream', async () => {
					const r = setupUnchecked();
					try {
						const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
						assert.strictEqual(branch?.upstream?.name, 'release/2.0');
						await assert.rejects(
							r.local.provider.ops.pull(r.local.path, { branch: branch, fastForward: 'only' }),
							(ex: unknown) => PullError.is(ex, 'noUpstream'),
						);
					} finally {
						r.cleanup();
					}
				});
			});

			test('pushing the current branch with no upstream rejects with noUpstream', async () => {
				const r = setup();
				try {
					createBranch(r.local.path, 'feature', { checkout: true });
					const before = getRefTips(r.bare.path);

					await assert.rejects(r.local.provider.ops.push(r.local.path), (ex: unknown) =>
						PushError.is(ex, 'noUpstream'),
					);

					assert.deepStrictEqual(getRefTips(r.bare.path), before);
				} finally {
					r.cleanup();
				}
			});

			test('a commit reference with no remote for the current branch rejects with noUpstream', async () => {
				const r = setup();
				try {
					createBranch(r.local.path, 'feature', { checkout: true });
					execFileSync('git', ['branch', '--set-upstream-to=main', 'feature'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});
					const before = getRefTips(r.bare.path);

					await assert.rejects(
						r.local.provider.ops.push(r.local.path, {
							reference: createReference(getHeadSha(r.local.path), r.local.path, { refType: 'revision' }),
						}),
						(ex: unknown) => PushError.is(ex, 'noUpstream'),
					);

					assert.deepStrictEqual(getRefTips(r.bare.path), before);
				} finally {
					r.cleanup();
				}
			});
		});

		suite('a remote whose own name contains a slash', () => {
			function setupSlashRemote() {
				const r = setup();
				const fork = createBareRemoteFrom(r.origin.path);
				execFileSync('git', ['remote', 'add', 'team/fork', fork.path], { cwd: r.local.path, stdio: 'pipe' });
				execFileSync('git', ['push', 'team/fork', 'main:feature'], { cwd: r.local.path, stdio: 'pipe' });
				execFileSync('git', ['fetch', 'team/fork'], { cwd: r.local.path, stdio: 'pipe' });
				createTrackingBranch(r.local.path, 'feature', 'team/fork/feature');
				checkout(r.local.path, 'feature');
				const ref = branchRef(r.local.path, 'feature', { name: 'team/fork/feature', missing: false });
				return {
					...r,
					fork: fork,
					ref: ref,
					cleanup: () => {
						fork.cleanup();
						r.cleanup();
					},
				};
			}

			function forkFeature(path: string): string {
				return execFileSync('git', ['rev-parse', 'refs/heads/feature'], {
					cwd: path,
					encoding: 'utf-8',
				}).trim();
			}

			test('a force push of a branch reference lands on that remote, not on its first segment', async () => {
				const r = setupSlashRemote();
				try {
					addCommit(r.local.path, 'feature.txt', 'f', 'Feature commit');
					const localSha = getHeadSha(r.local.path);

					await r.local.provider.ops.push(r.local.path, { reference: r.ref, force: true });

					assert.strictEqual(forkFeature(r.fork.path), localSha);
				} finally {
					r.cleanup();
				}
			});

			test('a push of the current branch lands on that remote', async () => {
				const r = setupSlashRemote();
				try {
					addCommit(r.local.path, 'feature.txt', 'f', 'Feature commit');
					const localSha = getHeadSha(r.local.path);

					await r.local.provider.ops.push(r.local.path);

					assert.strictEqual(forkFeature(r.fork.path), localSha);
				} finally {
					r.cleanup();
				}
			});

			test('a branch read from the repository reports its upstream remote exactly', async () => {
				const r = setupSlashRemote();
				try {
					execFileSync('git', ['branch', '--track', 'tracks-local', 'main'], {
						cwd: r.local.path,
						stdio: 'pipe',
					});

					const feature = await r.local.provider.branches.getBranch(r.local.path, 'feature');
					assert.strictEqual(feature?.upstream?.remote, 'team/fork');
					assert.strictEqual(feature.remoteName, 'team/fork');
					assert.strictEqual(feature.trackingWithoutRemote, 'feature');

					const all = await r.local.provider.branches.getBranches(r.local.path);
					const listedFeature = all.values.find(b => b.name === 'feature');
					assert.strictEqual(listedFeature?.upstream?.remote, 'team/fork');

					const local = all.values.find(b => b.name === 'tracks-local');
					assert.strictEqual(local?.upstream?.name, 'main');
					assert.strictEqual(local.upstream.remote, undefined);
				} finally {
					r.cleanup();
				}
			});

			test('a push of a branch read from the repository lands on that remote', async () => {
				const r = setupSlashRemote();
				try {
					addCommit(r.local.path, 'feature.txt', 'f', 'Feature commit');
					const localSha = getHeadSha(r.local.path);

					const branch = await r.local.provider.branches.getBranch(r.local.path, 'feature');
					assert.ok(branch != null);
					await r.local.provider.ops.push(r.local.path, { reference: branch });

					assert.strictEqual(forkFeature(r.fork.path), localSha);
				} finally {
					r.cleanup();
				}
			});

			test('a fetch of a branch reference updates the remote-tracking branch', async () => {
				const r = setupSlashRemote();
				try {
					const other = cloneTestRepo(r.fork.path);
					let advanced: string;
					try {
						checkout(other.path, 'feature');
						addCommit(other.path, 'other.txt', 'o', 'Other advances');
						advanced = getHeadSha(other.path);
						execFileSync('git', ['push', 'origin', 'feature'], { cwd: other.path, stdio: 'pipe' });
					} finally {
						other.cleanup();
					}

					await r.local.provider.ops.fetch(r.local.path, { branch: r.ref });

					assert.strictEqual(revParse(r.local.path, 'refs/remotes/team/fork/feature'), advanced);
				} finally {
					r.cleanup();
				}
			});

			test('a fast-forward-only pull of a branch reference advances it from that remote', async () => {
				const r = setupSlashRemote();
				try {
					checkout(r.local.path, 'main');
					const other = cloneTestRepo(r.fork.path);
					let advanced: string;
					try {
						checkout(other.path, 'feature');
						addCommit(other.path, 'other.txt', 'o', 'Other advances');
						advanced = getHeadSha(other.path);
						execFileSync('git', ['push', 'origin', 'feature'], { cwd: other.path, stdio: 'pipe' });
					} finally {
						other.cleanup();
					}

					await r.local.provider.ops.pull(r.local.path, { branch: r.ref, fastForward: 'only' });

					assert.strictEqual(revParse(r.local.path, 'refs/heads/feature'), advanced);
				} finally {
					r.cleanup();
				}
			});
		});

		test('a force push whose lease is stale rejects with rejectedWithLease', async () => {
			const r = setup();
			try {
				// Another clone advances the remote after this one last fetched
				const other = cloneTestRepo(r.bare.path);
				try {
					addCommit(other.path, 'other.txt', 'o', 'Other advances');
					execFileSync('git', ['push', 'origin', 'main'], { cwd: other.path, stdio: 'pipe' });
				} finally {
					other.cleanup();
				}
				addCommit(r.local.path, 'mine.txt', 'm', 'Mine diverges');

				await assert.rejects(
					r.local.provider.ops.push(r.local.path, {
						reference: branchRef(r.local.path, 'main', { name: 'origin/main', missing: false }),
						force: true,
					}),
					(ex: unknown) => PushError.is(ex, 'rejectedWithLease'),
				);
			} finally {
				r.cleanup();
			}
		});
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

suite('OperationsGitSubProvider.fetch — remote HEAD symref', () => {
	let origin: TestRepo;
	let clone: TestRepo;

	function readRemoteHead(repoPath: string): string | undefined {
		try {
			return execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
				cwd: repoPath,
				encoding: 'utf-8',
				stdio: 'pipe',
			}).trim();
		} catch {
			return undefined;
		}
	}

	function deleteRemoteHead(repoPath: string): void {
		execFileSync('git', ['remote', 'set-head', 'origin', '-d'], { cwd: repoPath, stdio: 'pipe' });
	}

	/** Takes the git < 2.48 path, and keeps the installed git's own fetch from creating the symref */
	function simulateOldGit(repo: TestRepo): void {
		execFileSync('git', ['config', 'remote.origin.followRemoteHEAD', 'never'], { cwd: repo.path, stdio: 'pipe' });
		// A user's global `fetch.all` would turn every bare fetch into a fetch of all remotes
		execFileSync('git', ['config', 'fetch.all', 'false'], { cwd: repo.path, stdio: 'pipe' });
		const git = repo.provider.git;
		const supports = git.supports;
		git.supports = feature => (feature === 'git:fetch:follow-remote-head' ? false : supports.call(git, feature));
	}

	/** The `setRemoteHeadIfMissing` calls the fetch started, once they settle; the fetch doesn't await them */
	async function settledSetHeads(spy: sinon.SinonSpy, count: number): Promise<void> {
		const deadline = Date.now() + 5000;
		while (spy.callCount < count && Date.now() < deadline) {
			await new Promise(resolve => setTimeout(resolve, 10));
		}
		await Promise.allSettled(spy.returnValues);
	}

	function setHeadRuns(spy: sinon.SinonSpy): number {
		return spy.getCalls().filter(c => c.args.includes('set-head')).length;
	}

	setup(() => {
		origin = createTestRepo();
		createBranch(origin.path, 'develop', { checkout: true });
		addCommit(origin.path, 'develop-only.txt', 'develop', 'develop only');
		// The clone's `origin/HEAD`, and what `remote set-head -a` reads back
		clone = cloneTestRepo(origin.path);
		deleteRemoteHead(clone.path);
	});

	teardown(() => {
		sinon.restore();
		clone.cleanup();
		origin.cleanup();
	});

	test('git 2.48+: the fetch writes the missing symref itself; core runs no set-head', async function () {
		if (!(await clone.provider.git.supports('git:fetch:follow-remote-head'))) {
			this.skip();
		}

		const runs = sinon.spy(clone.provider.git, 'run');
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, { remote: 'origin' });
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.strictEqual(readRemoteHead(clone.path), 'origin/develop');
		assert.strictEqual(setHeads.callCount, 0);
		assert.strictEqual(setHeadRuns(runs), 0);
	});

	test('git < 2.48: writes the missing symref after a fetch, so the base reads it', async () => {
		simulateOldGit(clone);
		// From a detached HEAD, so the branch's reflog names no branch it was created from and the base is the default
		checkout(clone.path, 'origin/develop');
		createBranch(clone.path, 'feature', { checkout: true });
		addCommit(clone.path, 'branch-only.txt', 'feature', 'branch only');

		const before = await clone.provider.branches.getAheadOfBase(clone.path, 'feature');
		// Without the symref the base is a guess at the remote's usual default
		assert.strictEqual(before.base?.ref, 'origin/main');

		const runs = sinon.spy(clone.provider.git, 'run');
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, { remote: 'origin' });
		await settledSetHeads(setHeads, 1);

		assert.strictEqual(readRemoteHead(clone.path), 'origin/develop');
		assert.strictEqual(setHeadRuns(runs), 1);

		const after = await clone.provider.branches.getAheadOfBase(clone.path, 'feature');
		assert.strictEqual(after.base?.ref, 'origin/develop');
		assert.strictEqual(after.base?.ahead, 1);
		assert.strictEqual(after.base?.tier, 'default');
	});

	test('git < 2.48: runs set-head once per remote, not on every fetch', async () => {
		simulateOldGit(clone);
		const runs = sinon.spy(clone.provider.git, 'run');
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, { remote: 'origin' });
		await settledSetHeads(setHeads, 1);
		assert.strictEqual(setHeadRuns(runs), 1);

		deleteRemoteHead(clone.path);
		await clone.provider.ops.fetch(clone.path, { all: true });
		await clone.provider.ops.fetch(clone.path);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.strictEqual(setHeads.callCount, 1);
		assert.strictEqual(setHeadRuns(runs), 1);
		assert.strictEqual(readRemoteHead(clone.path), undefined);
	});

	test('git < 2.48: runs no set-head when the symref exists', async () => {
		simulateOldGit(clone);
		execFileSync('git', ['remote', 'set-head', 'origin', 'main'], { cwd: clone.path, stdio: 'pipe' });
		const runs = sinon.spy(clone.provider.git, 'run');
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, { remote: 'origin' });
		await settledSetHeads(setHeads, 1);

		assert.strictEqual(setHeadRuns(runs), 0);
		assert.strictEqual(readRemoteHead(clone.path), 'origin/main');
	});

	test("git < 2.48: a pull writes the symref of the branch's remote", async () => {
		simulateOldGit(clone);
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.pull(clone.path);
		await settledSetHeads(setHeads, 1);

		assert.deepStrictEqual(
			setHeads.getCalls().map(c => c.args[1]),
			['origin'],
		);
		assert.strictEqual(readRemoteHead(clone.path), 'origin/develop');
	});

	/** Adds a remote that points at the origin repo, with `config` set on the clone */
	function addSecondRemote(name: string, config: Record<string, string> = {}): void {
		execFileSync('git', ['remote', 'add', name, origin.path], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', `remote.${name}.followRemoteHEAD`, 'never'], { cwd: clone.path, stdio: 'pipe' });
		for (const [key, value] of Object.entries(config)) {
			execFileSync('git', ['config', key, value], { cwd: clone.path, stdio: 'pipe' });
		}
	}

	function setHeadRemotes(spy: sinon.SinonSpy): string[] {
		return spy
			.getCalls()
			.map(c => c.args[1] as string)
			.sort();
	}

	test('git < 2.48: fetch --all skips a remote marked skipFetchAll', async () => {
		simulateOldGit(clone);
		addSecondRemote('skipped', { 'remote.skipped.skipFetchAll': 'true' });
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, { all: true });
		await settledSetHeads(setHeads, 1);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.deepStrictEqual(setHeadRemotes(setHeads), ['origin']);
	});

	test("git < 2.48: a bare fetch uses the branch's remote, even when its name contains a slash", async () => {
		simulateOldGit(clone);
		addSecondRemote('team/fork');
		execFileSync('git', ['fetch', 'team/fork'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'branch.main.remote', 'team/fork'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'branch.main.merge', 'refs/heads/main'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['checkout', '-B', 'main'], { cwd: clone.path, stdio: 'pipe' });
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path);
		await settledSetHeads(setHeads, 1);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.deepStrictEqual(setHeadRemotes(setHeads), ['team/fork']);
	});

	test('git < 2.48: a bare fetch with fetch.all handles every remote but skipFetchAll ones', async () => {
		simulateOldGit(clone);
		addSecondRemote('other');
		addSecondRemote('skipped', { 'remote.skipped.skipFetchAll': 'true' });
		execFileSync('git', ['config', 'fetch.all', 'true'], { cwd: clone.path, stdio: 'pipe' });
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path);
		await settledSetHeads(setHeads, 2);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.deepStrictEqual(setHeadRemotes(setHeads), ['origin', 'other']);
	});

	test('git < 2.48: a bare fetch of the only remote handles it even when it is not origin', async () => {
		simulateOldGit(clone);
		execFileSync('git', ['remote', 'rename', 'origin', 'upstream'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'remote.upstream.followRemoteHEAD', 'never'], {
			cwd: clone.path,
			stdio: 'pipe',
		});
		const current = execFileSync('git', ['branch', '--show-current'], {
			cwd: clone.path,
			encoding: 'utf-8',
		}).trim();
		execFileSync('git', ['config', '--remove-section', `branch.${current}`], { cwd: clone.path, stdio: 'pipe' });
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path);
		await settledSetHeads(setHeads, 1);

		assert.deepStrictEqual(setHeadRemotes(setHeads), ['upstream']);
	});

	test('git < 2.48: a bare fetch of a branch whose remote is the local repository runs no set-head', async () => {
		simulateOldGit(clone);
		const current = execFileSync('git', ['branch', '--show-current'], {
			cwd: clone.path,
			encoding: 'utf-8',
		}).trim();
		execFileSync('git', ['config', `branch.${current}.remote`, '.'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', `branch.${current}.merge`, `refs/heads/${current}`], {
			cwd: clone.path,
			stdio: 'pipe',
		});
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.strictEqual(setHeads.callCount, 0);
	});

	test('git < 2.48: a bare fetch ignores fetch.all when git has no fetch.all config', async () => {
		simulateOldGit(clone);
		addSecondRemote('other');
		execFileSync('git', ['config', 'fetch.all', 'true'], { cwd: clone.path, stdio: 'pipe' });
		const git = clone.provider.git;
		const supports = git.supports;
		git.supports = feature => (feature === 'git:fetch:all-config' ? false : supports.call(git, feature));
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path);
		await settledSetHeads(setHeads, 1);
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.deepStrictEqual(setHeadRemotes(setHeads), ['origin']);
	});

	test('git < 2.48: a pull in a worktree honors fetch.all', async function () {
		if (!(await clone.provider.git.supports('git:fetch:all-config'))) {
			this.skip();
		}

		simulateOldGit(clone);
		addSecondRemote('other');
		execFileSync('git', ['config', 'fetch.all', 'true'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['branch', 'wt', 'origin/develop'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'branch.wt.remote', 'origin'], { cwd: clone.path, stdio: 'pipe' });
		execFileSync('git', ['config', 'branch.wt.merge', 'refs/heads/develop'], { cwd: clone.path, stdio: 'pipe' });
		const wtPath = `${clone.path}-wt`;
		execFileSync('git', ['worktree', 'add', wtPath, 'wt'], { cwd: clone.path, stdio: 'pipe' });
		try {
			const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

			await clone.provider.ops.pull(clone.path, {
				branch: createReference('wt', clone.path, {
					refType: 'branch',
					name: 'wt',
					remote: false,
					upstream: { name: 'origin/develop', missing: false },
				}),
			});
			await settledSetHeads(setHeads, 2);
			await new Promise(resolve => setTimeout(resolve, 100));

			assert.deepStrictEqual(setHeadRemotes(setHeads), ['origin', 'other']);
			// Run for the worktree the pull ran in, not the path it was asked for
			assert.ok(setHeads.getCalls().every(c => c.args[0] !== clone.path));
		} finally {
			execFileSync('git', ['worktree', 'remove', '--force', wtPath], { cwd: clone.path, stdio: 'pipe' });
		}
	});

	test('git < 2.48: a fetch of explicit refspecs writes no symref', async () => {
		simulateOldGit(clone);
		const setHeads = sinon.spy(clone.provider.branches, 'setRemoteHeadIfMissing');

		await clone.provider.ops.fetch(clone.path, {
			remote: 'origin',
			refspecs: ['+refs/heads/develop:refs/remotes/origin/develop'],
		});
		await new Promise(resolve => setTimeout(resolve, 100));

		assert.strictEqual(setHeads.callCount, 0);
		assert.strictEqual(readRemoteHead(clone.path), undefined);
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

suite('OperationsGitSubProvider — failed writes still announce', () => {
	test('commit refused by a pre-commit hook announces head, heads and index', async () => {
		const onChanged = sinon.spy();
		const r = createTestRepo({ hooks: { repository: { onChanged: onChanged } } });
		try {
			const hook = join(r.path, '.git', 'hooks', 'pre-commit');
			writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });

			writeFileSync(join(r.path, 'new.txt'), 'x\n');
			execFileSync('git', ['add', 'new.txt'], { cwd: r.path, stdio: 'pipe' });
			onChanged.resetHistory();

			// An ambient `core.hooksPath` injected through `GIT_CONFIG_*` would otherwise bypass the repo's own hooks
			const runOptions = { env: { GIT_CONFIG_COUNT: '0' } };
			await assert.rejects(
				r.provider.ops.commit(r.path, 'Refused', undefined, runOptions),
				(ex: unknown) => ex instanceof CommitError,
			);

			assert.strictEqual(onChanged.callCount, 1);
			assert.deepStrictEqual(onChanged.lastCall.args, [r.path, ['head', 'heads', 'index']]);
		} finally {
			r.cleanup();
		}
	});
});

suite('OperationsGitSubProvider — beforeIndexLockRetry rejection', () => {
	test('commit rethrows the hook rejection instead of mapping it to a CommitError', async () => {
		const r = createTestRepo();
		const lock = join(r.path, '.git', 'index.lock');
		try {
			writeFileSync(join(r.path, 'new.txt'), 'x\n');
			execFileSync('git', ['add', 'new.txt'], { cwd: r.path, stdio: 'pipe' });
			writeFileSync(lock, '');

			const hostError = new Error('host refused');
			let hookCalls = 0;
			let caught: unknown;
			try {
				await r.provider.ops.commit(r.path, 'msg', undefined, {
					beforeIndexLockRetry: () => {
						hookCalls++;
						return Promise.reject(hostError);
					},
				});
			} catch (ex) {
				caught = ex;
			}

			assert.strictEqual(caught, hostError);
			assert.strictEqual(hookCalls, 1);
		} finally {
			rmSync(lock, { force: true });
			r.cleanup();
		}
	});

	test('reset rethrows the hook rejection instead of mapping it to a ResetError', async () => {
		const r = createTestRepo();
		const lock = join(r.path, '.git', 'index.lock');
		try {
			writeFileSync(lock, '');

			const hostError = new Error('host refused');
			let hookCalls = 0;
			let caught: unknown;
			try {
				await r.provider.ops.reset(
					r.path,
					'HEAD',
					{ mode: 'mixed' },
					{
						beforeIndexLockRetry: () => {
							hookCalls++;
							return Promise.reject(hostError);
						},
					},
				);
			} catch (ex) {
				caught = ex;
			}

			assert.strictEqual(caught, hostError);
			assert.strictEqual(hookCalls, 1);
		} finally {
			rmSync(lock, { force: true });
			r.cleanup();
		}
	});

	test('restore rethrows the hook rejection instead of mapping it to a CheckoutError', async () => {
		const r = createTestRepo();
		const lock = join(r.path, '.git', 'index.lock');
		try {
			writeFileSync(join(r.path, 'README.md'), 'changed\n');
			writeFileSync(lock, '');

			const hostError = new Error('host refused');
			let hookCalls = 0;
			let caught: unknown;
			try {
				await r.provider.ops.restore(r.path, 'README.md', undefined, {
					beforeIndexLockRetry: () => {
						hookCalls++;
						return Promise.reject(hostError);
					},
				});
			} catch (ex) {
				caught = ex;
			}

			assert.strictEqual(caught, hostError);
			assert.strictEqual(hookCalls, 1);
		} finally {
			rmSync(lock, { force: true });
			r.cleanup();
		}
	});
});
