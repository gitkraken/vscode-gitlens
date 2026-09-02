#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		input: { type: 'string', default: 'out/perf' },
		json: { type: 'string', default: 'out/perf/commit-graph-browser-summary.json' },
	},
});

const inputDir = resolve(values.input);
const files = (await readdir(inputDir))
	.filter(name => /^commit-graph-browser-\d+\.json$/.test(name))
	.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (files.length < 3) throw new Error(`At least three browser reports are required; found ${files.length}`);

const reports = await Promise.all(files.map(async name => JSON.parse(await readFile(resolve(inputDir, name), 'utf8'))));
for (const report of reports) {
	if (report.schemaVersion !== 1 || report.benchmark !== 'commit-graph-browser') {
		throw new Error('Input contains an incompatible graph browser report');
	}
	for (const field of ['platform', 'arch', 'cpu', 'vscode']) {
		if (report.runtime[field] !== reports[0].runtime[field]) {
			throw new Error(`Browser reports were captured on different ${field} values`);
		}
	}
	if (report.fixture.rows !== reports[0].fixture.rows) {
		throw new Error('Browser reports used different fixture sizes');
	}
}

function percentile(values, fraction) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function stats(values) {
	const mean = values.reduce((total, value) => total + value, 0) / values.length;
	const variance =
		values.length < 2 ? 0 : values.reduce((total, value) => total + (value - mean) ** 2, 0) / (values.length - 1);
	const margin = 1.96 * Math.sqrt(variance / values.length);
	return {
		mean: mean,
		p50: percentile(values, 0.5),
		p75: percentile(values, 0.75),
		p99: percentile(values, 0.99),
		min: Math.min(...values),
		max: Math.max(...values),
		rme: mean === 0 ? 0 : (margin / Math.abs(mean)) * 100,
	};
}

const measureNames = [...new Set(reports.flatMap(report => Object.keys(report.measures)))].sort();

// Absent (rather than 0) on a non-DEBUG bundle, which doesn't collect per-row payload sizes at all —
// `Math.max()` on an empty array is `-Infinity`, which would otherwise poison the whole stat.
const rowsPayloadSamples = reports
	.filter(report => report.rowsPayloadBytes.length > 0)
	.map(report => Math.max(...report.rowsPayloadBytes));

const summary = {
	schemaVersion: 1,
	benchmark: 'commit-graph-browser-summary',
	createdAt: new Date().toISOString(),
	runtime: reports[0].runtime,
	fixture: reports[0].fixture,
	samples: reports.length,
	openToVisibleMs: stats(reports.map(report => report.openToVisibleMs)),
	rowsPayloadBytes: rowsPayloadSamples.length > 0 ? stats(rowsPayloadSamples) : null,
	measures: Object.fromEntries(
		measureNames.map(name => [name, stats(reports.map(report => report.measures[name]?.maxMs ?? 0))]),
	),
	scroll: {
		p99FrameGapMs: stats(reports.map(report => report.scroll.p99FrameGapMs)),
		maxFrameGapMs: stats(reports.map(report => report.scroll.maxFrameGapMs)),
		estimatedDroppedFrames: stats(reports.map(report => report.scroll.estimatedDroppedFrames)),
		longTaskCount: stats(reports.map(report => report.scroll.longTasks.length)),
		maxLongTaskMs: stats(reports.map(report => Math.max(0, ...report.scroll.longTasks))),
	},
	memory: {
		totalHeapAfterBytes: stats(reports.map(report => report.memory.totalHeapAfterBytes ?? 0)),
	},
};

const outputPath = resolve(values.json);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(`Aggregated ${reports.length} graph browser reports into ${outputPath}`);
console.table({
	open: summary.openToVisibleMs,
	payload: summary.rowsPayloadBytes,
	engine: summary.measures.engine,
	firstVisible: summary.measures['first-rows-to-visible'],
	frameP99: summary.scroll.p99FrameGapMs,
	heap: summary.memory.totalHeapAfterBytes,
});
