import * as assert from 'assert';
import { join } from 'node:path';
import { getChangesForCommand, leadingCommand } from '../commandClassifier.js';

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

		test("'worktree add' notifies worktrees + heads", () => {
			const result = getChangesForCommand(['worktree', 'add', '/wt', 'main']);
			assert.deepStrictEqual(result?.changes, ['worktrees', 'heads']);
			assert.deepStrictEqual(result?.sharedChanges, ['worktrees', 'heads']);
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
			assert.deepStrictEqual(result?.changes, ['heads', 'remotes', 'tags']);
			assert.deepStrictEqual(result?.sharedChanges, ['heads', 'remotes', 'tags']);
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
});
