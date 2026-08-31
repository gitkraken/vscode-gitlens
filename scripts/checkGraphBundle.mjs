#!/usr/bin/env node

/**
 * Checks the production webpack graph entrypoint against its explicit byte budget while reporting
 * the delta from the pinned pre-extraction baseline.
 * The stats file must come from `analyze:bundle:webviews`; the secondary esbuild graph metafile is
 * intentionally not accepted because webpack produces the asset GitLens actually ships.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		baseline: { type: 'string', default: 'scripts/performance/graph-bundle-baseline.json' },
		json: { type: 'string' },
		stats: { type: 'string', default: 'out/webviews-stats.json' },
	},
});

async function readJson(path) {
	return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const [baseline, stats] = await Promise.all([readJson(values.baseline), readJson(values.stats)]);
if (baseline.schemaVersion !== 2) {
	throw new Error(`Unsupported graph bundle baseline schema ${String(baseline.schemaVersion)}`);
}
if ((stats.errorsCount ?? stats.errors?.length ?? 0) !== 0) {
	throw new Error('Webpack stats contain build errors; bundle size is not valid');
}

const entrypoint = stats.entrypoints?.[baseline.entrypoint];
if (entrypoint == null) {
	throw new Error(`Webpack stats do not contain the ${baseline.entrypoint} entrypoint`);
}

const assetSizes = new Map(entrypoint.assets.map(asset => [asset.name, asset.size]));
const actualBytes = { entrypoint: entrypoint.assetsSize };
for (const assetName of Object.keys(baseline.maximumBytes)) {
	if (assetName === 'entrypoint') continue;
	const size = assetSizes.get(assetName);
	if (size == null) throw new Error(`Graph entrypoint is missing required asset ${assetName}`);
	actualBytes[assetName] = size;
}

const enforcedMetrics = new Set(baseline.enforcedMetrics);
// graph.js is reported for module-graph visibility but isn't independently enforced: it and
// shared.js are both loaded by the graph, so the entrypoint total is the user-facing cost. shared.js
// retains its own ceiling because growth there would tax every webview, not only the graph.
const comparisons = Object.entries(baseline.maximumBytes).map(([metric, maximum]) => {
	const actual = actualBytes[metric];
	const pinned = baseline.baselineBytes?.[metric] ?? maximum;
	return {
		metric: metric,
		actualBytes: actual,
		baselineBytes: pinned,
		maximumBytes: maximum,
		baselineDeltaBytes: actual - pinned,
		deltaBytes: actual - maximum,
		enforced: enforcedMetrics.has(metric),
	};
});
const regressions = comparisons.filter(result => result.enforced && result.deltaBytes > 0);
const report = {
	schemaVersion: 2,
	check: 'graph-bundle',
	createdAt: new Date().toISOString(),
	producer: baseline.producer,
	baselineSourceCommit: baseline.sourceCommit,
	budgetRationale: baseline.budgetRationale,
	stats: resolve(values.stats),
	comparisons: comparisons,
	passed: regressions.length === 0,
};

console.table(
	comparisons.map(result => ({
		metric: result.metric,
		'actual (bytes)': result.actualBytes,
		'baseline (bytes)': result.baselineBytes,
		'maximum (bytes)': result.maximumBytes,
		'vs baseline': result.baselineDeltaBytes,
		headroom: -result.deltaBytes,
		enforced: result.enforced,
	})),
);

if (values.json != null) {
	const jsonPath = resolve(values.json);
	await mkdir(dirname(jsonPath), { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
	console.log(`Wrote graph bundle report to ${jsonPath}`);
}

if (regressions.length !== 0) {
	throw new Error(
		`Graph bundle exceeds its byte budget: ${regressions
			.map(result => `${result.metric} +${result.deltaBytes} bytes`)
			.join(', ')}`,
	);
}
