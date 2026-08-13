import * as assert from 'assert';
import type {
	emptySetMarker,
	GraphRefOptData,
	GraphScope,
	GraphWipRow,
	GraphWipRowsById,
} from '../../../../../plus/graph/protocol.js';
import { createWipRowId } from '../../../../../plus/graph/protocol.js';
import type { RefFindCandidate, RefFindMatch } from '../refFind.utils.js';
import {
	buildRefFindCandidates,
	elideRefName,
	matchRefs,
	pickInitialTargetIndex,
	refreshMatchRows,
	stepMatchIndex,
} from '../refFind.utils.js';

function branch(
	name: string,
	sha: string | undefined,
	extra?: { date?: number; current?: boolean; upstream?: string },
) {
	return {
		name: name,
		sha: sha,
		current: extra?.current ?? false,
		remote: false,
		date: extra?.date,
		upstream: extra?.upstream != null ? { name: extra.upstream, missing: false } : undefined,
	};
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

/** A whole-remote "Hide Remote" wildcard `excludeRefs` entry — `type: 'remote'`, `name: '*'`. */
function wildcardOptData(owner: string, except?: string[]): GraphRefOptData {
	return { id: `/repo|remotes/${owner}/*`, name: '*', type: 'remote', owner: owner, except: except };
}

/** A `GraphWipRow` topology entry. `unborn: true` omits `parentSha`, mimicking a worktree with no
 *  commits yet — the case the finder must not offer a candidate for. */
function wipRow(
	repoPath: string,
	extra?: { parentDate?: number; label?: string; branchRef?: string; unborn?: boolean },
): GraphWipRow {
	return {
		repoPath: repoPath,
		parentSha: extra?.unborn ? undefined : 'parent-sha',
		parentDate: extra?.parentDate,
		label: extra?.label ?? 'worktree',
		branchRef: extra?.branchRef,
	};
}

function candidate(name: string, extra?: Partial<RefFindCandidate>): RefFindCandidate {
	return {
		kind: extra?.kind ?? 'head',
		name: name,
		owner: extra?.owner,
		label: extra?.label ?? name,
		aliases: extra?.aliases,
		sha: extra?.sha ?? name,
		date: extra?.date,
		current: extra?.current,
	};
}

function match(candidate: Partial<RefFindMatch> & { label: string; score: number }): RefFindMatch {
	return {
		kind: candidate.kind ?? 'head',
		name: candidate.name ?? candidate.label,
		owner: candidate.owner,
		label: candidate.label,
		aliases: candidate.aliases,
		sha: candidate.sha ?? candidate.label,
		date: candidate.date,
		current: candidate.current,
		rowIndex: candidate.rowIndex,
		score: candidate.score,
	};
}

/** Ranks names against a query the way the widget does, strongest first. */
function rank(query: string, names: string[]): string[] {
	const candidates: RefFindCandidate[] = names.map(n => candidate(n));
	return matchRefs(query, candidates, () => undefined)
		.slice()
		.sort((a, b) => b.score - a.score)
		.map(m => m.label);
}

suite('buildRefFindCandidates', () => {
	test('projects branches, remotes, and tags into one list', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-main', { current: true })],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-origin-main' }])],
			tags: [tag('v1.0.0', 'sha-tag')],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label, c.sha]),
			[
				['head', 'main', 'sha-main'],
				['remote', 'origin/main', 'sha-origin-main'],
				['tag', 'v1.0.0', 'sha-tag'],
			],
		);
		assert.strictEqual(candidates[0].current, true);
	});

	test('splits a remote branch into bare name + owner, with a qualified label', () => {
		// The remotes panel ships names WITHOUT the remote prefix (getBranchNameWithoutRemote).
		const candidates = buildRefFindCandidates({
			remotes: [remote('upstream', [{ name: 'feature/x', sha: 'sha' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.name, c.owner, c.label]),
			[['feature/x', 'upstream', 'upstream/feature/x']],
		);
	});

	test('drops refs with no tip sha', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('no-sha', undefined), branch('ok', 'sha')],
			tags: [tag('dangling', undefined)],
		});

		assert.deepStrictEqual(
			candidates.map(c => c.label),
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
			buildRefFindCandidates(sources, { excludeTypes: { remotes: true, tags: true } }).map(c => c.label),
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
			candidates.map(c => [c.kind, c.label]),
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
			candidates.map(c => c.label),
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
			candidates.map(c => c.label),
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

	test('does not dedupe the same branch name across two different remotes', () => {
		const candidates = buildRefFindCandidates({
			remotes: [remote('origin', [{ name: 'main', sha: 'a' }]), remote('upstream', [{ name: 'main', sha: 'b' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.label, c.sha]),
			[
				['origin/main', 'a'],
				['upstream/main', 'b'],
			],
		);
	});

	test("folds an in-sync upstream into its local branch, matching the graph's combined pill", () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label, c.aliases]),
			[['head', 'main', ['origin/main']]],
		);
	});

	test('the folded local is still findable by the remote qualified name and the bare remote alias', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
		});

		for (const query of ['origin/main', 'origin']) {
			const matches = matchRefs(query, candidates, () => undefined);
			assert.strictEqual(matches.length, 1, query);
			assert.deepStrictEqual([matches[0].kind, matches[0].label], ['head', 'main'], query);
		}
	});

	test('keeps both when the local and its upstream have diverged', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-local', { upstream: 'origin/main' })],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-remote' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label]),
			[
				['head', 'main'],
				['remote', 'origin/main'],
			],
		);
	});

	test('two locals sharing an upstream name: only the sha-matching one folds', () => {
		const candidates = buildRefFindCandidates({
			branches: [
				branch('main-a', 'sha-remote', { upstream: 'origin/main' }),
				branch('main-b', 'sha-diverged', { upstream: 'origin/main' }),
			],
			remotes: [remote('origin', [{ name: 'main', sha: 'sha-remote' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label, c.aliases]),
			[
				['head', 'main-a', ['origin/main']],
				['head', 'main-b', undefined],
			],
		);

		// `main-b` diverged, so `origin/main` must still be reachable as its own candidate.
		const matches = matchRefs('origin/main', candidates, () => undefined);
		assert.deepStrictEqual(
			matches.map(m => m.label),
			['main-a'],
		);
	});

	test('keeps unrelated refs that merely share a commit', () => {
		const candidates = buildRefFindCandidates({
			branches: [branch('main', 'sha-1')],
			remotes: [remote('origin', [{ name: 'other', sha: 'sha-1' }])],
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label]),
			[
				['head', 'main'],
				['remote', 'origin/other'],
			],
		);
	});

	test('still lists the remote when its local counterpart was excluded', () => {
		const candidates = buildRefFindCandidates(
			{
				branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
				remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
			},
			{ excludeRefs: { '/repo|heads/main': optData('main', 'head') } },
		);

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label]),
			[['remote', 'origin/main']],
		);
	});

	test('still lists the remote when heads are type-excluded', () => {
		const candidates = buildRefFindCandidates(
			{
				branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
				remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
			},
			{ excludeTypes: { heads: true } },
		);

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label]),
			[['remote', 'origin/main']],
		);
	});

	test("a whole-remote wildcard exclude drops ALL of that remote's candidates", () => {
		const candidates = buildRefFindCandidates(
			{
				remotes: [
					remote('origin', [
						{ name: 'main', sha: 'sha-1' },
						{ name: 'dev', sha: 'sha-2' },
					]),
					remote('upstream', [{ name: 'main', sha: 'sha-3' }]),
				],
			},
			{ excludeRefs: { '/repo|remotes/origin/*': wildcardOptData('origin') } },
		);

		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['upstream/main'],
		);
	});

	test('a whole-remote wildcard exclude drops the in-sync alias it would otherwise leave on the local', () => {
		const candidates = buildRefFindCandidates(
			{
				branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
				remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
			},
			{ excludeRefs: { '/repo|remotes/origin/*': wildcardOptData('origin') } },
		);

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label, c.aliases]),
			[['head', 'main', undefined]],
		);
		assert.deepStrictEqual(
			matchRefs('origin/main', candidates, () => undefined),
			[],
		);
	});

	test('a whole-remote wildcard entry mints no `remote:owner/*` key — unrelated remotes stay findable', () => {
		const candidates = buildRefFindCandidates(
			{
				remotes: [
					remote('origin', [{ name: 'main', sha: 'sha-1' }]),
					remote('upstream', [{ name: 'main', sha: 'sha-2' }]),
				],
			},
			{ excludeRefs: { '/repo|remotes/origin/*': wildcardOptData('origin') } },
		);

		// `origin`'s branch is gone, but nothing here is literally named `*`, and `upstream` survives.
		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['upstream/main'],
		);
	});

	test('a wildcard exception leaves that branch findable while its siblings stay hidden', () => {
		const candidates = buildRefFindCandidates(
			{
				remotes: [
					remote('origin', [
						{ name: 'main', sha: 'sha-1' },
						{ name: 'dev', sha: 'sha-2' },
					]),
				],
			},
			{ excludeRefs: { '/repo|remotes/origin/*': wildcardOptData('origin', ['/repo|remotes/origin/dev']) } },
		);

		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['origin/dev'],
		);
	});

	test('a hidden in-sync remote leaves no alias on its local', () => {
		// The fold skips `add`, so the remote's own filters have to be checked before it's aliased —
		// otherwise "Hide Remote Branches" (and a per-ref hide) would still leave `origin/main` typeable.
		for (const filters of [
			{ excludeTypes: { remotes: true } },
			{
				excludeRefs: {
					'/repo|remotes/origin/main': {
						id: '/repo|remotes/origin/main',
						name: 'main',
						type: 'remote' as const,
						owner: 'origin',
					},
				},
			},
		]) {
			const candidates = buildRefFindCandidates(
				{
					branches: [branch('main', 'sha-1', { upstream: 'origin/main' })],
					remotes: [remote('origin', [{ name: 'main', sha: 'sha-1' }])],
				},
				filters,
			);

			assert.deepStrictEqual(
				candidates.map(c => [c.kind, c.label, c.aliases]),
				[['head', 'main', undefined]],
			);
			assert.deepStrictEqual(
				matchRefs('origin/main', candidates, () => undefined),
				[],
			);
		}
	});
});

suite('buildRefFindCandidates: WIP rows', () => {
	test("emits a primary candidate for the graph's own worktree and a peer candidate for another", () => {
		const primaryId = createWipRowId('/repo');
		const peerId = createWipRowId('/repo-peer');

		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[primaryId]: wipRow('/repo', { branchRef: '/repo|heads/main' }),
					[peerId]: wipRow('/repo-peer', { label: 'peer', branchRef: '/repo-peer|heads/feature' }),
				},
				primaryRepoPath: '/repo',
				currentBranch: { id: '/repo|heads/main', name: 'main' },
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		assert.deepStrictEqual(
			candidates.map(c => [c.kind, c.label, c.sha, c.current]),
			[
				['wip', 'Working Changes', primaryId, true],
				['wip', 'Working Changes (peer)', peerId, undefined],
			],
		);
	});

	test('no WIP candidates when wipRowsById is empty', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {},
				primaryRepoPath: '/repo',
				currentBranch: undefined,
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		assert.deepStrictEqual(candidates, []);
	});

	test('query "wip" matches every WIP candidate', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo')]: wipRow('/repo', { branchRef: '/repo|heads/main' }),
					[createWipRowId('/repo-peer')]: wipRow('/repo-peer', {
						label: 'peer',
						branchRef: '/repo-peer|heads/feature',
					}),
				},
				primaryRepoPath: '/repo',
				currentBranch: { id: '/repo|heads/main', name: 'main' },
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		const matches = matchRefs('wip', candidates, () => undefined);
		assert.strictEqual(matches.length, 2);
		assert.ok(matches.every(m => m.score === 1));
	});

	test('a peer candidate is findable by its branch name and worktree label', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo-peer')]: wipRow('/repo-peer', {
						label: 'peer-wt',
						branchRef: '/repo-peer|heads/feature-x',
					}),
				},
				primaryRepoPath: undefined,
				currentBranch: undefined,
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		for (const query of ['feature-x', 'peer-wt']) {
			const matches = matchRefs(query, candidates, () => undefined);
			assert.strictEqual(matches.length, 1, query);
			assert.strictEqual(matches[0].kind, 'wip', query);
		}
	});

	test('the primary candidate is findable by the current branch name', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo')]: wipRow('/repo', { branchRef: '/repo|heads/main' }),
				},
				primaryRepoPath: '/repo',
				currentBranch: { id: '/repo|heads/main', name: 'main' },
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		const matches = matchRefs('main', candidates, () => undefined);
		assert.strictEqual(matches.length, 1);
		assert.strictEqual(matches[0].kind, 'wip');
	});

	test('a peer WIP row outside the active scope is dropped', () => {
		const scope: GraphScope = { branchName: 'main', branchRef: '/repo|heads/main' };
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo-peer')]: wipRow('/repo-peer', { branchRef: '/repo-peer|heads/other' }),
				},
				primaryRepoPath: undefined,
				currentBranch: undefined,
				scope: scope,
				branchesVisibility: undefined,
			},
		});

		assert.deepStrictEqual(candidates, []);
	});

	test('a peer WIP row with no parentSha (unborn HEAD) is dropped', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo-peer')]: wipRow('/repo-peer', { unborn: true }),
				},
				primaryRepoPath: undefined,
				currentBranch: undefined,
				scope: undefined,
				branchesVisibility: undefined,
			},
		});

		assert.deepStrictEqual(candidates, []);
	});

	test('the primary candidate is hidden when the scope is on a branch other than HEAD', () => {
		const candidates = buildRefFindCandidates({
			wip: {
				wipRowsById: {
					[createWipRowId('/repo')]: wipRow('/repo'),
				},
				primaryRepoPath: '/repo',
				currentBranch: { id: '/repo|heads/main', name: 'main', detached: false },
				scope: { branchName: 'other', branchRef: '/repo|heads/other' },
				branchesVisibility: undefined,
			},
		});

		assert.deepStrictEqual(candidates, []);
	});

	test('an include-only refs filter does not drop a WIP candidate whose branch is included, but still drops the rest', () => {
		const includedId = createWipRowId('/repo-included');
		const excludedId = createWipRowId('/repo-excluded');

		const candidates = buildRefFindCandidates(
			{
				wip: {
					wipRowsById: {
						[includedId]: wipRow('/repo-included', { label: 'included', branchRef: '/repo|heads/main' }),
						[excludedId]: wipRow('/repo-excluded', { label: 'excluded', branchRef: '/repo|heads/other' }),
					},
					primaryRepoPath: undefined,
					currentBranch: undefined,
					scope: undefined,
					branchesVisibility: 'current',
				},
			},
			{ includeOnlyRefs: { '/repo|heads/main': optData('main', 'head') } },
		);

		assert.deepStrictEqual(
			candidates.map(c => c.label),
			['Working Changes (included)'],
		);
	});

	test('building candidates twice from the same WIP sources yields one candidate per worktree each time', () => {
		const wipRowsById: GraphWipRowsById = {
			[createWipRowId('/repo')]: wipRow('/repo', { branchRef: '/repo|heads/main' }),
		};
		const sources = {
			wip: {
				wipRowsById: wipRowsById,
				primaryRepoPath: '/repo',
				currentBranch: { id: '/repo|heads/main', name: 'main' },
				scope: undefined,
				branchesVisibility: undefined,
			},
		};

		const expected = [createWipRowId('/repo')];
		assert.deepStrictEqual(
			buildRefFindCandidates(sources).map(c => c.sha),
			expected,
		);
		assert.deepStrictEqual(
			buildRefFindCandidates(sources).map(c => c.sha),
			expected,
		);
	});
});

suite('matchRefs', () => {
	const candidates: RefFindCandidate[] = [
		candidate('graph-a', { sha: 'a' }),
		candidate('graph-b', { sha: 'b' }),
		candidate('graph-c', { sha: 'c' }),
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

	test('naming the leaf exactly outscores stopping short of it', () => {
		const names = ['debt/feature/foo', 'debt/feature/foo-extra-long-tail'];
		const matches = matchRefs(
			'd/f/foo',
			names.map(n => candidate(n)),
			() => undefined,
		);

		assert.deepStrictEqual(
			matches.map(m => [m.label, m.score]),
			[
				['debt/feature/foo', 0.95],
				['debt/feature/foo-extra-long-tail', 0.9],
			],
		);
	});

	test('a broad prefix that never reaches the leaf ties across all matches', () => {
		const names = ['feat/alpha', 'feat/beta', 'feat/beta-extended', 'feature/gamma'];
		const matches = matchRefs(
			'feat/',
			names.map(n => candidate(n)),
			() => undefined,
		);

		assert.deepStrictEqual(
			matches.map(m => m.score),
			[0.85, 0.85, 0.85, 0.85],
		);
	});

	test('a mid-segment hit still matches, ranked below a prefix hit', () => {
		const names = ['debt/feature/graph-ref-find', 'debt/feature/refactor'];

		// `ref` prefixes `refactor` but only appears mid-name in `graph-ref-find`.
		assert.deepStrictEqual(rank('d/f/ref', names), ['debt/feature/refactor', 'debt/feature/graph-ref-find']);
	});

	test('the weakest term decides the score', () => {
		// `main` is an exact whole-name hit (1.0); the segment term is weaker, so it must not inherit 1.0.
		const [exact] = matchRefs('main', [candidate('main')], () => undefined);
		const [segment] = matchRefs('main d/f', [candidate('main')], () => undefined);

		assert.strictEqual(exact.score, 1);
		assert.strictEqual(segment, undefined);
	});

	test('scores label and aliases, keeping the best', () => {
		const aliased = candidate('main', { aliases: ['renamed-main'] });

		// Matches only via the alias — scores as an exact whole-name hit off THAT alias.
		const [byAlias] = matchRefs('renamed-main', [aliased], () => undefined);
		assert.strictEqual(byAlias.score, 1);

		// Matches via the label directly.
		const [byLabel] = matchRefs('main', [aliased], () => undefined);
		assert.strictEqual(byLabel.score, 1);

		// Label is only a prefix hit (0.9) for this query, but the alias is an exact hit — best wins.
		const partial = candidate('main-branch', { aliases: ['main'] });
		const [best] = matchRefs('main', [partial], () => undefined);
		assert.strictEqual(best.score, 1);
	});

	test('orders loaded matches by row index, not by score', () => {
		const rows = new Map([
			['a', 9],
			['b', 2],
			['c', 5],
		]);
		const matches = matchRefs('graph', candidates, sha => rows.get(sha));

		assert.deepStrictEqual(
			matches.map(m => m.label),
			['graph-b', 'graph-c', 'graph-a'],
		);
	});

	test('unloaded matches trail loaded ones, newest first', () => {
		const dated: RefFindCandidate[] = [
			candidate('graph-old', { kind: 'tag', sha: 'old', date: 100 }),
			candidate('graph-new', { kind: 'tag', sha: 'new', date: 900 }),
			candidate('graph-loaded', { sha: 'loaded' }),
		];
		const matches = matchRefs('graph', dated, sha => (sha === 'loaded' ? 4 : undefined));

		assert.deepStrictEqual(
			matches.map(m => m.label),
			['graph-loaded', 'graph-new', 'graph-old'],
		);
	});

	test('dateless unloaded matches sort last, then by name', () => {
		const mixed: RefFindCandidate[] = [
			candidate('graph-z', { kind: 'remote', sha: 'z' }),
			candidate('graph-dated', { kind: 'tag', sha: 'd', date: 5 }),
			candidate('graph-a', { kind: 'remote', sha: 'a' }),
		];
		const matches = matchRefs('graph', mixed, () => undefined);

		assert.deepStrictEqual(
			matches.map(m => m.label),
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
			match({ label: 'loaded', score: 0.5, rowIndex: 10 }),
			match({ label: 'was-unloaded', score: 0.9, date: 500 }),
		];

		// The row for `was-unloaded` has now paged in ABOVE the other one.
		const refreshed = refreshMatchRows(matches, sha => (sha === 'was-unloaded' ? 3 : 10));

		assert.deepStrictEqual(
			refreshed.map(m => [m.label, m.rowIndex]),
			[
				['was-unloaded', 3],
				['loaded', 10],
			],
		);
	});

	test('leaves a still-unloaded ref trailing', () => {
		const matches = [match({ label: 'a', score: 0.5, rowIndex: 1 }), match({ label: 'b', score: 0.9 })];
		const refreshed = refreshMatchRows(matches, sha => (sha === 'a' ? 1 : undefined));

		assert.deepStrictEqual(
			refreshed.map(m => [m.label, m.rowIndex]),
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
			match({ label: 'a', score: 0.2 }),
			match({ label: 'b', score: 0.9 }),
			match({ label: 'c', score: 0.5 }),
		];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
	});

	test('ties prefer the current branch', () => {
		const matches = [match({ label: 'a', score: 0.7 }), match({ label: 'b', score: 0.7, current: true })];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
	});

	test('ties without a current branch keep the earlier row', () => {
		const matches = [match({ label: 'a', score: 0.7 }), match({ label: 'b', score: 0.7 })];

		assert.strictEqual(pickInitialTargetIndex(matches), 0);
	});

	test('ties prefer a named ref over a WIP row, even a current one sitting earlier', () => {
		const matches = [
			match({ label: 'Working Changes', kind: 'wip', score: 1, current: true }),
			match({ label: 'main', score: 1, current: true }),
		];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
	});

	test('a WIP row still wins on score alone', () => {
		const matches = [
			match({ label: 'main', score: 0.9 }),
			match({ label: 'Working Changes', kind: 'wip', score: 1 }),
		];

		assert.strictEqual(pickInitialTargetIndex(matches), 1);
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

	test('drops leading segments one at a time, keeping the longest tail that fits', () => {
		// 28 has room for `feature/` as well, so dropping only `origin/` is the right answer.
		assert.strictEqual(elideRefName('origin/feature/some-long-thing', 28), '…/feature/some-long-thing');
		// Tighter budget, so `feature/` has to go too.
		assert.strictEqual(elideRefName('origin/feature/some-long-thing', 20), '…/some-long-thing');
	});

	test('uses the room available rather than jumping to the leaf', () => {
		// `b/c/…` needs 27 and only 26 are free, so exactly one more segment goes — not all of them.
		assert.strictEqual(elideRefName('a/b/c/some-long-branch-name', 26), '…/c/some-long-branch-name');
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
