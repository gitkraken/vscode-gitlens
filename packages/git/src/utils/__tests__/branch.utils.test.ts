import * as assert from 'assert';
import { getRemoteNameSlashIndex, isDetachedHead, parseRefName, parseUpstream } from '../branch.utils.js';

suite('Branch Utils Test Suite', () => {
	suite('parseUpstream', () => {
		// KEY ORDER IS A CONTRACT, not a style choice. These objects are handed straight to
		// `createReference` and serialized with a bare `JSON.stringify` into the graph's ref-pill
		// `data-vscode-context`, and the webview rebuilds the same payload from the wire
		// (`webviews/apps/plus/graph/utils/refContext.utils.ts`). A reordering here silently changes the
		// bytes on one side only, so a `when` clause could match on a ref pill and not in Inspect.
		// `providers/branches.ts` re-spreads this object, which preserves whatever order it is given —
		// meaning this function is the single place the order is actually decided.
		test('yields name, missing, state in that order — both arms', () => {
			assert.deepStrictEqual(Object.keys(parseUpstream('refs/remotes/origin/main', '[ahead 3]')!), [
				'name',
				'missing',
				'state',
			]);
			// The no-match arm is a separate literal and drifts independently.
			assert.deepStrictEqual(Object.keys(parseUpstream('refs/remotes/origin/main', '')!), [
				'name',
				'missing',
				'state',
			]);
		});

		test('state is ahead then behind', () => {
			assert.deepStrictEqual(
				Object.keys(parseUpstream('refs/remotes/origin/main', '[ahead 3, behind 1]')!.state),
				['ahead', 'behind'],
			);
		});

		test('parses ahead only', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[ahead 3]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 3, behind: 0 },
			});
		});

		test('parses behind only', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[behind 2]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 2 },
			});
		});

		test('parses both ahead and behind', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[ahead 3, behind 2]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 3, behind: 2 },
			});
		});

		test('parses gone upstream', () => {
			const result = parseUpstream('refs/remotes/origin/main', '[gone]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: true,
				state: { ahead: 0, behind: 0 },
			});
		});

		test('returns ahead:0 behind:0 for empty tracking string', () => {
			const result = parseUpstream('refs/remotes/origin/main', '');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 0 },
			});
		});

		test('returns undefined for empty upstream string', () => {
			const result = parseUpstream('', '[ahead 1]');
			assert.strictEqual(result, undefined);
		});

		test('strips refs/remotes/ prefix from upstream name', () => {
			const result = parseUpstream('refs/remotes/origin/feature', '');
			assert.strictEqual(result?.name, 'origin/feature');
		});

		test('strips refs/heads/ prefix from upstream name', () => {
			const result = parseUpstream('refs/heads/main', '');
			assert.strictEqual(result?.name, 'main');
		});

		test('treats non-numeric ahead/behind as 0', () => {
			// The regex only captures digits, so non-numeric values won't match
			// and the capture group will be undefined, resulting in 0
			const result = parseUpstream('refs/remotes/origin/main', '[ahead abc]');
			assert.deepStrictEqual(result, {
				name: 'origin/main',
				missing: false,
				state: { ahead: 0, behind: 0 },
			});
		});
	});

	suite('parseRefName', () => {
		test('strips refs/heads/ and returns remote:false', () => {
			const result = parseRefName('refs/heads/main');
			assert.deepStrictEqual(result, { name: 'main', remote: false });
		});

		test('strips refs/remotes/ and returns remote:true', () => {
			const result = parseRefName('refs/remotes/origin/main');
			assert.deepStrictEqual(result, { name: 'origin/main', remote: true });
		});

		test('strips heads/ prefix without refs/', () => {
			const result = parseRefName('heads/feature');
			assert.deepStrictEqual(result, { name: 'feature', remote: false });
		});

		test('strips remotes/ prefix without refs/', () => {
			const result = parseRefName('remotes/origin/feature');
			assert.deepStrictEqual(result, { name: 'origin/feature', remote: true });
		});

		test('returns plain name unchanged with remote:false', () => {
			const result = parseRefName('plainname');
			assert.deepStrictEqual(result, { name: 'plainname', remote: false });
		});

		test('is case-insensitive for prefix matching', () => {
			const result = parseRefName('Refs/Heads/main');
			assert.deepStrictEqual(result, { name: 'main', remote: false });
		});
	});

	suite('getRemoteNameSlashIndex', () => {
		test('returns index of first slash for plain remote/branch', () => {
			const result = getRemoteNameSlashIndex('origin/main');
			assert.strictEqual(result, 6);
		});

		test('returns index of slash after remotes/ prefix', () => {
			// 'remotes/' is 8 chars, so indexOf('/', 8) finds the '/' at index 14
			const result = getRemoteNameSlashIndex('remotes/origin/main');
			assert.strictEqual(result, 14);
		});

		test('returns -1 when there is no slash', () => {
			const result = getRemoteNameSlashIndex('feature');
			assert.strictEqual(result, -1);
		});

		test('returns -1 when remotes/ has no second slash', () => {
			const result = getRemoteNameSlashIndex('remotes/origin');
			assert.strictEqual(result, -1);
		});
	});

	suite('isDetachedHead', () => {
		test('returns true for HEAD', () => {
			assert.strictEqual(isDetachedHead('HEAD'), true);
		});

		test('returns true for parenthesized hash', () => {
			assert.strictEqual(isDetachedHead('(abc1234...)'), true);
		});

		test('returns false for normal branch name', () => {
			assert.strictEqual(isDetachedHead('main'), false);
		});

		test('returns true for empty string (trimmed to zero length)', () => {
			assert.strictEqual(isDetachedHead(''), true);
		});

		test('returns true for whitespace-only string', () => {
			assert.strictEqual(isDetachedHead('  HEAD  '), true);
		});

		test('returns false for feature branch with slash', () => {
			assert.strictEqual(isDetachedHead('feature/branch'), false);
		});

		test('returns true for detached-at message in parentheses', () => {
			assert.strictEqual(isDetachedHead('(HEAD detached at abc1234)'), true);
		});

		test('returns true for the rest of git’s "no branch" states', () => {
			assert.strictEqual(isDetachedHead('(HEAD detached from abc1234)'), true);
			assert.strictEqual(isDetachedHead('(no branch)'), true);
			assert.strictEqual(isDetachedHead('(no branch, rebasing feature)'), true);
			assert.strictEqual(isDetachedHead('(no branch, bisect started on main)'), true);
		});

		test("returns true for porcelain v2's branch.head token", () => {
			// `git status --porcelain=v2 --branch` prints `# branch.head (detached)` for ANY
			// non-branch HEAD (plain detached, rebase, bisect) and the status parser passes the
			// token through verbatim — `GitStatus.detached` depends on this match.
			assert.strictEqual(isDetachedHead('(detached)'), true);
		});

		test('returns false for real branch names that happen to be parenthesized', () => {
			// Parentheses are legal in ref names — all three are branches `git check-ref-format
			// --branch` accepts and a user can be checked out on. Treating them as detached made
			// `GitBranch` rewrite the name to the synthesized `(sha…)` label and re-key the id by SHA,
			// corrupting the branch's identity everywhere downstream.
			assert.strictEqual(isDetachedHead('(release)'), false);
			assert.strictEqual(isDetachedHead('v1.0(rc)'), false);
			assert.strictEqual(isDetachedHead('feat/(wip)'), false);
		});
	});
});
