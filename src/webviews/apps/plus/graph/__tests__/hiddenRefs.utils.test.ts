import * as assert from 'assert';
import type { GraphRefOptData } from '../../../../plus/graph/protocol.js';
import { compareGraphRefOpts, getHiddenRefLabel, getHiddenRefSortKey } from '../hiddenRefs.utils.js';

function ref(overrides: Partial<GraphRefOptData> & Pick<GraphRefOptData, 'type' | 'name'>): GraphRefOptData {
	return { id: `${overrides.owner ?? ''}${overrides.name}:${overrides.type}`, ...overrides };
}

suite('getHiddenRefLabel', () => {
	test('a local branch is just its name', () => {
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'head', name: 'debt/git-ops-perf' })), {
			name: 'debt/git-ops-perf',
		});
	});

	test('a tag is just its name', () => {
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'tag', name: 'v17.4.0' })), { name: 'v17.4.0' });
	});

	test('a remote branch carries its owner as a prefix', () => {
		// Remote branches are stored WITHOUT the remote prefix, so the owner is the only disambiguator.
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'remote', owner: 'origin', name: 'main' })), {
			owner: 'origin/',
			name: 'main',
		});
	});

	test('a remote-wide hide reads as the remote, not a bare `*`', () => {
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'remote', owner: 'upstream', name: '*' })), {
			name: 'upstream',
			suffix: 'all branches',
		});
	});

	test('a remote with no owner falls back to the bare name', () => {
		// Legacy stored entries predate `owner` being written; they must still render something.
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'remote', name: 'origin/main' })), {
			name: 'origin/main',
		});
	});

	test('same-named branches on different remotes produce distinct labels', () => {
		const origin = getHiddenRefLabel(ref({ type: 'remote', owner: 'origin', name: 'main' }));
		const upstream = getHiddenRefLabel(ref({ type: 'remote', owner: 'upstream', name: 'main' }));
		assert.notDeepStrictEqual(origin, upstream);
	});
});

suite('getHiddenRefSortKey', () => {
	test('composes owner and name for a remote branch', () => {
		assert.strictEqual(getHiddenRefSortKey(ref({ type: 'remote', owner: 'origin', name: 'main' })), 'origin/main');
	});

	test('a remote-wide hide sorts as the bare remote, ahead of its branches', () => {
		const all = getHiddenRefSortKey(ref({ type: 'remote', owner: 'origin', name: '*' }));
		assert.strictEqual(all, 'origin');
		assert.ok(all.localeCompare(getHiddenRefSortKey(ref({ type: 'remote', owner: 'origin', name: 'main' }))) < 0);
	});
});

suite('compareGraphRefOpts', () => {
	test('groups by type — remotes, then locals, then tags', () => {
		const sorted = [
			ref({ type: 'tag', name: 'v17.4.0' }),
			ref({ type: 'head', name: 'main' }),
			ref({ type: 'remote', owner: 'origin', name: 'main' }),
		]
			.sort(compareGraphRefOpts)
			.map(r => r.type);

		assert.deepStrictEqual(sorted, ['remote', 'head', 'tag']);
	});

	test('sorts by the composed owner/name within a type', () => {
		const sorted = [
			ref({ type: 'remote', owner: 'upstream', name: 'main' }),
			ref({ type: 'remote', owner: 'origin', name: 'zebra' }),
			ref({ type: 'remote', owner: 'origin', name: 'main' }),
		]
			.sort(compareGraphRefOpts)
			.map(getHiddenRefSortKey);

		assert.deepStrictEqual(sorted, ['origin/main', 'origin/zebra', 'upstream/main']);
	});

	test('a worktree ref sorts last rather than comparing as NaN', () => {
		// `worktree` is unreachable through the stored filters, but it's in the wire union — an unranked
		// type would make every comparison NaN and silently leave the whole list unsorted.
		const sorted = [
			ref({ type: 'worktree', name: 'wt' }),
			ref({ type: 'tag', name: 'v1' }),
			ref({ type: 'remote', owner: 'origin', name: 'main' }),
		]
			.sort(compareGraphRefOpts)
			.map(r => r.type);

		assert.deepStrictEqual(sorted, ['remote', 'tag', 'worktree']);
	});
});
