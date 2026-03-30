/**
 * Serialization benchmark for Supertalk RPC with Graph-scale payloads.
 *
 * Validates that Supertalk's Connection can handle large arrays of
 * GraphRow-like objects (the dominant payload shape for the Commit Graph
 * webview) with acceptable overhead.
 *
 * Uses `nestedProxies: false` deliberately (not the production default) —
 * benchmarks the non-recursive path where plain data arrays skip the
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
			type: i % 4 === 0 ? 'stash-node' : i % 3 === 0 ? 'merge-node' : 'commit-node',
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
function adaptPort(port: import('node:worker_threads').MessagePort): Endpoint {
	// Cast needed because Endpoint.postMessage uses DOM's Transferable type,
	// which isn't available in the Node.js tsconfig target.
	return {
		postMessage: (message: unknown, transfer?: unknown[]) => {
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
	} as unknown as Endpoint;
}

/**
 * Creates a connected host/client Connection pair using MessageChannel.
 * Returns the client-side remote proxy and a cleanup function.
 */
async function createConnectionPair<T extends object>(
	services: T,
): Promise<{ remote: Remote<T>; dispose: () => void }> {
	const { port1, port2 } = new MessageChannel();

	// Start both ports (required for Node MessagePort to dispatch messages)
	port1.start();
	port2.start();

	const hostEndpoint = adaptPort(port1);
	const clientEndpoint = adaptPort(port2);

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
			assert.strictEqual(first.type, 'stash-node');

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
			assert.strictEqual(rows[0].type, 'stash-node'); // 0 % 4 === 0
			assert.strictEqual(rows[1].type, 'commit-node'); // 1 % 4 !== 0, 1 % 3 !== 0
			assert.strictEqual(rows[3].type, 'merge-node'); // 3 % 3 === 0
		} finally {
			dispose();
		}
	});

	test('should handle 100 GraphRow-like objects within acceptable time', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			const start = performance.now();
			const rows = await remote.getRows(100);
			const elapsed = performance.now() - start;

			assert.strictEqual(rows.length, 100);
			assert.ok(elapsed < 50, `100 rows took ${elapsed.toFixed(1)}ms, expected < 50ms`);
		} finally {
			dispose();
		}
	});

	test('should handle 500 GraphRow-like objects within acceptable time', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			const start = performance.now();
			const rows = await remote.getRows(500);
			const elapsed = performance.now() - start;

			assert.strictEqual(rows.length, 500);
			assert.ok(elapsed < 50, `500 rows took ${elapsed.toFixed(1)}ms, expected < 50ms`);
		} finally {
			dispose();
		}
	});

	test('should handle 1000 GraphRow-like objects within acceptable time', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			const start = performance.now();
			const rows = await remote.getRows(1000);
			const elapsed = performance.now() - start;

			assert.strictEqual(rows.length, 1000);
			assert.ok(elapsed < 50, `1000 rows took ${elapsed.toFixed(1)}ms, expected < 50ms`);
		} finally {
			dispose();
		}
	});

	test('should scale roughly linearly from 100 to 1000 rows', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			// Warm up — first call may include JIT overhead
			await remote.getRows(50);

			// Measure 100 rows
			const start100 = performance.now();
			await remote.getRows(100);
			const elapsed100 = performance.now() - start100;

			// Measure 1000 rows
			const start1000 = performance.now();
			await remote.getRows(1000);
			const elapsed1000 = performance.now() - start1000;

			// The 1000-row call should not take more than 20x the 100-row call.
			// For linear scaling the theoretical ratio is 10x; we allow 20x to
			// absorb jitter, GC pauses, and constant-factor overhead.
			const ratio = elapsed1000 / Math.max(elapsed100, 0.01);
			assert.ok(
				ratio < 20,
				`Scaling ratio ${ratio.toFixed(1)}x exceeds 20x threshold ` +
					`(100 rows: ${elapsed100.toFixed(1)}ms, 1000 rows: ${elapsed1000.toFixed(1)}ms)`,
			);
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
					type: 'merge-node',
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

		const services = {
			getDenseRows: (count: number) => generateDenseRows(count),
		};

		const { remote, dispose } = await createConnectionPair(services);

		try {
			const start = performance.now();
			const rows = await remote.getDenseRows(1000);
			const elapsed = performance.now() - start;

			assert.strictEqual(rows.length, 1000);

			// Dense rows have more properties, so allow a higher budget
			assert.ok(elapsed < 100, `1000 dense rows took ${elapsed.toFixed(1)}ms, expected < 100ms`);

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

	test.skip('should handle multiple sequential calls without degradation', async () => {
		const services: GraphDataService = {
			getRows: (count: number) => generateRows(count),
			echo: (value: string) => value,
		};

		const { remote, dispose } = await createConnectionPair<GraphDataService>(services);

		try {
			// Warm up at the same payload size to absorb JIT overhead
			await remote.getRows(500);

			const timings: number[] = [];
			const iterations = 5;

			for (let i = 0; i < iterations; i++) {
				const start = performance.now();
				const rows = await remote.getRows(500);
				timings.push(performance.now() - start);
				assert.strictEqual(rows.length, 500);
			}

			// CI runners see higher relative variance, so allowing a wider threshold
			// eslint-disable-next-line no-restricted-globals
			const maxRatio = process.env.CI ? 10 : 5;
			const fastest = Math.min(...timings);
			const slowest = Math.max(...timings);
			const ratio = slowest / Math.max(fastest, 0.01);

			assert.ok(
				ratio < maxRatio,
				`Sequential call variance too high: fastest=${fastest.toFixed(1)}ms, ` +
					`slowest=${slowest.toFixed(1)}ms, ratio=${ratio.toFixed(1)}x (limit=${maxRatio}x)`,
			);
		} finally {
			dispose();
		}
	});
});
