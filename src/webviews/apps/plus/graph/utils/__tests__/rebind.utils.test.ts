import * as assert from 'assert';
import type { GraphScope } from '../../../../../plus/graph/protocol.js';
import { restampId, restampScope } from '../rebind.utils.js';

suite('restampId', () => {
	test('re-stamps an id carrying the exact fromRepoPath prefix', () => {
		assert.strictEqual(restampId('/repo|heads/main', '/repo', '/wt'), '/wt|heads/main');
	});

	test('re-stamps a remote-ref id', () => {
		assert.strictEqual(restampId('/repo|remotes/origin/main', '/repo', '/wt'), '/wt|remotes/origin/main');
	});

	test('leaves an id with an unrelated repo path unchanged', () => {
		assert.strictEqual(restampId('/other|heads/main', '/repo', '/wt'), '/other|heads/main');
	});

	// Guard against a prefix collision: `/repo2` must not be mistaken for `/repo` just because it
	// starts with the same characters — the match requires the `|` delimiter right after `fromRepoPath`.
	test('does not match a path that merely starts with fromRepoPath', () => {
		assert.strictEqual(restampId('/repo2|heads/main', '/repo', '/wt'), '/repo2|heads/main');
	});

	test('is a no-op when fromRepoPath === toRepoPath', () => {
		assert.strictEqual(restampId('/repo|heads/main', '/repo', '/repo'), '/repo|heads/main');
	});
});

suite('restampScope', () => {
	function makeScope(overrides?: Partial<GraphScope>): GraphScope {
		return {
			branchName: 'main',
			branchRef: '/repo|heads/main',
			upstreamRef: '/repo|remotes/origin/main',
			additionalBranchRefs: ['/repo|heads/feature-a', '/repo|heads/feature-b'],
			focalBranchTipSha: 'a'.repeat(40),
			mergeTargetTipSha: 'b'.repeat(40),
			mergeBase: { sha: 'c'.repeat(40), date: 1234 },
			origin: { kind: 'worktree', path: '/repo' },
			...overrides,
		};
	}

	test('re-stamps branchRef, upstreamRef, and every additionalBranchRefs entry', () => {
		const result = restampScope(makeScope(), '/repo', '/wt');

		assert.strictEqual(result.branchRef, '/wt|heads/main');
		assert.strictEqual(result.upstreamRef, '/wt|remotes/origin/main');
		assert.deepStrictEqual(result.additionalBranchRefs, ['/wt|heads/feature-a', '/wt|heads/feature-b']);
	});

	test('preserves origin, branchName, and SHA-based anchors unchanged', () => {
		const scope = makeScope();
		const result = restampScope(scope, '/repo', '/wt');

		assert.strictEqual(result.branchName, scope.branchName);
		assert.deepStrictEqual(result.origin, scope.origin);
		assert.strictEqual(result.focalBranchTipSha, scope.focalBranchTipSha);
		assert.strictEqual(result.mergeTargetTipSha, scope.mergeTargetTipSha);
		assert.deepStrictEqual(result.mergeBase, scope.mergeBase);
	});

	test('leaves undefined upstreamRef/additionalBranchRefs undefined', () => {
		const scope = makeScope({ upstreamRef: undefined, additionalBranchRefs: undefined });
		const result = restampScope(scope, '/repo', '/wt');

		assert.strictEqual(result.upstreamRef, undefined);
		assert.strictEqual(result.additionalBranchRefs, undefined);
	});

	test('returns the same scope reference when fromRepoPath === toRepoPath', () => {
		const scope = makeScope();
		assert.strictEqual(restampScope(scope, '/repo', '/repo'), scope);
	});
});
