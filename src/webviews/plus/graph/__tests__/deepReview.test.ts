import * as assert from 'assert';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { IpcHandler } from '@gitlens/ipc/ipcServer.js';
import { createIpcServer } from '@gitlens/ipc/ipcServer.js';
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
	const key = 'wip|/r';
	function fakeIpc() {
		const routes = new Map<string, (rq: unknown, params: URLSearchParams) => Promise<unknown>>();
		const routeTokens = new Map<string, string | undefined>();
		const ipc: DeepReviewIpc = {
			address: 'http://127.0.0.1:1',
			registerHandler: (name, handler, routeToken) => {
				routes.set(name, handler as (rq: unknown, params: URLSearchParams) => Promise<unknown>);
				routeTokens.set(name, routeToken);
				return { dispose: () => routes.delete(name), [Symbol.dispose]: () => routes.delete(name) };
			},
		};
		return { ipc: ipc, routes: routes, routeTokens: routeTokens };
	}

	test('owns the route while open, sequences what comes in, and takes reports after done until closed', async () => {
		const { ipc, routes } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, s => changes.push(s), 'c1');
		assert.strictEqual(channel.route, `${deepReviewRoute}/c1`);
		assert.ok(routes.has(channel.route), 'the route is registered on open');

		const post = routes.get(channel.route)!;
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
		assert.strictEqual(routes.has(channel.route), true, 'done marks the review finished but keeps the route');
		assert.deepStrictEqual(await post({ findings: [{ title: 'after talking it over' }] }, new URLSearchParams()), {
			accepted: 1,
		});
		channel.close();
		assert.strictEqual(routes.has(channel.route), false, 'closing takes the route down');

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
				[true, true, [1, 2, 3], [[1, 'f9']]],
				[true, true, [1, 2, 3, 4], [[1, 'f9']]],
				[false, true, [1, 2, 3, 4], [[1, 'f9']]],
			],
		);
		assert.strictEqual(channel.report({ findings: [{ title: 'late' }] }), 0, 'a report after close is dropped');
		assert.strictEqual(channel.state.findings.length, 4);
	});

	test('each channel registers its route under a token of its own', () => {
		const { ipc, routeTokens } = fakeIpc();
		const first = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'a');
		const second = new DeepReviewChannel(ipc, 2, anchor, key, () => {}, 'b');
		assert.ok(first.token, 'a channel has a token');
		assert.strictEqual(routeTokens.get(first.route), first.token, 'the route is registered under it');
		assert.strictEqual(routeTokens.get(second.route), second.token);
		assert.notStrictEqual(first.token, second.token, 'no two channels share one');
		assert.ok(!first.route.includes(first.token), 'the token is not part of the route, which is logged');
	});

	test("on the IPC server the channel's token opens its route and no other, and is not the server's", async () => {
		const server = await createIpcServer<unknown, unknown>();
		try {
			server.registerHandler('gk/other', () => Promise.resolve('other'));
			const channel = new DeepReviewChannel(
				{
					address: server.ipcAddress,
					registerHandler: (name, handler, routeToken) =>
						server.registerHandler(name, handler as IpcHandler<unknown, unknown>, routeToken),
				},
				1,
				anchor,
				key,
				() => {},
				'live',
			);
			assert.notStrictEqual(channel.token, server.ipcToken, "the agent is never given the server's token");

			const post = (route: string, body: unknown) =>
				fetch(`${server.ipcAddress}/${route}`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${channel.token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify(body),
				});
			const reported = await post(channel.route, { findings: [{ title: 'one' }] });
			assert.strictEqual(reported.status, 200);
			assert.deepStrictEqual(await reported.json(), { accepted: 1 });
			assert.strictEqual((await post('gk/other', {})).status, 401, 'another route turns the token away');
			channel.close();
		} finally {
			await server.shutdown();
		}
	});

	test("two channels take routes of their own, so neither takes the other's reports", async () => {
		const { ipc, routes } = fakeIpc();
		const a: DeepReviewState[] = [];
		const b: DeepReviewState[] = [];
		const first = new DeepReviewChannel(ipc, 1, anchor, key, s => a.push(s), 'a');
		const second = new DeepReviewChannel(
			ipc,
			1,
			{ kind: 'commit', repoPath: '/r', sha: 'x' },
			'commit|/r|x',
			s => b.push(s),
			'b',
		);
		assert.notStrictEqual(first.route, second.route);
		await routes.get(second.route)!({ findings: [{ title: 'for b' }] }, new URLSearchParams());
		assert.strictEqual(a.length, 0);
		assert.deepStrictEqual(
			b.map(s => s.findings.map(f => f.finding.title)),
			[['for b']],
		);
	});

	test('a channel open for questions becomes a review when a whole review goes into it', () => {
		const { ipc } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, s => changes.push(s), 'q', 'ask');
		assert.strictEqual(channel.state.purpose, 'ask');
		channel.beginReview();
		channel.beginReview();
		assert.deepStrictEqual(
			changes.map(c => c.purpose),
			['review'],
		);
	});

	test("says how the review's hand-over stands until an agent has it, and never goes back from there", () => {
		const { ipc } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, s => changes.push(s), 'h');
		assert.strictEqual(channel.state.handOff, 'pending');

		channel.reviewOffered(true);
		channel.reviewOffered(false);
		channel.reviewDelivered();
		// Nothing after the review got through makes it look unstarted
		channel.reviewOffered(true);
		channel.reviewFailed();
		channel.close();
		assert.deepStrictEqual(
			changes.map(c => [c.purpose, c.handOff, c.active]),
			[
				['review', 'failed', true],
				['review', 'pending', true],
				['review', 'delivered', true],
				['review', 'delivered', false],
			],
		);
	});

	test('a review no agent got closes its channel when it has no questions', () => {
		const { ipc, routes } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'r');
		channel.reviewFailed();
		assert.strictEqual(channel.state.active, false);
		assert.strictEqual(routes.size, 0);
	});

	test('a report is proof the review arrived, however it got there — notes too, when no question was asked', () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'r');
		channel.reviewOffered(true);
		// The prompt the failed hand-over copied, pasted into an agent by hand
		channel.report({ findings: [] });
		assert.strictEqual(channel.state.handOff, 'failed', 'an empty report proves nothing');
		// A re-review's first word may be a comment on an earlier finding
		channel.report({ findings: [{ findingId: 'f1', comment: 'Still there.' }] });
		assert.strictEqual(channel.state.handOff, 'delivered');

		// The toast is dismissed afterwards: the agent keeps its channel
		channel.reviewFailed();
		assert.deepStrictEqual([channel.state.purpose, channel.state.active], ['review', true]);
	});

	test("a question's answer, finding or not, doesn't stand for a review on its way", () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'q', 'ask');
		channel.beginQuestion();
		channel.questionDelivered();

		channel.beginReview();
		assert.deepStrictEqual([channel.state.purpose, channel.state.handOff], ['review', 'pending']);
		channel.report({ findings: [{ findingId: 'f1', comment: 'Because.' }, { title: 'And this' }] });
		assert.strictEqual(channel.state.handOff, 'pending', 'the answer may well be the question agent');

		// The review is cancelled: back to the questions, whose agent has its prompts
		channel.reviewFailed();
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff, channel.state.active],
			['ask', 'delivered', true],
		);

		// …but the end of a review is the review's, whoever else is talking
		channel.beginReview();
		channel.report({ done: true });
		assert.deepStrictEqual([channel.state.purpose, channel.state.handOff], ['review', 'delivered']);
	});

	test('a question asked while the review is in its picker takes the channel over when the review is cancelled', () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'r');
		channel.beginQuestion();
		// The question's picker replaced the review's
		channel.reviewFailed();
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.active],
			['ask', true],
			'the question is on its way',
		);
		channel.questionDelivered();
		assert.deepStrictEqual(
			[channel.state.purpose, channel.state.handOff, channel.state.active],
			['ask', 'delivered', true],
			'a channel for the question, not a review stuck starting',
		);
	});

	test('a question that never got through stops counting as a possible answer', () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'r');
		channel.beginQuestion();
		channel.questionFailed();
		// The review's dispatch failed too, and its copied prompt was pasted by hand
		channel.reviewOffered(true);
		channel.report({ findings: [{ title: 'one' }] });
		assert.strictEqual(channel.state.handOff, 'delivered', "nothing but the review's agent can be reporting");

		channel.reviewFailed();
		assert.deepStrictEqual([channel.state.purpose, channel.state.active], ['review', true]);
	});

	test('closes once neither the review nor any question has an agent, and none is on its way', () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'q', 'ask');
		channel.beginQuestion();
		channel.beginReview();
		channel.reviewFailed();
		assert.strictEqual(channel.state.active, true, 'the question is still on its way');
		channel.questionFailed();
		assert.strictEqual(channel.state.active, false, 'no agent got either');
	});

	test('hands a reading plan to whoever waits on one, and turns away what is not a plan', async () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'p', 'ask');
		const plan = { overview: 'o', groups: [{ label: 'Core', files: [{ path: './a.ts', note: 'n' }] }] };
		assert.strictEqual(channel.report({ plan: plan }), 0, 'nobody is waiting');

		const waiting = channel.waitForPlan();
		assert.strictEqual(channel.report({ plan: { overview: 'o', groups: [] } }), 0, 'an empty plan is no plan');
		assert.strictEqual(channel.report({ plan: plan }), 1);
		const got = await waiting;
		assert.deepStrictEqual(
			got.groups[0].files.map(f => f.path),
			['a.ts'],
		);
		assert.strictEqual(channel.state.handOff, 'delivered', 'the plan is the questions’ kind of answer');
	});

	test('a plan never comes when the channel closes or the wait is called off', async () => {
		const { ipc } = fakeIpc();
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, () => {}, 'p', 'ask');
		const aborter = new AbortController();
		const abandoned = channel.waitForPlan(aborter.signal);
		const closed = channel.waitForPlan();
		aborter.abort();
		await assert.rejects(abandoned);
		channel.close();
		await assert.rejects(closed, /closed before it sent a reading plan/);
		await assert.rejects(channel.waitForPlan(), /closed before it sent a reading plan/);
	});

	test('closing by hand notifies once and keeps what was reported', () => {
		const { ipc, routes } = fakeIpc();
		const changes: DeepReviewState[] = [];
		const channel = new DeepReviewChannel(ipc, 1, anchor, key, s => changes.push(s), 'c1');
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
