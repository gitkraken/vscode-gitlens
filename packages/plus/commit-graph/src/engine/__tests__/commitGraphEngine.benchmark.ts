/**
 * Commit-graph engine performance contract.
 *
 * The default matrix includes the 100k-row stress fixture intended for baseline capture. Use
 * `--quick` for local smoke validation and `--json <path>` to persist a machine-readable result.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { Session as InspectorSession } from 'node:inspector/promises';
import { cpus } from 'node:os';
import { dirname, resolve } from 'node:path';
import { Bench } from 'tinybench';
import { CommitGraphEngineSession } from '../session.js';
import type { CommitGraphSessionTransition } from '../session.js';
import type { GraphCommit } from '../types.js';
import type { BenchmarkGraphRow, CommitGraphBenchmarkFixture } from './benchmarkFixtures.js';
import { benchmarkRowToCommit, createCommitGraphBenchmarkFixture } from './benchmarkFixtures.js';

type Scenario = 'append' | 'initial' | 'payload' | 'prefix-replace';

interface BenchmarkResult {
	rows: number;
	scenario: Scenario;
	transition: CommitGraphSessionTransition['kind'];
	latencyMs: { mean: number; p50: number; p75: number; p99: number; rme: number };
	throughputOpsPerSecond: number;
	samples: number;
	totalTimeMs: number;
	memory?: {
		samples: number;
		/** Bytes sampled by V8's allocation profiler during one isolated transition. */
		allocationSampledBytes: number;
		/** Live-heap change after a forced GC before and after the same transition. */
		retainedHeapDeltaBytes: number;
	};
}

const argv = process.argv.slice(2);
const quick = argv.includes('--quick');
const profileAllocations = !quick || argv.includes('--profile-allocations');

function option(name: string): string | undefined {
	const equals = argv.find(arg => arg.startsWith(`${name}=`));
	if (equals != null) return equals.slice(name.length + 1);

	const index = argv.indexOf(name);
	return index === -1 ? undefined : argv[index + 1];
}

function parseSizes(): number[] {
	const raw = option('--sizes');
	const sizes = raw == null ? (quick ? [200, 2_000] : [200, 2_000, 10_000, 100_000]) : raw.split(',').map(Number);
	if (sizes.length === 0 || sizes.some(size => !Number.isSafeInteger(size) || size < 2)) {
		throw new Error(`--sizes must be a comma-separated list of integers greater than one; got "${raw}"`);
	}
	return [...new Set(sizes)];
}

function positiveIntegerOption(name: string, fallback: number): number {
	const raw = option(name);
	if (raw == null) return fallback;

	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer; got "${raw}"`);
	}
	return value;
}

function expectedTransition(scenario: Scenario): CommitGraphSessionTransition['kind'] {
	switch (scenario) {
		case 'initial':
			return 'initial';
		case 'payload':
			return 'payload';
		case 'append':
			return 'append';
		case 'prefix-replace':
			return 'replace';
	}
}

const scenarios: readonly Scenario[] = ['initial', 'payload', 'append', 'prefix-replace'];
const sizes = parseSizes();
const results: BenchmarkResult[] = [];
let sink = 0;

function prepareScenario(
	scenario: Scenario,
	fixture: CommitGraphBenchmarkFixture,
): {
	session: CommitGraphEngineSession<BenchmarkGraphRow, GraphCommit>;
	input: readonly BenchmarkGraphRow[];
} {
	const session = new CommitGraphEngineSession<BenchmarkGraphRow, GraphCommit>();
	switch (scenario) {
		case 'initial':
			return { session: session, input: fixture.rows };
		case 'payload':
			session.update({ identity: 'benchmark', sourceRows: fixture.rows, toCommit: benchmarkRowToCommit });
			return { session: session, input: fixture.payloadRows };
		case 'append':
			session.update({ identity: 'benchmark', sourceRows: fixture.pagedPrefix, toCommit: benchmarkRowToCommit });
			return { session: session, input: fixture.rows };
		case 'prefix-replace':
			session.update({ identity: 'benchmark', sourceRows: fixture.rows, toCommit: benchmarkRowToCommit });
			return { session: session, input: fixture.replacedPrefixRows };
	}
}

function addScenarioTask(bench: Bench, scenario: Scenario, fixture: CommitGraphBenchmarkFixture): void {
	let prepared = prepareScenario(scenario, fixture);
	bench.add(
		scenario,
		() => {
			const state = prepared.session.update({
				identity: 'benchmark',
				sourceRows: prepared.input,
				toCommit: benchmarkRowToCommit,
			});
			sink ^= state.rows.length + state.revision;
		},
		{
			beforeEach: () => {
				prepared = prepareScenario(scenario, fixture);
			},
		},
	);
}

function sampledBytes(node: {
	selfSize: number;
	children: readonly { selfSize: number; children: readonly unknown[] }[];
}): number {
	let total = node.selfSize;
	for (const child of node.children) {
		total += sampledBytes(child as typeof node);
	}
	return total;
}

async function profileScenario(
	scenario: Scenario,
	fixture: CommitGraphBenchmarkFixture,
): Promise<NonNullable<BenchmarkResult['memory']>> {
	const allocations: number[] = [];
	const retained: number[] = [];
	const samples = positiveIntegerOption('--memory-samples', quick ? 1 : 5);
	for (let sample = 0; sample < samples; sample++) {
		const prepared = prepareScenario(scenario, fixture);
		globalThis.gc?.();
		const heapBefore = process.memoryUsage().heapUsed;
		const inspector = new InspectorSession();
		inspector.connect();
		try {
			await inspector.post('HeapProfiler.enable');
			await inspector.post('HeapProfiler.startSampling', { samplingInterval: 4 * 1024 });
			const state = prepared.session.update({
				identity: 'benchmark',
				sourceRows: prepared.input,
				toCommit: benchmarkRowToCommit,
			});
			sink ^= state.rows.length + state.revision;
			const { profile } = await inspector.post('HeapProfiler.stopSampling');
			allocations.push(sampledBytes(profile.head));
			globalThis.gc?.();
			retained.push(process.memoryUsage().heapUsed - heapBefore);
		} finally {
			inspector.disconnect();
		}
	}
	const median = (values: number[]): number => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
	return {
		samples: samples,
		allocationSampledBytes: median(allocations),
		retainedHeapDeltaBytes: median(retained),
	};
}

async function runSize(rows: number): Promise<BenchmarkResult[]> {
	const fixture = createCommitGraphBenchmarkFixture(rows);
	// Fail before collecting timings if the fixture stops exercising the transition named in the report.
	for (const scenario of scenarios) {
		const prepared = prepareScenario(scenario, fixture);
		const actual = prepared.session.update({
			identity: 'benchmark',
			sourceRows: prepared.input,
			toCommit: benchmarkRowToCommit,
		});
		if (actual.transition.kind !== expectedTransition(scenario)) {
			throw new Error(
				`${rows} rows / ${scenario} produced ${actual.transition.kind}, expected ${expectedTransition(scenario)}`,
			);
		}
	}

	const defaultIterations = quick ? 4 : rows >= 100_000 ? 3 : rows >= 10_000 ? 5 : 10;
	const iterations = positiveIntegerOption('--iterations', defaultIterations);
	const time = positiveIntegerOption('--time', quick ? 40 : 150);
	const warmupTime = positiveIntegerOption('--warmup-time', quick ? 20 : 75);
	const bench = new Bench({
		iterations: iterations,
		retainSamples: false,
		time: time,
		warmupIterations: quick ? 2 : Math.max(2, Math.ceil(iterations / 2)),
		warmupTime: warmupTime,
	});

	for (const scenario of scenarios) {
		addScenarioTask(bench, scenario, fixture);
	}

	await bench.run();
	const sizeResults: BenchmarkResult[] = [];
	for (const task of bench.tasks) {
		if (task.result.state !== 'completed') {
			throw new Error(`${rows} rows / ${task.name} did not complete (${task.result.state})`);
		}

		const scenario = task.name as Scenario;
		sizeResults.push({
			rows: rows,
			scenario: scenario,
			transition: expectedTransition(scenario),
			latencyMs: {
				mean: task.result.latency.mean,
				p50: task.result.latency.p50,
				p75: task.result.latency.p75,
				p99: task.result.latency.p99,
				rme: task.result.latency.rme,
			},
			throughputOpsPerSecond: task.result.throughput.mean,
			samples: task.result.latency.samplesCount,
			totalTimeMs: task.result.totalTime,
		});
	}
	if (profileAllocations) {
		for (const result of sizeResults) {
			result.memory = await profileScenario(result.scenario, fixture);
		}
	}

	console.log(`\n${rows.toLocaleString()} rows`);
	console.table(
		sizeResults.map(result => ({
			transition: result.scenario,
			'mean (ms)': result.latencyMs.mean.toFixed(3),
			'p99 (ms)': result.latencyMs.p99.toFixed(3),
			'RME (%)': result.latencyMs.rme.toFixed(2),
			samples: result.samples,
		})),
	);
	return sizeResults;
}

for (const rows of sizes) {
	results.push(...(await runSize(rows)));
}

const report = {
	schemaVersion: 2,
	benchmark: 'commit-graph-engine',
	createdAt: new Date().toISOString(),
	runtime: {
		node: process.version,
		platform: process.platform,
		arch: process.arch,
		cpu: cpus()[0]?.model,
	},
	configuration: {
		quick: quick,
		sizes: sizes,
		profileAllocations: profileAllocations,
		iterations: option('--iterations') == null ? undefined : positiveIntegerOption('--iterations', 1),
		timeMs: option('--time') == null ? undefined : positiveIntegerOption('--time', 1),
		warmupTimeMs: option('--warmup-time') == null ? undefined : positiveIntegerOption('--warmup-time', 1),
		memorySamples:
			!profileAllocations || option('--memory-samples') == null
				? undefined
				: positiveIntegerOption('--memory-samples', 1),
	},
	results: results,
};

const jsonPath = option('--json');
if (jsonPath != null) {
	const absolutePath = resolve(jsonPath);
	await mkdir(dirname(absolutePath), { recursive: true });
	await writeFile(absolutePath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(`Wrote benchmark report to ${absolutePath}`);
}

// Keep the measured state observable without adding output to individual samples.
if (sink === Number.MIN_SAFE_INTEGER) {
	console.log(sink);
}
