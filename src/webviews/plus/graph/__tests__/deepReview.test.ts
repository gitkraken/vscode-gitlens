import * as assert from 'assert';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { DeepReviewIpc } from '../deepReview.js';
import { DeepReviewChannel, deepReviewRoute, getDeepReviewDiffCommand, parseDeepReviewReport } from '../deepReview.js';
import type { DeepReviewState } from '../graphService.js';

suite("deepReview — the agent's report", () => {
	test('keeps what an agent plausibly sends, numbers ids from the sequence, and reads done', () => {
		const { findings, done } = parseDeepReviewReport(
			{
				findings: [
					{
						file: './src/a.ts',
						lines: { start: '3', end: 5 },
						severity: 'critical',
						title: ' One ',
						description: 'd',
					},
					{ file: 'src/b.ts', severity: 'odd', title: 'Two' },
					{ file: 'src/c.ts', lines: { start: 9, end: 2 }, title: 'Three' },
					{ title: '' },
					'junk',
				],
				done: true,
			},
			4,
		);
		assert.strictEqual(done, true);
		assert.deepStrictEqual(
			findings.map(f => ({
				id: f.id,
				file: f.filePath,
				lines: f.lineRange,
				severity: f.severity,
				title: f.title,
				source: f.source,
			})),
			[
				{
					id: 'agent-4',
					file: 'src/a.ts',
					lines: { start: 3, end: 5 },
					severity: 'critical',
					title: 'One',
					source: 'agent',
				},
				{
					id: 'agent-5',
					file: 'src/b.ts',
					lines: undefined,
					severity: 'warning',
					title: 'Two',
					source: 'agent',
				},
				{
					id: 'agent-6',
					file: 'src/c.ts',
					lines: undefined,
					severity: 'warning',
					title: 'Three',
					source: 'agent',
				},
			],
		);
		assert.deepStrictEqual(parseDeepReviewReport(undefined, 1), { findings: [], notes: [], done: false });
	});

	test('a finding may name several places; the first is its own file and lines', () => {
		const { findings } = parseDeepReviewReport(
			{
				findings: [
					{
						title: 'Same guard missing',
						file: 'src/a.ts',
						lines: { start: 3, end: 4 },
						locations: [
							{ file: './src/b.ts', lines: { start: 8, end: 8 } },
							{ file: 'src/a.ts', lines: { start: 3, end: 4 } },
						],
					},
					{ title: 'Only in locations', locations: [{ file: 'src/c.ts' }] },
				],
			},
			1,
		);
		assert.deepStrictEqual(
			findings.map(f => [f.filePath, f.lineRange, f.locations]),
			[
				[
					'src/a.ts',
					{ start: 3, end: 4 },
					[
						{ filePath: 'src/a.ts', lineRange: { start: 3, end: 4 } },
						{ filePath: 'src/b.ts', lineRange: { start: 8, end: 8 } },
					],
				],
				['src/c.ts', undefined, undefined],
			],
		);
	});

	test('an item that names a finding is a note on it, not a finding; without a comment it is nothing', () => {
		const { findings, notes } = parseDeepReviewReport(
			{
				findings: [
					{
						findingId: ' area-1-f2 ',
						comment: ' The caller never passes a signal, so this cannot trigger. ',
					},
					{ findingId: 'area-1-f3' },
					{ findingId: 'area-1-f1', comment: 'x', title: 'Not a new finding' },
					{ title: 'A new one' },
				],
			},
			1,
		);
		assert.deepStrictEqual(notes, [
			{ findingId: 'area-1-f2', text: 'The caller never passes a signal, so this cannot trigger.' },
			{ findingId: 'area-1-f1', text: 'x' },
		]);
		assert.deepStrictEqual(
			findings.map(f => f.title),
			['A new one'],
		);
	});

	test('tells the agent the git command that shows the scope', () => {
		assert.strictEqual(getDeepReviewDiffCommand({ type: 'commit', sha: 'abc' }, 'abc^', 'abc'), 'git show abc');
		assert.strictEqual(
			getDeepReviewDiffCommand({ type: 'compare', fromSha: 'a', toSha: 'b' }, 'a', 'b'),
			'git diff a..b',
		);
		const wip = { type: 'wip' as const, includeUnstaged: true, includeStaged: true, includeShas: [] };
		assert.strictEqual(getDeepReviewDiffCommand(wip, 'HEAD', uncommitted), 'git diff HEAD');
		assert.strictEqual(getDeepReviewDiffCommand(wip, uncommittedStaged, uncommitted), 'git diff');
		assert.strictEqual(getDeepReviewDiffCommand(wip, 'HEAD', uncommittedStaged), 'git diff --cached');
	});
});

suite('deepReview — the report channel', () => {
	const anchor = { kind: 'wip', repoPath: '/r' };
	function fakeIpc() {
		const routes = new Map<string, (rq: unknown, params: URLSearchParams) => Promise<unknown>>();
		const ipc: DeepReviewIpc = {
			address: 'http://127.0.0.1:1',
			token: 't',
			registerHandler: (name, handler) => {
				routes.set(name, handler as (rq: unknown, params: URLSearchParams) => Promise<unknown>);
				return { dispose: () => routes.delete(name), [Symbol.dispose]: () => routes.delete(name) };
			},
		};
		return { ipc: ipc, routes: routes };
	}

	test('owns the route while open, sequences what comes in, and closes itself on done', async () => {
		const { ipc, routes } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, s => changes.push(s));
		assert.ok(routes.has(deepReviewRoute), 'the route is registered on open');

		const post = routes.get(deepReviewRoute)!;
		assert.deepStrictEqual(await post({ findings: [{ title: 'one' }, { title: 'two' }] }, new URLSearchParams()), {
			accepted: 2,
		});
		assert.deepStrictEqual(
			await post({ findings: [{ findingId: 'f9', comment: 'more on it' }] }, new URLSearchParams()),
			{ accepted: 1 },
		);
		assert.deepStrictEqual(await post({ findings: [{ title: 'three' }], done: true }, new URLSearchParams()), {
			accepted: 1,
		});
		assert.strictEqual(routes.has(deepReviewRoute), false, 'done closes the route');

		assert.deepStrictEqual(
			changes.map(c => [c.run, c.anchor.repoPath]).every(([run, repo]) => run === 1 && repo === '/r'),
			true,
			'every report carries the run and the review it belongs to',
		);
		assert.deepStrictEqual(
			changes.map(c => [c.active, c.done, c.findings.map(f => f.seq), c.notes.map(n => [n.seq, n.findingId])]),
			[
				[true, false, [1, 2], []],
				[true, false, [1, 2], [[1, 'f9']]],
				[false, true, [1, 2, 3], [[1, 'f9']]],
			],
		);
		assert.strictEqual(channel.report({ findings: [{ title: 'late' }] }), 0, 'a report after close is dropped');
		assert.strictEqual(channel.state.findings.length, 3);
	});

	test('closing by hand notifies once and keeps what was reported', () => {
		const { ipc, routes } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, s => changes.push(s));
		channel.report({ findings: [{ title: 'one' }] });
		channel.close();
		channel.close();
		assert.strictEqual(routes.size, 0);
		assert.deepStrictEqual(
			changes.map(c => [c.active, c.done, c.findings.length]),
			[
				[true, false, 1],
				[false, false, 1],
			],
		);
	});
});
