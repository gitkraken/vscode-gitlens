import * as assert from 'assert';
import type { GraphExcludeRefs, GraphRefOptData } from '../../../../plus/graph/protocol.js';
import {
	compareGraphRefOpts,
	getExcludedRemotes,
	getHiddenRefLabel,
	getHiddenRefSortKey,
} from '../hiddenRefs.utils.js';

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

	test('a remote-wide hide with exceptions reads as "all branches but N"', () => {
		assert.deepStrictEqual(
			getHiddenRefLabel(ref({ type: 'remote', owner: 'upstream', name: '*', except: ['id-1', 'id-2'] })),
			{ name: 'upstream', suffix: 'all branches but 2' },
		);
	});

	test('a remote-wide hide with an EMPTY exceptions array still reads as "all branches"', () => {
		assert.deepStrictEqual(getHiddenRefLabel(ref({ type: 'remote', owner: 'upstream', name: '*', except: [] })), {
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

suite('getExcludedRemotes', () => {
	test('extracts owners from wildcard entries', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/*': ref({ type: 'remote', owner: 'origin', name: '*' }),
			'/repo|remotes/upstream/*': ref({ type: 'remote', owner: 'upstream', name: '*' }),
		};

		assert.deepStrictEqual([...(getExcludedRemotes(excludeRefs)?.keys() ?? [])].sort(), ['origin', 'upstream']);
	});

	test('ignores non-wildcard remote entries, heads, and tags', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/main': ref({ type: 'remote', owner: 'origin', name: 'main' }),
			'/repo|heads/main': ref({ type: 'head', name: 'main' }),
			'/repo|tags/v1': ref({ type: 'tag', name: 'v1' }),
		};

		assert.strictEqual(getExcludedRemotes(excludeRefs), undefined);
	});

	test('returns undefined for undefined, empty, or no-wildcard input', () => {
		assert.strictEqual(getExcludedRemotes(undefined), undefined);
		assert.strictEqual(getExcludedRemotes({}), undefined);
		assert.strictEqual(getExcludedRemotes({ '/repo|heads/main': ref({ type: 'head', name: 'main' }) }), undefined);
	});

	test('a wildcard with no `except` yields empty exceptIds/exceptNames sets', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/*': ref({ type: 'remote', owner: 'origin', name: '*' }),
		};

		const entry = getExcludedRemotes(excludeRefs)?.get('origin');
		assert.strictEqual(entry?.exceptIds.size, 0);
		assert.strictEqual(entry?.exceptNames.size, 0);
	});

	test('parses except ids into bare branch names, including nested paths', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/*': ref({
				type: 'remote',
				owner: 'origin',
				name: '*',
				except: ['/repo|remotes/origin/dev', '/repo|remotes/origin/feat/x'],
			}),
		};

		const entry = getExcludedRemotes(excludeRefs)?.get('origin');
		assert.deepStrictEqual([...(entry?.exceptIds ?? [])].sort(), [
			'/repo|remotes/origin/dev',
			'/repo|remotes/origin/feat/x',
		]);
		assert.deepStrictEqual([...(entry?.exceptNames ?? [])].sort(), ['dev', 'feat/x']);
	});

	test('an unparsable except id is kept in exceptIds but skipped from exceptNames', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/*': ref({
				type: 'remote',
				owner: 'origin',
				name: '*',
				except: ['not-a-remote-id'],
			}),
		};

		const entry = getExcludedRemotes(excludeRefs)?.get('origin');
		assert.deepStrictEqual([...(entry?.exceptIds ?? [])], ['not-a-remote-id']);
		assert.strictEqual(entry?.exceptNames.size, 0);
	});

	test('returns the same Map instance for the same input object (memoized)', () => {
		const excludeRefs: GraphExcludeRefs = {
			'/repo|remotes/origin/*': ref({ type: 'remote', owner: 'origin', name: '*' }),
		};

		assert.strictEqual(getExcludedRemotes(excludeRefs), getExcludedRemotes(excludeRefs));
	});
});
