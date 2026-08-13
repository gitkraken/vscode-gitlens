import * as assert from 'assert';
import type { GraphExcludeRefs } from '../../../../../plus/graph/protocol.js';
import { findWildcardRemoteExclude } from '../branchSheet.utils.js';

function wildcard(owner: string): GraphExcludeRefs[string] {
	return { id: `/repo|remotes/${owner}/*`, name: '*', type: 'remote', owner: owner };
}

suite('findWildcardRemoteExclude', () => {
	test('finds the wildcard entry covering the given owner', () => {
		const excludeRefs: GraphExcludeRefs = { '/repo|remotes/origin/*': wildcard('origin') };

		assert.deepStrictEqual(findWildcardRemoteExclude(excludeRefs, 'origin'), wildcard('origin'));
	});

	test('returns undefined when no wildcard entry exists', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/main': {
				id: '/repo|remotes/origin/main',
				name: 'main',
				type: 'remote',
				owner: 'origin',
			},
		};

		assert.strictEqual(findWildcardRemoteExclude(excludeRefs, 'origin'), undefined);
	});

	test('returns undefined for undefined excludeRefs or owner', () => {
		const excludeRefs: GraphExcludeRefs = { '/repo|remotes/origin/*': wildcard('origin') };

		assert.strictEqual(findWildcardRemoteExclude(undefined, 'origin'), undefined);
		assert.strictEqual(findWildcardRemoteExclude(excludeRefs, undefined), undefined);
	});

	test('returns undefined when the wildcard covers a different owner', () => {
		const excludeRefs: GraphExcludeRefs = { '/repo|remotes/origin/*': wildcard('origin') };

		assert.strictEqual(findWildcardRemoteExclude(excludeRefs, 'upstream'), undefined);
	});
});
