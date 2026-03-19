import * as assert from 'assert';
import { getRemoteNameSlashIndex, isDetachedHead, parseRefName, parseUpstream } from '../branch.utils.js';

suite('Branch Utils Test Suite', () => {
	suite('parseUpstream', () => {
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
	});
});
