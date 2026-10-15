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
		assert.deepStrictEqual(parseDeepReviewReport(undefined, 1), { findings: [], done: false });
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
		const channel = new DeepReviewChannel(ipc, s => changes.push(s));
		assert.ok(routes.has(deepReviewRoute), 'the route is registered on open');

		const post = routes.get(deepReviewRoute)!;
		assert.deepStrictEqual(await post({ findings: [{ title: 'one' }, { title: 'two' }] }, new URLSearchParams()), {
			accepted: 2,
		});
		assert.deepStrictEqual(await post({ findings: [{ title: 'three' }], done: true }, new URLSearchParams()), {
			accepted: 1,
		});
		assert.strictEqual(routes.has(deepReviewRoute), false, 'done closes the route');

		assert.deepStrictEqual(
			changes.map(c => [c.active, c.done, c.findings.map(f => f.seq)]),
			[
				[true, false, [1, 2]],
				[false, true, [1, 2, 3]],
			],
		);
		assert.strictEqual(channel.report({ findings: [{ title: 'late' }] }), 0, 'a report after close is dropped');
		assert.strictEqual(channel.state.findings.length, 3);
	});

	test('closing by hand notifies once and keeps what was reported', () => {
		const { ipc, routes } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, s => changes.push(s));
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
