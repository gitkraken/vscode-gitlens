/**
 * Serialization coverage for Supertalk RPC with Graph-scale payloads.
 *
 * Validates that Supertalk's Connection can carry large arrays of
 * GraphRow-like objects (the dominant payload shape for the Commit Graph
 * webview) intact and at a payload-independent transport cost — measured in
 * messages posted, so the guard is deterministic on any machine.
 *
 * Uses `nestedProxies: false` deliberately (not the production default) —
 * exercises the non-recursive path where plain data arrays skip the
 * `#processForClone` walk. Production uses `nestedProxies: true` because
 * GetOverviewBranch has nested Promises and the JSON transport needs
 * DateHandler traversal for nested Dates.
 *
 * Uses Node's built-in MessageChannel to create a real in-process RPC
 * link — same serialization path as production, just without VS Code's
 * webview intermediary (which adds JSON serialization overhead).
 */
import * as assert from 'assert';
import { MessageChannel } from 'node:worker_threads';
import type { Endpoint, Remote } from '@eamodio/supertalk';
import { Connection } from '@eamodio/supertalk';
import { rpcHandlers } from '../../../system/rpc/handlers.js';

// ============================================================
// Synthetic GraphRow shape (mirrors @gitkraken/gitkraken-components)
// ============================================================

interface SyntheticHead {
	id: string;
	name: string;
	isCurrentHead: boolean;
}

interface SyntheticRemote {
	id: string;
	name: string;
	url: string;
}

interface SyntheticTag {
	id: string;
	name: string;
	annotated: boolean;
}

interface SyntheticGraphRow {
	sha: string;
	parents: string[];
	author: string;
	email: string;
	date: number;
	message: string;
	type: string;
	heads?: SyntheticHead[];
	remotes?: SyntheticRemote[];
	tags?: SyntheticTag[];
	contexts?: Record<string, unknown>;
}

// ============================================================
// Service interface exposed on the "host" side
// ============================================================

interface GraphDataService {
	getRows(count: number): SyntheticGraphRow[];
	echo(value: string): string;
}

// ============================================================
// Helpers
// ============================================================

function generateRows(count: number): SyntheticGraphRow[] {
	const rows: SyntheticGraphRow[] = [];
	for (let i = 0; i < count; i++) {
		const row: SyntheticGraphRow = {
			sha: `${'a'.repeat(38)}${String(i).padStart(2, '0')}`,
			parents: [`${'b'.repeat(38)}${String(i).padStart(2, '0')}`],
			author: `Author ${i}`,
			email: `author${i}@example.com`,
			date: Date.now() - i * 60000,
			message: `Commit message for ${i} - fixes something important`,
			type: i % 4 === 0 ? 'stash' : i % 3 === 0 ? 'merge' : 'commit',
		};

		// ~20% of rows have branch heads
		if (i % 5 === 0) {
			row.heads = [{ id: `branch-${i}`, name: `feature/branch-${i}`, isCurrentHead: i === 0 }];
		}

		// ~10% of rows have remotes
		if (i % 10 === 0) {
			row.remotes = [{ id: `remote-${i}`, name: `origin/feature-${i}`, url: `https://github.com/org/repo.git` }];
		}

		// ~7% of rows have tags
		if (i % 15 === 0) {
			row.tags = [{ id: `tag-${i}`, name: `v1.${i}.0`, annotated: i % 2 === 0 }];
		}

		// ~5% of rows have contexts
		if (i % 20 === 0) {
			row.contexts = { pullRequest: { id: i, url: `https://github.com/org/repo/pull/${i}` } };
		}

		rows.push(row);
	}
	return rows;
}

/**
 * Adapts a Node.js `worker_threads` MessagePort to Supertalk's Endpoint.
 *
 * Node MessagePorts use `on`/`off` instead of `addEventListener`/`removeEventListener`
 * and emit data directly instead of wrapping it in a MessageEvent.
 */
function adaptPort(port: import('node:worker_threads').MessagePort, counter: { count: number }): Endpoint {
	// Cast needed because Endpoint.postMessage uses DOM's Transferable type,
	// which isn't available in the Node.js tsconfig target.
	return {
		postMessage: (message: unknown, transfer?: unknown[]) => {
			counter.count++;
			port.postMessage(message, (transfer ?? []) as import('node:worker_threads').TransferListItem[]);
		},
		addEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
			port.on('message', (data: unknown) => {
				listener({ data: data } as MessageEvent);
			});
		},
		removeEventListener: (_type: 'message', listener: (event: MessageEvent) => void) => {
			// Node MessagePort doesn't support removing by the wrapped listener,
			// but for this test the connection lifecycle is managed by close().
			void listener;
		},
	};
}

/**
 * Creates a connected host/client Connection pair using MessageChannel.
 * Returns the client-side remote proxy, a running count of messages posted across both endpoints,
 * and a cleanup function.
 */
async function createConnectionPair<T extends object>(
	services: T,
): Promise<{ remote: Remote<T>; messages: () => number; dispose: () => void }> {
	const { port1, port2 } = new MessageChannel();

	// Start both ports (required for Node MessagePort to dispatch messages)
	port1.start();
	port2.start();

	const counter = { count: 0 };
	const hostEndpoint = adaptPort(port1, counter);
	const clientEndpoint = adaptPort(port2, counter);

	const connectionOptions = {
		handlers: [...rpcHandlers],
		// Match production config: plain data skips recursive traversal
		nestedProxies: false,
	};

	// Host side: create connection and expose services
	const hostConnection = new Connection(hostEndpoint, connectionOptions);
	hostConnection.expose(services);

	// Client side: create connection and wait for ready
	const clientConnection = new Connection(clientEndpoint, connectionOptions);
	const remote = (await clientConnection.waitForReady()) as Remote<T>;

	return {
		remote: remote,
		messages: () => counter.count,
		dispose: () => {
			clientConnection.close();
			hostConnection.close();
			port1.close();
			port2.close();
		},
	};
}

// ============================================================
// Tests
// ============================================================

suite('Serialization Benchmark Test Suite', () => {
	test('should round-trip a simple value to verify the connection works', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			const result = await remote.echo('hello');
			assert.strictEqual(result, 'hello');
		} finally {
			dispose();
		}
	});

	test('should correctly serialize and deserialize GraphRow-like objects', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			const rows = await remote.getRows(10);

			assert.strictEqual(rows.length, 10);

			// Verify first row structure
			const first = rows[0];
			assert.strictEqual(first.sha, `${'a'.repeat(38)}00`);
			assert.deepStrictEqual(first.parents, [`${'b'.repeat(38)}00`]);
			assert.strictEqual(first.author, 'Author 0');
			assert.strictEqual(first.email, 'author0@example.com');
			assert.strictEqual(typeof first.date, 'number');
			assert.strictEqual(first.message, 'Commit message for 0 - fixes something important');
			assert.strictEqual(first.type, 'stash');

			// Row 0 should have heads (0 % 5 === 0)
			assert.ok(first.heads, 'row 0 should have heads');
			assert.strictEqual(first.heads.length, 1);
			assert.strictEqual(first.heads[0].name, 'feature/branch-0');
			assert.strictEqual(first.heads[0].isCurrentHead, true);

			// Row 0 should have remotes (0 % 10 === 0)
			assert.ok(first.remotes, 'row 0 should have remotes');
			assert.strictEqual(first.remotes.length, 1);

			// Row 0 should have tags (0 % 15 === 0)
			assert.ok(first.tags, 'row 0 should have tags');

			// Row 0 should have contexts (0 % 20 === 0)
			assert.ok(first.contexts, 'row 0 should have contexts');

			// Row 1 should NOT have heads (1 % 5 !== 0)
			assert.strictEqual(rows[1].heads, undefined);

			// Verify type distribution
			assert.strictEqual(rows[0].type, 'stash'); // 0 % 4 === 0
			assert.strictEqual(rows[1].type, 'commit'); // 1 % 4 !== 0, 1 % 3 !== 0
			assert.strictEqual(rows[3].type, 'merge'); // 3 % 3 === 0
		} finally {
			dispose();
		}
	});

	// Payload cost is asserted in MESSAGES, not milliseconds: one request plus one response per call and
	// no per-row traffic. That constant IS the linear-scaling property the transport has to hold, and
	// unlike a wall-clock budget it doesn't move under a loaded CI runner. Deep-equality on the way back
	// is what proves the rows crossed as cloned plain data — a proxied row can't satisfy it.
	for (const count of [100, 500, 1000]) {
		test(`should carry ${count} GraphRow-like objects as plain data at a fixed message cost`, async () => {
			const rows = generateRows(count);
			const services: GraphDataService = {
				getRows: (n: number) => rows.slice(0, n),
				echo: (value: string) => value,
			};

			const { remote, messages, dispose } = await createConnectionPair<GraphDataService>(services);

			try {
				// Warm up first: the baseline has to be a STEADY-state per-call cost. Measuring it on the
				// very first call would fold any one-time setup traffic into `perCall` and then report the
				// full payload as cheaper than a single row.
				await remote.getRows(1);

				// A single-row call establishes the per-call cost the full payload has to match.
				const oneRowMark = messages();
				await remote.getRows(1);
				const perCall = messages() - oneRowMark;
				assert.ok(perCall > 0, 'expected a call to post at least one message');

				const mark = messages();
				const received = await remote.getRows(count);

				assert.strictEqual(received.length, count);
				assert.strictEqual(
					messages() - mark,
					perCall,
					`${count} rows cost ${messages() - mark} messages, a single row costs ${perCall}`,
				);
				assert.deepStrictEqual(received, rows);
			} finally {
				dispose();
			}
		});
	}

	test('should scale from 100 to 1000 rows with no per-row transport overhead', async () => {
		const rows = generateRows(1000);
		const services: GraphDataService = {
			getRows: (n: number) => rows.slice(0, n),
			echo: (value: string) => value,
		};

		const { remote, messages, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			// Warm up so neither measurement absorbs one-time setup traffic
			await remote.getRows(1);

			const mark100 = messages();
			await remote.getRows(100);
			const cost100 = messages() - mark100;

			const mark1000 = messages();
			await remote.getRows(1000);
			const cost1000 = messages() - mark1000;

			// Without this the equality below would hold vacuously if the counter ever stopped counting
			assert.ok(cost100 > 0, 'expected a call to post at least one message');
			assert.strictEqual(cost1000, cost100, `1000 rows cost ${cost1000} messages, 100 rows cost ${cost100}`);
		} finally {
			dispose();
		}
	});

	test('should handle rows with dense optional fields', async () => {
		// All rows have all optional fields populated — worst case for serialization
		function generateDenseRows(count: number): SyntheticGraphRow[] {
			const rows: SyntheticGraphRow[] = [];
			for (let i = 0; i < count; i++) {
				rows.push({
					sha: `${'c'.repeat(38)}${String(i).padStart(2, '0')}`,
					parents: [
						`${'d'.repeat(38)}${String(i).padStart(2, '0')}`,
						`${'e'.repeat(38)}${String(i).padStart(2, '0')}`,
					],
					author: `Dense Author ${i}`,
					email: `dense${i}@example.com`,
					date: Date.now() - i * 30000,
					message: `Dense commit ${i} with a longer message that exercises serialization`,
					type: 'merge',
					heads: [
						{ id: `head-a-${i}`, name: `feature/a-${i}`, isCurrentHead: false },
						{ id: `head-b-${i}`, name: `feature/b-${i}`, isCurrentHead: false },
					],
					remotes: [{ id: `remote-${i}`, name: `origin/main`, url: 'https://github.com/org/repo.git' }],
					tags: [{ id: `tag-${i}`, name: `v2.${i}.0`, annotated: true }],
					contexts: {
						pullRequest: { id: i, url: `https://github.com/org/repo/pull/${i}`, state: 'open' },
						build: { status: 'success', ci: 'github-actions' },
					},
				});
			}
			return rows;
		}

		const dense = generateDenseRows(1000);
		const services = {
			getDenseRows: (count: number) => dense.slice(0, count),
		};

		const { remote, messages, dispose } = await createConnectionPair(services);

		try {
			// Warm up so the baseline is a steady-state per-call cost, not first-call setup traffic
			await remote.getDenseRows(1);

			const oneRowMark = messages();
			await remote.getDenseRows(1);
			const perCall = messages() - oneRowMark;
			assert.ok(perCall > 0, 'expected a call to post at least one message');

			const mark = messages();
			const rows = await remote.getDenseRows(1000);

			assert.strictEqual(rows.length, 1000);
			// Every optional field populated on every row — still one request and one response.
			assert.strictEqual(messages() - mark, perCall);
			assert.deepStrictEqual(rows, dense);

			// Spot-check structure
			const row = rows[0];
			assert.strictEqual(row.heads!.length, 2);
			assert.strictEqual(row.remotes!.length, 1);
			assert.strictEqual(row.tags!.length, 1);
			assert.ok(row.contexts!['pullRequest']);
			assert.ok(row.contexts!['build']);
		} finally {
			dispose();
		}
	});

	test('should handle multiple sequential calls without degradation', async () => {
		const rows = generateRows(500);
		const services: GraphDataService = {
			getRows: (n: number) => rows.slice(0, n),
			echo: (value: string) => value,
		};

		const { remote, messages, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			// Warm up at the same payload size so the first measured call isn't the one paying for setup
			await remote.getRows(500);

			// Degradation shows up as a growing per-call message cost — retained state, a re-handshake, or
			// proxies accumulating across calls. Repeating one identical call has to stay flat.
			const costs: number[] = [];
			for (let i = 0; i < 5; i++) {
				const mark = messages();
				const received = await remote.getRows(500);
				costs.push(messages() - mark);
				assert.strictEqual(received.length, 500);
			}

			// Without this the equalities below would hold vacuously if the counter ever stopped counting
			assert.ok(costs[0] > 0, 'expected a call to post at least one message');
			for (const [i, cost] of costs.entries()) {
				assert.strictEqual(cost, costs[0], `call ${i + 1} cost ${cost} messages, the first cost ${costs[0]}`);
			}
		} finally {
			dispose();
		}
	});
});
