#!/usr/bin/env node

/** Compare two commit-graph engine reports captured on the same runner. */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		baseline: { type: 'string' },
		candidate: { type: 'string' },
		json: { type: 'string' },
		'latency-tolerance': { type: 'string', default: '0.01' },
		'memory-tolerance': { type: 'string', default: '0.05' },
	},
});
if (values.baseline == null || values.candidate == null) {
	throw new Error('Usage: compareGraphPerformance.mjs --baseline <report> --candidate <report> [--json <report>]');
}

function fraction(name, raw) {
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
	return value;
}

async function readReport(path) {
	const report = JSON.parse(await readFile(resolve(path), 'utf8'));
	if (report.schemaVersion !== 2 || report.benchmark !== 'commit-graph-engine') {
		throw new Error(`${path} is not a commit-graph engine report with schema version 2`);
	}
	return report;
}

const [baseline, candidate] = await Promise.all([readReport(values.baseline), readReport(values.candidate)]);
for (const field of ['platform', 'arch', 'cpu']) {
	if (baseline.runtime[field] !== candidate.runtime[field]) {
		throw new Error(`Reports were captured on different ${field} values`);
	}
}
if (baseline.runtime.node.split('.')[0] !== candidate.runtime.node.split('.')[0]) {
	throw new Error('Reports were captured with different Node major versions');
}

const latencyTolerance = fraction('--latency-tolerance', values['latency-tolerance']);
const memoryTolerance = fraction('--memory-tolerance', values['memory-tolerance']);
const keyOf = result => `${result.rows}:${result.scenario}`;
const baselineByKey = new Map(baseline.results.map(result => [keyOf(result), result]));
const comparisons = candidate.results.map(result => {
	const key = keyOf(result);
	const prior = baselineByKey.get(key);
	if (prior == null) throw new Error(`Candidate contains unmatched result ${key}`);
	baselineByKey.delete(key);

	const observed = result.latencyMs.mean / prior.latencyMs.mean - 1;
	// Tinybench reports each mean's relative margin of error. Combine independent margins
	// conservatively; an uncertain apparent win is not evidence that the hot path stayed neutral.
	const uncertainty = Math.hypot(result.latencyMs.rme / 100, prior.latencyMs.rme / 100);
	const upperBound = observed + uncertainty;
	const latencyStatus =
		observed > latencyTolerance ? 'regression' : upperBound > latencyTolerance ? 'inconclusive' : 'pass';

	let allocationRegression;
	if (prior.memory != null && result.memory != null) {
		const baseBytes = prior.memory.allocationSampledBytes;
		const candidateBytes = result.memory.allocationSampledBytes;
		allocationRegression =
			baseBytes === 0 ? (candidateBytes === 0 ? 0 : Number.POSITIVE_INFINITY) : candidateBytes / baseBytes - 1;
	}

	return {
		rows: result.rows,
		scenario: result.scenario,
		baselineMeanMs: prior.latencyMs.mean,
		candidateMeanMs: result.latencyMs.mean,
		latencyRegression: observed,
		latencyUpperBound: upperBound,
		latencyStatus: latencyStatus,
		allocationRegression: allocationRegression,
		allocationStatus:
			allocationRegression == null
				? 'not-measured'
				: allocationRegression <= memoryTolerance
					? 'pass'
					: 'regression',
	};
});
if (baselineByKey.size !== 0) {
	throw new Error(`Baseline contains results missing from candidate: ${[...baselineByKey.keys()].join(', ')}`);
}

const failures = comparisons.filter(
	result => result.latencyStatus !== 'pass' || result.allocationStatus === 'regression',
);
const report = {
	schemaVersion: 1,
	comparison: 'commit-graph-engine',
	createdAt: new Date().toISOString(),
	tolerances: { latency: latencyTolerance, memory: memoryTolerance },
	baseline: resolve(values.baseline),
	candidate: resolve(values.candidate),
	comparisons: comparisons,
	passed: failures.length === 0,
};

console.table(
	comparisons.map(result => ({
		rows: result.rows,
		scenario: result.scenario,
		'latency change': `${(result.latencyRegression * 100).toFixed(2)}%`,
		'upper bound': `${(result.latencyUpperBound * 100).toFixed(2)}%`,
		latency: result.latencyStatus,
		allocations:
			result.allocationRegression == null ? 'not measured' : `${(result.allocationRegression * 100).toFixed(2)}%`,
	})),
);

if (values.json != null) {
	const jsonPath = resolve(values.json);
	await mkdir(dirname(jsonPath), { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

if (failures.length !== 0) {
	throw new Error(
		`${failures.length} graph performance comparison(s) regressed or were too noisy; no-regression was not proven`,
	);
}
