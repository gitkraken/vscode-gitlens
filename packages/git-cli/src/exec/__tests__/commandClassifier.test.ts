import * as assert from 'assert';
import { join } from 'node:path';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { getChangesForCommand, leadingCommand, mayWriteTracking } from '../commandClassifier.js';

interface Named {
	changes: readonly RepositoryChange[];
	refs?: readonly string[];
	confined?: boolean;
	movesHeadBranch?: boolean;
}

suite('commandClassifier', () => {
	suite('leadingCommand — readOnly', () => {
		const readVerbs = ['log', 'status', 'diff', 'blame', 'show', 'rev-parse', 'ls-remote'];
		for (const verb of readVerbs) {
			test(`'${verb}' is read-only`, () => {
				assert.strictEqual(leadingCommand([verb]).readOnly, true);
			});
		}

		const writeVerbs = ['commit', 'checkout', 'merge', 'rebase', 'push', 'fetch', 'reset'];
		for (const verb of writeVerbs) {
			test(`'${verb}' is a write`, () => {
				assert.strictEqual(leadingCommand([verb]).readOnly, false);
			});
		}

		test("'branch -r -d origin/x' is a write despite the listing-shaped -r", () => {
			assert.strictEqual(leadingCommand(['branch', '-r', '-d', 'origin/x']).readOnly, false);
		});

		test("'branch -r' is read-only", () => {
			assert.strictEqual(leadingCommand(['branch', '-r']).readOnly, true);
		});

		test("'config k' (get form) is read-only", () => {
			assert.strictEqual(leadingCommand(['config', 'k']).readOnly, true);
		});

		test("'config k v' (set form) is a write", () => {
			assert.strictEqual(leadingCommand(['config', 'k', 'v']).readOnly, false);
		});

		test("'config --unset k' is a write", () => {
			assert.strictEqual(leadingCommand(['config', '--unset', 'k']).readOnly, false);
		});

		test("'-c k=v status' is read-only — the -c value is skipped, not mistaken for the verb", () => {
			const command = leadingCommand(['-c', 'k=v', 'status']);
			assert.strictEqual(command.verb, 'status');
			assert.strictEqual(command.readOnly, true);
		});

		test("'-C /other commit' is a write with pathOverride '/other'", () => {
			const command = leadingCommand(['-C', '/other', 'commit']);
			assert.strictEqual(command.verb, 'commit');
			assert.strictEqual(command.readOnly, false);
			assert.strictEqual(command.pathOverride, '/other');
		});

		test('repeated -C paths combine as git combines them, each relative to the one before', () => {
			assert.strictEqual(leadingCommand(['-C', 'a', '-C', 'b', 'commit']).pathOverride, join('a', 'b'));
			assert.strictEqual(leadingCommand(['-C', 'a', '-C', '/abs', 'commit']).pathOverride, '/abs');
		});

		test("'--git-dir X log' is read-only — the value is skipped, not mistaken for the verb", () => {
			const command = leadingCommand(['--git-dir', 'X', 'log']);
			assert.strictEqual(command.verb, 'log');
			assert.strictEqual(command.readOnly, true);
		});

		test("'symbolic-ref HEAD' (bare read) is read-only", () => {
			assert.strictEqual(leadingCommand(['symbolic-ref', 'HEAD']).readOnly, true);
		});

		test("'symbolic-ref HEAD refs/heads/main' (set form) is a write", () => {
			assert.strictEqual(leadingCommand(['symbolic-ref', 'HEAD', 'refs/heads/main']).readOnly, false);
		});

		test("'symbolic-ref -d HEAD' (delete) is a write", () => {
			assert.strictEqual(leadingCommand(['symbolic-ref', '-d', 'HEAD']).readOnly, false);
		});

		for (const args of [
			['reflog'],
			['reflog', 'main'],
			['reflog', 'show', 'main'],
			['reflog', 'list'],
			['reflog', 'exists', 'main'],
		]) {
			test(`'${args.join(' ')}' is read-only`, () => {
				assert.strictEqual(leadingCommand(args).readOnly, true);
			});
		}

		for (const args of [
			['reflog', 'expire', '--all'],
			['reflog', 'delete', 'main@{1}'],
			['reflog', 'drop', 'main'],
		]) {
			test(`'${args.join(' ')}' is a write`, () => {
				assert.strictEqual(leadingCommand(args).readOnly, false);
			});
		}

		test("'worktree list' is read-only", () => {
			assert.strictEqual(leadingCommand(['worktree', 'list']).readOnly, true);
		});

		test("'worktree add' is a write", () => {
			assert.strictEqual(leadingCommand(['worktree', 'add', '/wt', 'main']).readOnly, false);
		});

		const listingForms = [
			['branch'],
			['branch', '-vv'],
			['tag'],
			['tag', '-l', 'v*'],
			['tag', '--points-at', 'HEAD'],
			['remote'],
			['notes', 'list'],
			['cherry', 'origin/main'],
			['shortlog', '-sn'],
		];
		for (const args of listingForms) {
			test(`'${args.join(' ')}' is read-only`, () => {
				assert.strictEqual(leadingCommand(args).readOnly, true);
			});
		}

		test("'branch x' and 'tag v1' (create forms) are writes", () => {
			assert.strictEqual(leadingCommand(['branch', 'x']).readOnly, false);
			assert.strictEqual(leadingCommand(['tag', 'v1']).readOnly, false);
		});

		test("'config edit' is a write despite its single non-flag argument", () => {
			assert.strictEqual(leadingCommand(['config', 'edit']).readOnly, false);
		});
	});

	suite('getChangesForCommand', () => {
		test('a read-only command notifies nothing', () => {
			assert.strictEqual(getChangesForCommand(['status']), undefined);
		});

		test("'worktree list' notifies nothing", () => {
			assert.strictEqual(getChangesForCommand(['worktree', 'list']), undefined);
		});

		test("'worktree add' notifies worktrees + worktreeHead + heads", () => {
			const result = getChangesForCommand(['worktree', 'add', '/wt', 'main']);
			assert.deepStrictEqual(result?.changes, ['worktrees', 'worktreeHead', 'heads']);
			assert.deepStrictEqual(result?.sharedChanges, ['worktrees', 'worktreeHead', 'heads']);
		});

		for (const [verb, args] of [
			['hash-object', ['hash-object', '-w', 'file.txt']],
			['commit-tree', ['commit-tree', 'abc123']],
			['gc', ['gc']],
			['init', ['init']],
			['clone', ['clone', 'https://example.com/repo.git']],
		] as const) {
			test(`object-only verb '${verb}' notifies nothing`, () => {
				assert.strictEqual(getChangesForCommand(args as unknown as string[]), undefined);
			});
		}

		test('an unknown mutating verb notifies an empty (unclassified) change list', () => {
			const result = getChangesForCommand(['submodule', 'update']);
			assert.deepStrictEqual(result?.changes, []);
		});

		test("'-C /other commit' carries the pathOverride through", () => {
			const result = getChangesForCommand(['-C', '/other', 'commit']);
			assert.strictEqual(result?.pathOverride, '/other');
			assert.deepStrictEqual(result?.changes, ['head', 'heads', 'index', 'pausedOp']);
			assert.deepStrictEqual(result?.sharedChanges, ['heads']);
		});

		test("'branch -d x' changes only what every worktree sees", () => {
			const result = getChangesForCommand(['branch', '-d', 'x']);
			assert.deepStrictEqual(result?.changes, ['config', 'heads']);
			assert.deepStrictEqual(result?.sharedChanges, ['config', 'heads']);
		});

		test("'branch' announces config only for a form that writes it", () => {
			for (const args of [
				['branch', '-m', 'a', 'b'],
				['branch', '-C', 'a', 'b'],
				['branch', '--delete', 'x'],
				['branch', '-u', 'origin/x'],
				['branch', '--set-upstream-to=origin/x'],
				['branch', '--unset-upstream'],
				['branch', '--track', 'x', 'origin/x'],
				['branch', '--track=inherit', 'x', 'y'],
				['branch', '--edit-description'],
			]) {
				assert.ok(getChangesForCommand(args)?.changes.includes('config'), `${args.join(' ')} writes config`);
			}
			for (const args of [
				['branch', 'x'],
				['branch', 'x', 'main'],
				['branch', '-f', 'x', 'main'],
				['branch', '--no-track', 'x', 'origin/x'],
				['-c', 'k=v', 'branch', 'x'],
			]) {
				assert.deepStrictEqual(getChangesForCommand(args)?.changes, ['heads'], args.join(' '));
			}
		});

		test('HEAD-moving writes announce head, as their typed mutators do', () => {
			for (const args of [
				['reset', '--hard', 'HEAD~1'],
				['update-ref', 'HEAD', 'abc123'],
				['symbolic-ref', 'HEAD', 'refs/heads/main'],
			]) {
				assert.ok(
					getChangesForCommand(args)?.changes.includes('head'),
					`${args.join(' ')} should announce head`,
				);
			}
		});

		test('writes that can end or start a paused operation announce pausedOp, as their typed mutators reset status', () => {
			for (const args of [
				['commit', '--no-edit'],
				['reset', '--merge'],
				['am', '--abort'],
			]) {
				assert.ok(
					getChangesForCommand(args)?.changes.includes('pausedOp'),
					`${args.join(' ')} should announce pausedOp`,
				);
			}
		});

		test("'fetch' can announce a local branch, since a refspec like 'main:main' writes one", () => {
			assert.ok(getChangesForCommand(['fetch', 'origin', 'main:main'])?.changes.includes('heads'));
		});

		test("'pull' announces what its fetch moves, as 'fetch' does", () => {
			const changes = getChangesForCommand(['pull'])?.changes;
			assert.ok(changes?.includes('tags'));
			assert.ok(changes?.includes('lastFetched'));
		});

		test("a reflog rewrite resets everything, since a cached 'no base branch' can become derivable", () => {
			assert.deepStrictEqual(getChangesForCommand(['reflog', 'expire', '--all'])?.changes, []);
		});

		test("'update-ref refs/stash' can announce stash", () => {
			const result = getChangesForCommand(['update-ref', 'refs/stash', 'abc123']);
			assert.ok(result?.changes.includes('stash'));
		});
	});

	suite('getChangesForCommand — named refs', () => {
		const sha = '0123456789abcdef0123456789abcdef01234567';
		const sha2 = '89abcdef0123456789abcdef0123456789abcdef';
		const sha256 = `${sha}${sha.slice(0, 24)}`;
		const unnamedUpdateRef: RepositoryChange[] = ['head', 'heads', 'remotes', 'tags', 'stash'];
		const unnamedBranchConfig: RepositoryChange[] = ['config', 'heads', 'remotes'];
		const unnamedCheckout: RepositoryChange[] = ['head', 'heads', 'index', 'worktrees', 'worktreeHead'];
		const reset: RepositoryChange[] = ['head', 'heads', 'index', 'pausedOp'];
		const rebase: RepositoryChange[] = [
			'head',
			'heads',
			'index',
			'pausedOp',
			'rebase',
			'worktrees',
			'worktreeHead',
		];

		function check(args: readonly string[], expected: Named | undefined): void {
			const result = getChangesForCommand(args);
			assert.deepStrictEqual(
				result && {
					changes: result.changes,
					refs: result.refs,
					confined: result.configConfinedToRefs,
					movesHeadBranch: result.movesHeadBranch,
				},
				expected && {
					changes: expected.changes,
					refs: expected.refs,
					confined: expected.confined,
					movesHeadBranch: expected.movesHeadBranch,
				},
			);
		}

		function suiteOf(name: string, cases: readonly (readonly [readonly string[], Named | undefined])[]): void {
			suite(name, () => {
				for (const [args, expected] of cases) {
					test(`'${args.join(' ')}'`, () => check(args, expected));
				}
			});
		}

		suiteOf('update-ref names the one ref it writes', [
			[['update-ref', 'refs/heads/feat', sha], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['update-ref', 'refs/heads/feat', sha, sha2], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['update-ref', 'refs/heads/x', sha, ''], { changes: ['heads'], refs: ['refs/heads/x'] }],
			[
				['update-ref', '--end-of-options', 'refs/heads/feat', sha, ''],
				{ changes: ['heads'], refs: ['refs/heads/feat'] },
			],
			[
				['update-ref', '-d', '--no-deref', 'refs/heads/feat', sha],
				{ changes: ['heads'], refs: ['refs/heads/feat'] },
			],
			[['update-ref', '-d', 'refs/heads/feat'], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['update-ref', '-m', 'reason', 'refs/tags/v1', sha], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[
				['update-ref', '-mreason', 'refs/remotes/origin/x', sha],
				{ changes: ['remotes'], refs: ['refs/remotes/origin/x'] },
			],
			[['update-ref', '--message=reason', 'refs/stash', sha], { changes: ['stash'], refs: ['refs/stash'] }],
			[
				['update-ref', '--no-deref', 'refs/remotes/origin/HEAD', sha],
				{ changes: ['remotes'], refs: ['refs/remotes/origin/HEAD'] },
			],
		]);

		suiteOf('update-ref of a bookkeeping ref announces nothing', [
			[['update-ref', '-d', 'refs/undo/abc'], undefined],
			[['update-ref', 'refs/undo/abc', sha2], undefined],
			[['update-ref', 'refs/kepler/sync/resolved/feat', sha, ''], undefined],
			[['update-ref', 'refs/gitkraken/x', sha], undefined],
		]);

		suiteOf('update-ref it cannot name stays unnamed', [
			[['update-ref', 'HEAD', sha], { changes: ['head', 'heads'] }],
			[['update-ref', 'ORIG_HEAD', sha], { changes: unnamedUpdateRef }],
			[['update-ref', 'feat', sha], { changes: unnamedUpdateRef }],
			// A symbolic ref moves the ref it points to
			[['update-ref', 'refs/remotes/origin/HEAD', sha], { changes: unnamedUpdateRef }],
			[['update-ref', 'refs/replace/abc', sha], { changes: ['heads'] }],
			[['update-ref', 'refs/notes/commits', sha], { changes: ['heads'] }],
			[['update-ref', '--stdin'], { changes: unnamedUpdateRef }],
			[['update-ref', '-z', '--stdin'], { changes: unnamedUpdateRef }],
			[['update-ref', '--batch-updates', '--stdin'], { changes: unnamedUpdateRef }],
			[['update-ref', '--unknown', 'refs/heads/x', sha], { changes: unnamedUpdateRef }],
			[['update-ref', '-m'], { changes: unnamedUpdateRef }],
			[['update-ref'], { changes: unnamedUpdateRef }],
		]);

		suiteOf('branch names what it creates, deletes, renames or copies', [
			[['branch', 'feat', sha], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['branch', 'feat'], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['branch', '-f', 'feat', 'main'], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[['branch', '--no-track', 'feat', 'origin/feat'], { changes: ['heads'], refs: ['refs/heads/feat'] }],
			[
				['branch', 'feat', 'origin/feat'],
				{ changes: ['config', 'heads'], refs: ['refs/heads/feat'], confined: true },
			],
			[
				['branch', '--force', 'feat', 'refs/remotes/origin/feat'],
				{ changes: ['config', 'heads'], refs: ['refs/heads/feat'], confined: true },
			],
			[['branch', '-D', 'feat'], { changes: ['config', 'heads'], refs: ['refs/heads/feat'], confined: true }],
			[['branch', '-d', 'feat'], { changes: ['config', 'heads'], refs: ['refs/heads/feat'], confined: true }],
			[
				['branch', '--delete', '-f', 'a', 'b'],
				{ changes: ['config', 'heads'], refs: ['refs/heads/a', 'refs/heads/b'], confined: true },
			],
			[['branch', '-r', '-d', 'origin/x'], { changes: ['remotes'], refs: ['refs/remotes/origin/x'] }],
			[
				['branch', '-m', 'a', 'b'],
				{ changes: ['config', 'heads'], refs: ['refs/heads/a', 'refs/heads/b'], confined: true },
			],
			[
				['branch', '-C', 'a', 'b'],
				{ changes: ['config', 'heads'], refs: ['refs/heads/a', 'refs/heads/b'], confined: true },
			],
		]);

		suiteOf('branch it cannot name stays unnamed', [
			// One name renames the current branch
			[['branch', '-m', 'b'], { changes: unnamedBranchConfig }],
			[['branch', '-d'], { changes: unnamedBranchConfig }],
			[['branch', '-u', 'origin/x'], { changes: unnamedBranchConfig }],
			[['branch', '--set-upstream-to=origin/x', 'x'], { changes: unnamedBranchConfig }],
			[['branch', '--unset-upstream', 'x'], { changes: unnamedBranchConfig }],
			[['branch', '--edit-description'], { changes: unnamedBranchConfig }],
			[['branch', '-t', 'x', 'origin/x'], { changes: unnamedBranchConfig }],
			[['branch', '--track', 'x', 'origin/x'], { changes: unnamedBranchConfig }],
			[['branch', '--unknown', 'x'], { changes: ['heads', 'remotes'] }],
			[['branch', 'a', 'b', 'c'], { changes: ['heads', 'remotes'] }],
			// Git expands `@{-<n>}` and `@` wherever it takes a branch name
			[['branch', '-d', 'a', '@{-1}'], { changes: unnamedBranchConfig }],
			[['branch', '-r', '-d', '@{u}'], { changes: unnamedBranchConfig }],
			[['branch', '-m', '@{-1}', 'b'], { changes: unnamedBranchConfig }],
			[['branch', '-f', '@{-1}', 'main'], { changes: ['heads', 'remotes'] }],
			[['branch', '@', sha], { changes: ['heads', 'remotes'] }],
		]);

		suiteOf('tag names the tags it writes', [
			[['tag', 'v1'], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '-f', 'v1', sha], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '-d', 'v1', 'v2'], { changes: ['tags'], refs: ['refs/tags/v1', 'refs/tags/v2'] }],
			[['tag', '--delete', 'v1'], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '-a', '-m', '-message', 'v1'], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '--message=msg', '-s', 'v1'], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '-u', 'key', '-F', 'file', 'v1', sha], { changes: ['tags'], refs: ['refs/tags/v1'] }],
			[['tag', '--trailer', 'k: v', 'v1'], { changes: ['tags'] }],
			[['tag', 'a', 'b', 'c'], { changes: ['tags'] }],
		]);

		suiteOf('worktree announces a branch only for an add that can create one', [
			[
				['worktree', 'add', '--detach', '--force', '--end-of-options', '/wt', sha],
				{ changes: ['worktrees', 'worktreeHead'] },
			],
			[['worktree', 'remove', '--force', '--end-of-options', '/wt'], { changes: ['worktrees', 'worktreeHead'] }],
			[['worktree', 'prune'], { changes: ['worktrees', 'worktreeHead'] }],
			[['worktree', 'lock', '/wt'], { changes: ['worktrees'] }],
			[['worktree', 'unlock', '/wt'], { changes: ['worktrees'] }],
			[['worktree', 'move', '/wt', '/wt2'], { changes: ['worktrees'] }],
			[['worktree', 'repair'], { changes: ['worktrees'] }],
			[['worktree', 'add', '/wt', sha], { changes: ['worktrees', 'worktreeHead'] }],
			[['worktree', 'add', '/wt', sha256], { changes: ['worktrees', 'worktreeHead'] }],
			[['worktree', 'add', '--reason', 'why', '--lock', '-d', '/wt'], { changes: ['worktrees', 'worktreeHead'] }],
			[
				['worktree', 'add', '-b', 'feat', '/wt', sha],
				{ changes: ['worktrees', 'worktreeHead', 'heads'], refs: ['refs/heads/feat'] },
			],
			[
				['worktree', 'add', '-bfeat', '/wt'],
				{ changes: ['worktrees', 'worktreeHead', 'heads'], refs: ['refs/heads/feat'] },
			],
			[
				['worktree', 'add', '-b', 'feat', '/wt', 'origin/feat'],
				{
					changes: ['config', 'worktrees', 'worktreeHead', 'heads'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
			[
				['worktree', 'add', '--no-track', '-b', 'feat', '/wt', 'origin/feat'],
				{ changes: ['worktrees', 'worktreeHead', 'heads'], refs: ['refs/heads/feat'] },
			],
			[
				['worktree', 'add', '--track', '-B', 'feat', '/wt', 'main'],
				{
					changes: ['config', 'worktrees', 'worktreeHead', 'heads'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
		]);

		suiteOf('worktree add that may DWIM a branch stays unnamed', [
			[['worktree', 'add', '/wt', 'main'], { changes: ['worktrees', 'worktreeHead', 'heads'] }],
			[['worktree', 'add', '/wt'], { changes: ['worktrees', 'worktreeHead', 'heads'] }],
			[['worktree', 'add', '--orphan', '-b', 'x', '/wt'], { changes: ['worktrees', 'worktreeHead', 'heads'] }],
			[['worktree', 'add', '-B', '@{-1}', '/wt', sha], { changes: ['worktrees', 'worktreeHead', 'heads'] }],
			[['worktree', 'add', '--unknown', '/wt', sha], { changes: ['worktrees', 'worktreeHead', 'heads'] }],
		]);

		suite('worktree keeps the paths of the worktrees it acts on', () => {
			const cases: readonly (readonly [readonly string[], readonly string[] | undefined])[] = [
				[['worktree', 'add', '--detach', '--force', '--end-of-options', '/wt', sha], ['/wt']],
				[['worktree', 'add', '-b', 'feat', 'wt', sha], ['wt']],
				[['worktree', 'add', '-bfeat', '/wt'], ['/wt']],
				[['worktree', 'add', '--reason', 'why', '--lock', '-d', '/wt'], ['/wt']],
				[['worktree', 'add', '--orphan', '-b', 'x', '/wt'], ['/wt']],
				[['worktree', 'add', '/wt', 'main'], ['/wt']],
				[['worktree', 'add', '--end-of-options', '-wt', sha], ['-wt']],
				[['worktree', 'remove', '--force', '--end-of-options', '/wt'], ['/wt']],
				[['worktree', 'remove', '-f', '-f', '/wt'], ['/wt']],
				[['worktree', 'lock', '--reason', 'why', '/wt'], ['/wt']],
				[['worktree', 'lock', '--reason=why', '/wt'], ['/wt']],
				[['worktree', 'unlock', '/wt'], ['/wt']],
				[
					['worktree', 'move', '-f', '/wt', '/wt2'],
					['/wt', '/wt2'],
				],
				[['worktree', 'add', '--unknown', '/wt', sha], undefined],
				[['worktree', 'add', '/wt', sha, 'extra'], undefined],
				[['worktree', 'add'], undefined],
				[['worktree', 'remove', '/wt', '/wt2'], undefined],
				[['worktree', 'lock', '--unknown', '/wt'], undefined],
				[['worktree', 'move', '/wt'], undefined],
				[['worktree', 'prune'], undefined],
				[['worktree', 'repair', '/wt'], undefined],
			];
			for (const [args, expected] of cases) {
				test(`'${args.join(' ')}'`, () => {
					assert.deepStrictEqual(getChangesForCommand(args)?.worktreePaths, expected);
				});
			}

			test('is never set for another verb', () => {
				assert.strictEqual(getChangesForCommand(['branch', '-d', '/wt'])?.worktreePaths, undefined);
			});
		});

		suiteOf('checkout and switch name only a branch they can create', [
			[['checkout', '--detach', sha], { changes: ['head', 'index', 'worktrees', 'worktreeHead'] }],
			[['checkout', sha], { changes: ['head', 'index', 'worktrees', 'worktreeHead'] }],
			[['checkout', sha256], { changes: ['head', 'index', 'worktrees', 'worktreeHead'] }],
			[['checkout', '--', '.'], { changes: ['index'] }],
			[['checkout', sha, '--', 'a.txt'], { changes: ['index'] }],
			[
				['checkout', 'feat'],
				{
					changes: ['config', 'head', 'heads', 'index', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
			[
				['checkout', 'feat', '--'],
				{
					changes: ['config', 'head', 'heads', 'index', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
			[
				['checkout', '-b', 'feat', 'origin/feat'],
				{
					changes: ['config', 'head', 'heads', 'index', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
			[
				['checkout', '-b', 'feat', sha],
				{ changes: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'], refs: ['refs/heads/feat'] },
			],
			[
				['checkout', '-B', 'feat', 'main', '--'],
				{ changes: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'], refs: ['refs/heads/feat'] },
			],
			[
				['checkout', '-b', 'feat', '--no-track', 'origin/feat'],
				{ changes: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'], refs: ['refs/heads/feat'] },
			],
			[
				['switch', '-c', 'feat'],
				{ changes: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'], refs: ['refs/heads/feat'] },
			],
			[
				['switch', '--create=feat', 'origin/feat'],
				{
					changes: ['config', 'head', 'heads', 'index', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
			[
				['switch', '-C', 'feat', sha],
				{ changes: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'], refs: ['refs/heads/feat'] },
			],
			[['switch', '-d', sha], { changes: ['head', 'index', 'worktrees', 'worktreeHead'] }],
			[['switch', '--detach', 'main'], { changes: ['head', 'index', 'worktrees', 'worktreeHead'] }],
			[
				['switch', 'feat'],
				{
					changes: ['config', 'head', 'heads', 'index', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/feat'],
					confined: true,
				},
			],
		]);

		suiteOf('checkout and switch they cannot name stay unnamed', [
			[['checkout', '-'], { changes: unnamedCheckout }],
			[['checkout', '@{-1}'], { changes: unnamedCheckout }],
			[['checkout', '--orphan', 'x'], { changes: unnamedCheckout }],
			[['checkout', '-t', 'origin/x'], { changes: unnamedCheckout }],
			[['checkout', '--track', 'origin/x'], { changes: unnamedCheckout }],
			[['checkout', '--guess', 'x'], { changes: unnamedCheckout }],
			[['checkout', 'a', 'b'], { changes: unnamedCheckout }],
			[['checkout'], { changes: unnamedCheckout }],
			[['switch', '-b', 'x'], { changes: unnamedCheckout }],
			[['switch', '--orphan', 'x'], { changes: unnamedCheckout }],
			[['checkout', '-B', '@{-1}', sha], { changes: unnamedCheckout }],
			[['switch', '-C', '@{-2}'], { changes: unnamedCheckout }],
		]);

		suiteOf('HEAD-branch movers flag movesHeadBranch', [
			[['reset', '--hard', sha], { changes: reset, movesHeadBranch: true }],
			[['reset'], { changes: reset, movesHeadBranch: true }],
			[['reset', sha, '--'], { changes: reset, movesHeadBranch: true }],
			[['commit', '--no-edit'], { changes: ['head', 'heads', 'index', 'pausedOp'], movesHeadBranch: true }],
			[
				['merge', '--no-edit', '--no-ff', '-m', 'msg', '--end-of-options', sha],
				{ changes: ['head', 'heads', 'index', 'pausedOp', 'merge'], movesHeadBranch: true },
			],
			[['merge', '--abort'], { changes: ['head', 'heads', 'index', 'pausedOp', 'merge'], movesHeadBranch: true }],
			[
				['cherry-pick', sha],
				{ changes: ['head', 'heads', 'index', 'pausedOp', 'cherryPick'], movesHeadBranch: true },
			],
			[['revert', sha], { changes: ['head', 'heads', 'index', 'pausedOp', 'revert'], movesHeadBranch: true }],
			[['am', 'x.patch'], { changes: ['head', 'heads', 'index', 'pausedOp'], movesHeadBranch: true }],
			[
				['pull'],
				{
					changes: [
						'head',
						'heads',
						'index',
						'remotes',
						'tags',
						'lastFetched',
						'pausedOp',
						'merge',
						'rebase',
					],
				},
			],
		]);

		suiteOf('a pathspec reset moves no ref', [
			[['reset', '--', 'a.txt'], { changes: ['index'] }],
			[['reset', '-q', sha, '--', 'a.txt'], { changes: ['index'] }],
			[['reset', '-p'], { changes: ['index'] }],
			[['reset', '--pathspec-from-file=list'], { changes: ['index'] }],
		]);

		suiteOf('rebase flags movesHeadBranch only when update-refs is provably off', [
			[
				[
					'-C',
					'/s',
					'-c',
					'rebase.updateRefs=false',
					'rebase',
					'--onto',
					sha,
					'--end-of-options',
					sha2,
					'HEAD',
				],
				{ changes: rebase, movesHeadBranch: true },
			],
			[['rebase', '--no-update-refs', 'main'], { changes: rebase, movesHeadBranch: true }],
			[['-c', 'rebase.updaterefs=OFF', 'rebase', 'main'], { changes: rebase, movesHeadBranch: true }],
			[['-c', 'Rebase.UpdateRefs=no', 'rebase', 'main'], { changes: rebase, movesHeadBranch: true }],
			[['-c', 'rebase.updateRefs=0', 'rebase', 'main'], { changes: rebase, movesHeadBranch: true }],
			[['rebase', '--update-refs', '--no-update-refs', 'main'], { changes: rebase, movesHeadBranch: true }],
			// git writes the listed refs only when the rebase finishes
			[['-C', '/s', 'rebase', '--abort'], { changes: rebase, movesHeadBranch: true }],
			[['rebase', '--quit'], { changes: rebase, movesHeadBranch: true }],
			[['-c', 'rebase.updateRefs=true', 'rebase', '--abort'], { changes: rebase, movesHeadBranch: true }],
			// The update-refs list was fixed when the rebase started
			[['-C', '/s', '-c', 'rebase.updateRefs=false', 'rebase', '--continue'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', 'rebase', '--skip'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', 'rebase', '--edit-todo'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--continue'], { changes: rebase }],
			[['rebase', 'main'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', 'rebase', '--update-refs', 'main'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', '-c', 'rebase.updateRefs=true', 'rebase', 'main'], { changes: rebase }],
			// A bare `-c key` is git's `true`
			[['-c', 'rebase.updateRefs', 'rebase', 'main'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', 'rebase', '-i', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--exec', 'make', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--exec=make', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--exe=make', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--ex=make', 'main'], { changes: rebase }],
			// Git takes any unique prefix of a long option, and bundles short ones
			[['-c', 'rebase.updateRefs=false', 'rebase', '--update-ref', 'main'], { changes: rebase }],
			[['-c', 'rebase.updateRefs=false', 'rebase', '--cont'], { changes: rebase }],
			[['rebase', '--no-update-refs', '--inter', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '-ri', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '-xmake', 'main'], { changes: rebase }],
			[['rebase', '--no-update-refs', '-r', '-q', 'main'], { changes: rebase, movesHeadBranch: true }],
		]);

		suiteOf('stash names refs/stash for what moves it', [
			[
				['stash', 'push', '--include-untracked', '-m', 'compose backup'],
				{ changes: ['stash', 'index'], refs: ['refs/stash'] },
			],
			[['stash'], { changes: ['stash', 'index'], refs: ['refs/stash'] }],
			[['stash', '-u'], { changes: ['stash', 'index'], refs: ['refs/stash'] }],
			[['stash', 'save', 'msg'], { changes: ['stash', 'index'], refs: ['refs/stash'] }],
			[['stash', 'pop', '--index', 'stash@{0}'], { changes: ['stash', 'index'], refs: ['refs/stash'] }],
			[['stash', 'drop', 'stash@{1}'], { changes: ['stash'], refs: ['refs/stash'] }],
			[['stash', 'clear'], { changes: ['stash'], refs: ['refs/stash'] }],
			[['stash', 'store', sha], { changes: ['stash'], refs: ['refs/stash'] }],
			[['stash', 'apply', sha], { changes: ['index'] }],
			[['stash', 'create'], undefined],
			// Creates the branch from a commit, checks it out, and drops the stash once applied
			[
				['stash', 'branch', 'x', 'stash@{1}'],
				{
					changes: ['head', 'heads', 'index', 'stash', 'worktrees', 'worktreeHead'],
					refs: ['refs/heads/x', 'refs/stash'],
				},
			],
			[['stash', 'branch'], { changes: ['stash', 'index'] }],
			[['stash', 'branch', '@{-1}', 'stash@{1}'], { changes: ['stash', 'index'] }],
		]);

		suiteOf('index-only writes are unchanged', [
			[['read-tree', '-m', '-u', '--end-of-options', sha, sha2], { changes: ['index'] }],
			[['clean', '-fd'], { changes: ['index'] }],
			[['apply', '--allow-binary-replacement'], { changes: ['index'] }],
		]);

		test("a '-C'-scoped named write carries pathOverride and shares only its shared kinds", () => {
			const branch = getChangesForCommand(['-C', '/other', 'checkout', '-b', 'feat', 'origin/feat']);
			assert.strictEqual(branch?.pathOverride, '/other');
			assert.deepStrictEqual(branch?.sharedChanges, ['config', 'heads', 'worktrees', 'worktreeHead']);
			assert.deepStrictEqual(branch?.refs, ['refs/heads/feat']);

			const commit = getChangesForCommand(['-C', '/other', 'commit', '--no-edit']);
			assert.strictEqual(commit?.pathOverride, '/other');
			assert.deepStrictEqual(commit?.sharedChanges, ['heads']);
			assert.strictEqual(commit?.movesHeadBranch, true);

			const detach = getChangesForCommand(['-C', '/other', 'checkout', '--detach', sha]);
			assert.deepStrictEqual(detach?.sharedChanges, ['worktrees', 'worktreeHead']);
		});

		test('a commit on a branch shares only heads, so siblings are not woken by it', () => {
			const commit = getChangesForCommand(['commit', '--no-edit']);
			assert.deepStrictEqual(commit?.sharedChanges, ['heads']);
			assert.strictEqual(commit?.changes.includes('worktreeHead'), false);
		});

		test("leadingCommand captures each '-c' config before the verb", () => {
			assert.deepStrictEqual(
				leadingCommand(['-c', 'a=b', '-C', '/x', '-c', 'rebase.updateRefs=false', 'rebase']).configs,
				['a=b', 'rebase.updateRefs=false'],
			);
		});
	});

	suite('mayWriteTracking', () => {
		test('a remote-tracking start point may write tracking', () => {
			assert.strictEqual(mayWriteTracking('origin/main', undefined), true);
			assert.strictEqual(mayWriteTracking('refs/remotes/origin/main', false), true);
		});

		test('a local start point, HEAD, a sha or noTracking writes none', () => {
			assert.strictEqual(mayWriteTracking(undefined, undefined), false);
			assert.strictEqual(mayWriteTracking('main', undefined), false);
			assert.strictEqual(mayWriteTracking('HEAD', undefined), false);
			assert.strictEqual(mayWriteTracking('0123456789abcdef0123456789abcdef01234567', undefined), false);
			assert.strictEqual(mayWriteTracking('refs/heads/feature/x', undefined), false);
			assert.strictEqual(mayWriteTracking('origin/main', true), false);
		});
	});
});
