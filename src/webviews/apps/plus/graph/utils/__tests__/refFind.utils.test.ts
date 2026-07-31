import * as assert from 'assert';
import type { emptySetMarker, GraphRefOptData } from '../../../../../plus/graph/protocol.js';
import type { RefFindCandidate, RefFindMatch } from '../refFind.utils.js';
import {
	buildRefFindCandidates,
	elideRefName,
	matchRefs,
	pickInitialTargetIndex,
	refreshMatchRows,
	stepMatchIndex,
} from '../refFind.utils.js';

function branch(name: string, sha: string | undefined, extra?: { date?: number; current?: boolean }) {
	return { name: name, sha: sha, current: extra?.current ?? false, remote: false, date: extra?.date };
}

function remote(name: string, branches: { name: string; sha?: string }[]) {
	return { name: name, isDefault: true, branches: branches };
}

function tag(name: string, sha: string | undefined, date?: number) {
	return { name: name, sha: sha, annotated: false, date: date };
}

function optData(name: string, type: GraphRefOptData['type']): GraphRefOptData {
	return { id: `/repo|${type}/${name}`, name: name, type: type };
}

function match(candidate: Partial<RefFindMatch> & { name: string; score: number }): RefFindMatch {
	return {
		name: candidate.name,
		sha: candidate.sha ?? candidate.name,
		kind: candidate.kind ?? 'head',
		date: candidate.date,
		current: candidate.current,
		rowIndex: candidate.rowIndex,
		score: candidate.score,
	};
}

/** Ranks names against a query the way the widget does, strongest first. */
function rank(query: string, names: string[]): string[] {
	const candidates: RefFindCandidate[] = names.map(n => ({ name: n, sha: n, kind: 'head' }));
	return matchRefs(query, candidates, () => undefined)
		.slice()
		.sort((a, b) => b.score - a.score)
		.map(m => m.name);
}

suite('buildRefFindCandidates', () => {
	test('projects branches, remotes, and tags into one list', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-main', { current: true })],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-origin-main' }])],
			tags: [tag('v1.0.0', 'sha-tag')],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.name, c.sha]),
			[
				['head', 'main', 'sha-main'],
				['remote', 'origin/main', 'sha-origin-main'],
				['tag', 'v1.0.0', 'sha-tag'],
			],
		);
		assert.strictEqual(candidates[0].current, true);
	});

	test('qualifies remote branch names with their remote', () => {
		// The remotes panel ships names WITHOUT the remote prefix (getBranchNameWithoutRemote).
		const candidates = buildRefFindCandidates({
			remotes: [remote('upstream', [{ name: 'feature/x', sha: 'sha' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => c.name),
			['upstream/feature/x'],
		);
	});

	test('drops refs with no tip sha', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('no-sha', undefined), branch('ok', 'sha')],
			tags: [tag('dangling', undefined)],
		});

		assert.deepStrictEqual(
			candidates.map(c => c.name),
			['ok'],
		);
	});

	test('drops whole categories via excludeTypes', () => {
		const sources = {
			branches: [branch('main', 'a')],
			remotes: [remote('origin', [{ name: 'main', sha: 'b' }])],
			tags: [tag('v1', 'c')],
		};

		assert.deepStrictEqual(
			buildRefFindCandidates(sources, { excludeTypes: { remotes: true, tags: true } }).map(c => c.name),
			['main'],
		);
		assert.deepStrictEqual(
			buildRefFindCandidates(sources, { excludeTypes: { heads: true } }).map(c => c.kind),
			['remote', 'tag'],
		);
	});

	test('drops individually excluded refs, matching on name and type', () => {
		const candidates = buildRefFindCandidates(
			{ branches: [branch('main', 'a'), branch('dev', 'b')], tags: [tag('main', 'c')] },
			{ excludeRefs: { '/repo|heads/main': optData('main', 'head') } },
		);

		// The tag named `main` survives — the exclusion is keyed on kind as well as name.
		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.name]),
			[
				['head', 'dev'],
				['tag', 'main'],
			],
		);
	});

	test('restricts to includeOnlyRefs when present', () => {
		const candidates = buildRefFindCandidates(
			{ branches: [branch('main', 'a'), branch('dev', 'b'), branch('release', 'c')] },
			{ includeOnlyRefs: { '/repo|heads/dev': optData('dev', 'head') } },
		);

		assert.deepStrictEqual(
			candidates.map(c => c.name),
			['dev'],
		);
	});

	test('an include filter holding only the empty-set marker admits nothing', () => {
		// `{ [emptySetMarker]: … }` means "filtering applied, zero matches" — distinct from `{}`.
		const candidates = buildRefFindCandidates(
			{ branches: [branch('main', 'a')] },
			{
				includeOnlyRefs: {
					['gk.empty-set-marker' satisfies typeof emptySetMarker]: {} as unknown as GraphRefOptData,
				},
			},
		);

		assert.deepStrictEqual(candidates, []);
	});

	test('an empty filter map is not a filter', () => {
		const candidates = buildRefFindCandidates({ branches: [branch('main', 'a')] }, { includeOnlyRefs: {} });

		assert.deepStrictEqual(
			candidates.map(c => c.name),
			['main'],
		);
	});

	test('dedupes refs sharing a kind and name', () => {
		const candidates = buildRefFindCandidates({
			remotes: [remote('origin', [{ name: 'main', sha: 'a' }]), remote('origin', [{ name: 'main', sha: 'b' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => c.sha),
			['a'],
		);
	});
});

suite('matchRefs', () => {
	const candidates: RefFindCandidate[] = [
		{ name: 'graph-a', sha: 'a', kind: 'head' },
		{ name: 'graph-b', sha: 'b', kind: 'head' },
		{ name: 'graph-c', sha: 'c', kind: 'head' },
	];

	test('an empty query matches nothing', () => {
		assert.deepStrictEqual(
			matchRefs('', candidates, () => 0),
			[],
		);
		assert.deepStrictEqual(
			matchRefs('   ', candidates, () => 0),
			[],
		);
	});

	test('matches substrings, NOT subsequences', () => {
		// The whole point of substring matching: `find` must not drag in `related-indexing` via a
		// scattered f…i…n…d, which is what subsequence matching did (362 of 1105 refs for `gra`).
		const names = ['feature/graph-ref-find', 'feature/related-indexing', 'feature/combined-diff'];

		assert.deepStrictEqual(rank('find', names), ['feature/graph-ref-find']);
	});

	test('all whitespace-separated terms must match', () => {
		const names = ['feature/graph-ref-find', 'feature/graph-columns', 'bug/ref-pills'];

		assert.deepStrictEqual(rank('graph ref', names), ['feature/graph-ref-find']);
	});

	test('ranks exact name, then prefix, then last segment, then anywhere', () => {
		const names = ['origin/main', 'maintenance', 'main', 'feature/domain-model'];

		assert.deepStrictEqual(rank('main', names), ['main', 'maintenance', 'origin/main', 'feature/domain-model']);
	});

	test('is case-insensitive', () => {
		assert.deepStrictEqual(rank('GRAPH', ['feature/Graph-Nav']), ['feature/Graph-Nav']);
	});

	test('matches abbreviated path segments in order', () => {
		// The headline case: `d/f/foo` should find `debt/feature/foo`.
		const names = ['debt/feature/foo', 'debt/other/bar', 'feature/foo'];

		assert.deepStrictEqual(rank('d/f/foo', names), ['debt/feature/foo']);
	});

	test('allows skipped segments, so a remote copy still matches', () => {
		const names = ['debt/feature/foo', 'origin/debt/feature/foo', 'unrelated/thing'];

		// Both match; the local one ranks first because nothing had to be skipped to reach it.
		assert.deepStrictEqual(rank('d/f/foo', names), ['debt/feature/foo', 'origin/debt/feature/foo']);
	});

	test('segment order is significant', () => {
		assert.deepStrictEqual(rank('f/d/foo', ['debt/feature/foo']), []);
	});

	test('every term segment must find a segment', () => {
		assert.deepStrictEqual(rank('d/f/nope', ['debt/feature/foo']), []);
	});

	test('ranks naming the leaf above stopping short of it', () => {
		const names = ['debt/feature/foo', 'debt/feature/foo-extra-long-tail'];

		assert.deepStrictEqual(rank('d/f/foo', names), ['debt/feature/foo', 'debt/feature/foo-extra-long-tail']);
	});

	test('a mid-segment hit still matches, ranked below a prefix hit', () => {
		const names = ['debt/feature/graph-ref-find', 'debt/feature/refactor'];

		// `ref` prefixes `refactor` but only appears mid-name in `graph-ref-find`.
		assert.deepStrictEqual(rank('d/f/ref', names), ['debt/feature/refactor', 'debt/feature/graph-ref-find']);
	});

	test('the weakest term decides the score', () => {
		// `main` is an exact whole-name hit (1.0); the segment term is weaker, so it must not inherit 1.0.
		const [exact] = matchRefs('main', [{ name: 'main', sha: 'a', kind: 'head' }], () => undefined);
		const [segment] = matchRefs('main d/f', [{ name: 'main', sha: 'a', kind: 'head' }], () => undefined);

		assert.strictEqual(exact.score, 1);
		assert.strictEqual(segment, undefined);
	});

	test('orders loaded matches by row index, not by score', () => {
		const rows = new Map([
			['a', 9],
			['b', 2],
			['c', 5],
		]);
		const matches = matchRefs('graph', candidates, sha => rows.get(sha));

		assert.deepStrictEqual(
			matches.map(m => m.name),
			['graph-b', 'graph-c', 'graph-a'],
		);
	});

	test('unloaded matches trail loaded ones, newest first', () => {
		const dated: RefFindCandidate[] = [
			{ name: 'graph-old', sha: 'old', kind: 'tag', date: 100 },
			{ name: 'graph-new', sha: 'new', kind: 'tag', date: 900 },
			{ name: 'graph-loaded', sha: 'loaded', kind: 'head' },
		];
		const matches = matchRefs('graph', dated, sha => (sha === 'loaded' ? 4 : undefined));

		assert.deepStrictEqual(
			matches.map(m => m.name),
			['graph-loaded', 'graph-new', 'graph-old'],
		);
	});

	test('dateless unloaded matches sort last, then by name', () => {
		const mixed: RefFindCandidate[] = [
			{ name: 'graph-z', sha: 'z', kind: 'remote' },
			{ name: 'graph-dated', sha: 'd', kind: 'tag', date: 5 },
			{ name: 'graph-a', sha: 'a', kind: 'remote' },
		];
		const matches = matchRefs('graph', mixed, () => undefined);

		assert.deepStrictEqual(
			matches.map(m => m.name),
			['graph-dated', 'graph-a', 'graph-z'],
		);
	});

	test('reports the row index it resolved for each match', () => {
		const matches = matchRefs('graph', candidates, sha => (sha === 'b' ? 7 : undefined));
		const b = matches.find(m => m.sha === 'b');

		assert.strictEqual(b?.rowIndex, 7);
		assert.strictEqual(matches.find(m => m.sha === 'a')?.rowIndex, undefined);
	});
});

suite('refreshMatchRows', () => {
	test('promotes a newly-loaded ref out of the unloaded tail and back into graph order', () => {
		const matches = [
			match({ name: 'loaded', score: 0.5, rowIndex: 10 }),
			match({ name: 'was-unloaded', score: 0.9, date: 500 }),
		];

		// The row for `was-unloaded` has now paged in ABOVE the other one.
		const refreshed = refreshMatchRows(matches, sha => (sha === 'was-unloaded' ? 3 : 10));

		assert.deepStrictEqual(
			refreshed.map(m => [m.name, m.rowIndex]),
			[
				['was-unloaded', 3],
				['loaded', 10],
			],
		);
	});

	test('leaves a still-unloaded ref trailing', () => {
		const matches = [match({ name: 'a', score: 0.5, rowIndex: 1 }), match({ name: 'b', score: 0.9 })];
		const refreshed = refreshMatchRows(matches, sha => (sha === 'a' ? 1 : undefined));

		assert.deepStrictEqual(
			refreshed.map(m => [m.name, m.rowIndex]),
			[
				['a', 1],
				['b', undefined],
			],
		);
	});
});

suite('pickInitialTargetIndex', () => {
	test('no matches → -1', () => {
		assert.strictEqual(pickInitialTargetIndex([]), -1);
	});

	test('picks the best score regardless of graph position', () => {
		const matches = [
			match({ name: 'a', score: 0.2 }),
			match({ name: 'b', score: 0.9 }),
			match({ name: 'c', score: 0.5 }),
		];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
	});

	test('ties prefer the current branch', () => {
		const matches = [match({ name: 'a', score: 0.7 }), match({ name: 'b', score: 0.7, current: true })];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
	});

	test('ties without a current branch keep the earlier row', () => {
		const matches = [match({ name: 'a', score: 0.7 }), match({ name: 'b', score: 0.7 })];

		assert.strictEqual(pickInitialTargetIndex(matches), 0);
	});
});

suite('stepMatchIndex', () => {
	test('steps forward and back', () => {
		assert.strictEqual(stepMatchIndex(0, 3, 1), 1);
		assert.strictEqual(stepMatchIndex(2, 3, -1), 1);
	});

	test('wraps at both ends', () => {
		assert.strictEqual(stepMatchIndex(2, 3, 1), 0);
		assert.strictEqual(stepMatchIndex(0, 3, -1), 2);
	});

	test('no matches → -1', () => {
		assert.strictEqual(stepMatchIndex(0, 0, 1), -1);
	});
});

suite('elideRefName', () => {
	test('leaves a name that fits alone', () => {
		assert.strictEqual(elideRefName('main', 28), 'main');
		assert.strictEqual(elideRefName('feature/graph-ref-find', 28), 'feature/graph-ref-find');
	});

	test('drops leading segments before touching the leaf', () => {
		assert.strictEqual(elideRefName('origin/feature/some-long-thing', 28), '…/some-long-thing');
	});

	test('chops into the leaf only when the leaf alone still overflows', () => {
		const out = elideRefName('origin/feature/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 20);

		assert.strictEqual(out.length, 20);
		assert.ok(out.startsWith('…'));
		// The TAIL survives — that is the whole point.
		assert.ok('origin/feature/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'.endsWith(out.slice(1)));
	});

	test('keeps the tail for a segment-less name', () => {
		assert.strictEqual(elideRefName('averyveryverylongbranchname', 10), '…ranchname');
	});

	test('never returns something longer than the original', () => {
		for (const name of ['a/b', 'a/bb', 'origin/x', 'feature/y/z']) {
			assert.ok(elideRefName(name, 6).length <= Math.max(name.length, 6));
		}
	});
});
