import type { RowTopology } from '../delta.js';
import type { GraphCommit } from '../types.js';

export type BenchmarkGraphRow = RowTopology & {
	message: string;
	payloadVersion: number;
};

export interface CommitGraphBenchmarkFixture {
	/** Complete, newest-to-oldest graph. */
	readonly rows: readonly BenchmarkGraphRow[];
	/** Fresh row objects with identical topology and different consumer payload. */
	readonly payloadRows: readonly BenchmarkGraphRow[];
	/** The initially loaded prefix used by the paging/append scenario. */
	readonly pagedPrefix: readonly BenchmarkGraphRow[];
	/** A new head prepended to the complete graph, forcing prefix replacement. */
	readonly replacedPrefixRows: readonly BenchmarkGraphRow[];
}

function shaFor(index: number): string {
	return index.toString(16).padStart(40, '0');
}

/**
 * Creates a deterministic synthetic history with roughly 24 simultaneously-live shortcut lanes.
 * Each row's parents occur later in the array, preserving the engine's newest-to-oldest contract.
 * The long second-parent span deliberately stresses lane allocation and edge bookkeeping without
 * relying on a machine-local Git repository or wall-clock timestamps.
 */
export function createCommitGraphBenchmarkFixture(count: number): CommitGraphBenchmarkFixture {
	if (!Number.isSafeInteger(count) || count < 2) {
		throw new Error(`Commit-graph benchmark size must be an integer greater than one; got ${count}`);
	}

	const laneSpan = 145;
	const rows: BenchmarkGraphRow[] = [];
	for (let i = 0; i < count; i++) {
		const parents: string[] = [];
		if (i + 1 < count) {
			parents.push(shaFor(i + 1));
		}
		if (i % 6 === 0 && i + laneSpan < count) {
			parents.push(shaFor(i + laneSpan));
		}

		rows.push({
			sha: shaFor(i),
			parents: parents,
			kind: parents.length > 1 ? 'merge' : 'commit',
			date: 2_000_000_000_000 - i * 1_000,
			message: `commit ${i} payload 1`,
			payloadVersion: 1,
		});
	}

	const payloadRows = rows.map(row => ({
		...row,
		message: `${row.message.slice(0, -1)}2`,
		payloadVersion: 2,
	}));
	const prefixLength = Math.max(1, Math.floor(count * 0.75));
	const newHead: BenchmarkGraphRow = {
		sha: shaFor(count + 1),
		parents: [rows[0].sha],
		kind: 'commit',
		date: rows[0].date! + 1_000,
		message: 'new head payload 2',
		payloadVersion: 2,
	};

	return {
		rows: rows,
		payloadRows: payloadRows,
		pagedPrefix: rows.slice(0, prefixLength),
		replacedPrefixRows: [newHead, ...payloadRows],
	};
}

export function benchmarkRowToCommit(row: BenchmarkGraphRow): GraphCommit {
	return {
		sha: row.sha,
		shortSha: row.sha.slice(0, 7),
		message: row.message,
		author: 'Benchmark',
		authorEmail: 'benchmark@gitkraken.com',
		date: row.date ?? 0,
		parents: row.parents,
		kind: row.kind ?? 'commit',
	};
}
