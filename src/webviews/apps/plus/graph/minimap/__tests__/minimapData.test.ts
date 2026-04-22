import * as assert from 'assert';
import type { GraphRow } from '@gitkraken/gitkraken-components';
import type { GraphMinimapMarkerTypes, GraphSearchResults } from '../../../../../plus/graph/protocol.js';
import { aggregate, aggregateSearchResults, getDay } from '../minimapData.js';

const day1 = new Date(2024, 5, 10, 15, 30).getTime();
const day1Midnight = new Date(2024, 5, 10, 0, 0, 0, 0).getTime();
const day2 = new Date(2024, 5, 11, 9, 0).getTime();
const day2Midnight = new Date(2024, 5, 11, 0, 0, 0, 0).getTime();

function row(overrides: Partial<GraphRow> & { sha: string; date: number }): GraphRow {
	const r: GraphRow = {
		sha: overrides.sha,
		date: overrides.date,
		parents: [],
		author: 'test',
		email: 'test@test',
		message: 'message',
		type: 'commit-node',
	};
	return Object.assign(r, overrides);
}

const allMarkerTypes: GraphMinimapMarkerTypes[] = [
	'head',
	'localBranches',
	'remoteBranches',
	'upstream',
	'pullRequests',
	'stashes',
	'tags',
	'worktree',
];

suite('minimapData Test Suite', () => {
	test('getDay normalizes to local midnight', () => {
		assert.strictEqual(getDay(day1), day1Midnight);
		assert.strictEqual(getDay(new Date(day1)), day1Midnight);
	});

	test('empty rows produce empty maps', () => {
		const result = aggregate({
			rows: [],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.size, 0);
		assert.strictEqual(result.markersByDay.size, 0);
	});

	test('lines mode without rowsStats yields empty maps', () => {
		const result = aggregate({
			rows: [row({ sha: 'a', date: day1 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'lines',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.size, 0);
		assert.strictEqual(result.markersByDay.size, 0);
	});

	test('commits mode counts commits per day', () => {
		const result = aggregate({
			rows: [
				row({ sha: 'a', date: day1 }),
				row({ sha: 'b', date: day1 + 3600_000 }), // same day
				row({ sha: 'c', date: day2 }),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.size, 2);
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.commits, 2);
		assert.strictEqual(result.statsByDay.get(day2Midnight)?.commits, 1);
	});

	test('commits mode default sha is the most recent row for the day', () => {
		// Rows iterate in reverse, so the most recent row for a day is seen first and sets the initial sha.
		// With no markers active, rankedShas stay undefined, so stat.sha is never overridden.
		const result = aggregate({
			rows: [row({ sha: 'older', date: day1 }), row({ sha: 'newer', date: day1 + 3600_000 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.sha, 'newer');
	});

	test('lines mode aggregates additions/deletions/files from rowsStats', () => {
		const result = aggregate({
			rows: [row({ sha: 'a', date: day1 }), row({ sha: 'b', date: day1 + 3600_000 })],
			rowsStats: {
				a: { additions: 10, deletions: 2, files: 3 },
				b: { additions: 5, deletions: 1, files: 1 },
			},
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'lines',
			wipMetadataBySha: undefined,
		});
		const stat = result.statsByDay.get(day1Midnight);
		assert.strictEqual(stat?.commits, 2);
		assert.strictEqual(stat?.activity?.additions, 15);
		assert.strictEqual(stat?.activity?.deletions, 3);
		assert.strictEqual(stat?.files, 4);
	});

	test('emits branch markers when localBranches is enabled', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'a',
					date: day1,
					heads: [{ name: 'feat/x', isCurrentHead: false }],
				}),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['localBranches'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.deepStrictEqual(
			markers?.map(m => ({ type: m.type, name: m.name, current: m.current })),
			[{ type: 'branch', name: 'feat/x', current: false }],
		);
	});

	test('emits only current head when head-only enabled', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'a',
					date: day1,
					heads: [
						{ name: 'feat/x', isCurrentHead: false },
						{ name: 'main', isCurrentHead: true },
					],
				}),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['head'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.deepStrictEqual(
			markers?.map(m => ({ type: m.type, name: m.name, current: m.current })),
			[{ type: 'branch', name: 'main', current: true }],
		);
	});

	test('emits PR markers only when pullRequests enabled', () => {
		const withoutPR = aggregate({
			rows: [row({ sha: 'a', date: day1, heads: [{ id: 'h1', name: 'main', isCurrentHead: true }] })],
			rowsStats: undefined,
			refMetadata: { h1: { pullRequest: [{ title: 'PR #1' }] } } as any,
			downstreams: undefined,
			markerTypes: ['head'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.ok(!withoutPR.markersByDay.get(day1Midnight)?.some(m => m.type === 'pull-request'));

		const withPR = aggregate({
			rows: [row({ sha: 'a', date: day1, heads: [{ id: 'h1', name: 'main', isCurrentHead: true }] })],
			rowsStats: undefined,
			refMetadata: { h1: { pullRequest: [{ title: 'PR #1' }] } } as any,
			downstreams: undefined,
			markerTypes: ['head', 'pullRequests'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const prMarkers = withPR.markersByDay.get(day1Midnight)?.filter(m => m.type === 'pull-request');
		assert.strictEqual(prMarkers?.length, 1);
		assert.strictEqual(prMarkers?.[0]?.name, 'PR #1');
	});

	test('emits remote marker for upstream when upstream enabled', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'a',
					date: day1,
					remotes: [{ owner: 'origin', name: 'main', current: true }],
				}),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['upstream'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.strictEqual(markers?.length, 1);
		assert.strictEqual(markers?.[0]?.type, 'remote');
		assert.strictEqual(markers?.[0]?.current, true);
	});

	test('emits remote marker for local branch with downstream', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'a',
					date: day1,
					remotes: [{ owner: 'origin', name: 'feat', current: false }],
				}),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: { 'origin/feat': ['local/feat'] },
			markerTypes: ['localBranches'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.strictEqual(markers?.length, 1);
		assert.strictEqual(markers?.[0]?.type, 'remote');
	});

	test('emits tag markers when tags enabled', () => {
		const result = aggregate({
			rows: [row({ sha: 'a', date: day1, tags: [{ name: 'v1.0.0' }, { name: 'stable' }] })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['tags'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.deepStrictEqual(
			markers?.map(m => ({ type: m.type, name: m.name })),
			[
				{ type: 'tag', name: 'v1.0.0' },
				{ type: 'tag', name: 'stable' },
			],
		);
	});

	test('emits stash marker for stash-node rows when stashes enabled', () => {
		const result = aggregate({
			rows: [row({ sha: 'a', date: day1, type: 'stash-node', message: 'WIP on main' })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['stashes'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.strictEqual(markers?.length, 1);
		assert.strictEqual(markers?.[0]?.type, 'stash');
		assert.strictEqual(markers?.[0]?.name, 'WIP on main');
	});

	test('does not create marker entries for days without markers', () => {
		const result = aggregate({
			rows: [row({ sha: 'a', date: day1 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: allMarkerTypes,
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.markersByDay.size, 0);
	});

	test('stat.sha prefers current-head sha when enabled', () => {
		const result = aggregate({
			rows: [
				row({ sha: 'older', date: day1 }),
				row({ sha: 'head', date: day1 + 3600_000, heads: [{ name: 'main', isCurrentHead: true }] }),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['head'],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.sha, 'head');
	});

	test('aggregateSearchResults groups by day and counts per-day matches', () => {
		const results: GraphSearchResults = {
			count: 3,
			hasMore: false,
			commitsLoaded: { count: 3 },
			ids: {
				a: { date: day1, i: 0 } as any,
				b: { date: day1 + 3600_000, i: 1 } as any,
				c: { date: day2, i: 2 } as any,
			},
		};
		const out = aggregateSearchResults(results);
		assert.strictEqual(out.size, 2);
		assert.strictEqual(out.get(day1Midnight)?.count, 2);
		assert.strictEqual(out.get(day2Midnight)?.count, 1);
	});

	test('aggregateSearchResults returns empty on error', () => {
		const out = aggregateSearchResults({ error: 'something broke' });
		assert.strictEqual(out.size, 0);
	});

	test('aggregateSearchResults returns empty on undefined', () => {
		const out = aggregateSearchResults(undefined);
		assert.strictEqual(out.size, 0);
	});

	test('emits worktree marker on the day of its parent commit', () => {
		const result = aggregate({
			rows: [row({ sha: 'parent-a', date: day1 }), row({ sha: 'parent-b', date: day2 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['worktree'],
			dataType: 'commits',
			wipMetadataBySha: {
				'worktree-wip::/wt-a': {
					parentSha: 'parent-a',
					repoPath: '/wt-a',
					label: 'wt-a',
				},
			},
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.strictEqual(markers?.length, 1);
		assert.strictEqual(markers?.[0]?.type, 'worktree');
		assert.strictEqual(markers?.[0]?.name, 'wt-a');
		assert.strictEqual(result.markersByDay.get(day2Midnight), undefined);
	});

	test('worktree whose parentSha is not in loaded rows is dropped', () => {
		const result = aggregate({
			rows: [row({ sha: 'parent-a', date: day1 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['worktree'],
			dataType: 'commits',
			wipMetadataBySha: {
				'worktree-wip::/wt-missing': {
					parentSha: 'unknown-sha',
					repoPath: '/wt-missing',
					label: 'wt-missing',
				},
			},
		});
		assert.strictEqual(result.markersByDay.size, 0);
	});

	test('multiple worktrees pointing at the same parent commit emit one marker each', () => {
		const result = aggregate({
			rows: [row({ sha: 'parent-a', date: day1 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['worktree'],
			dataType: 'commits',
			wipMetadataBySha: {
				'worktree-wip::/wt-a': {
					parentSha: 'parent-a',
					repoPath: '/wt-a',
					label: 'wt-a',
				},
				'worktree-wip::/wt-b': {
					parentSha: 'parent-a',
					repoPath: '/wt-b',
					label: 'wt-b',
				},
			},
		});
		const markers = result.markersByDay.get(day1Midnight);
		const worktreeMarkers = markers?.filter(m => m.type === 'worktree');
		assert.strictEqual(worktreeMarkers?.length, 2);
		assert.ok(worktreeMarkers?.find(m => m.name === 'wt-a'));
		assert.ok(worktreeMarkers?.find(m => m.name === 'wt-b'));
	});

	test('worktree markers are not emitted when the worktree marker type is disabled', () => {
		const result = aggregate({
			rows: [row({ sha: 'parent-a', date: day1 })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: {
				'worktree-wip::/wt-a': {
					parentSha: 'parent-a',
					repoPath: '/wt-a',
					label: 'wt-a',
				},
			},
		});
		assert.strictEqual(result.markersByDay.size, 0);
	});

	test('WIP row does not bump any commit bucket', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'work-dir-changes',
					date: day2,
					parents: ['head'],
					type: 'work-dir-changes',
				}),
				row({ sha: 'head', date: day1, heads: [{ id: 'h1', name: 'main', isCurrentHead: true }] }),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.commits, 1);
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.sha, 'head');
		assert.strictEqual(result.statsByDay.get(day2Midnight), undefined);
	});

	test('WIP row alone produces no buckets', () => {
		const result = aggregate({
			rows: [row({ sha: 'work-dir-changes', date: day1, parents: [], type: 'work-dir-changes' })],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: [],
			dataType: 'commits',
			wipMetadataBySha: undefined,
		});
		assert.strictEqual(result.statsByDay.size, 0);
	});

	test('worktree markers still attach to the parent commit when a WIP row is present in rows', () => {
		const result = aggregate({
			rows: [
				row({
					sha: 'worktree-wip::/wt-a',
					date: day2,
					parents: ['parent-a'],
					type: 'work-dir-changes',
				}),
				row({ sha: 'parent-a', date: day1 }),
			],
			rowsStats: undefined,
			refMetadata: undefined,
			downstreams: undefined,
			markerTypes: ['worktree'],
			dataType: 'commits',
			wipMetadataBySha: {
				'worktree-wip::/wt-a': {
					parentSha: 'parent-a',
					repoPath: '/wt-a',
					label: 'wt-a',
				},
			},
		});
		const markers = result.markersByDay.get(day1Midnight);
		assert.strictEqual(markers?.length, 1);
		assert.strictEqual(markers?.[0]?.type, 'worktree');
		assert.strictEqual(markers?.[0]?.name, 'wt-a');
		assert.strictEqual(result.markersByDay.get(day2Midnight), undefined);
		assert.strictEqual(result.statsByDay.get(day1Midnight)?.commits, 1);
		assert.strictEqual(result.statsByDay.get(day2Midnight), undefined);
	});
});
