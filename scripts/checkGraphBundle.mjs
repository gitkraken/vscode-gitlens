#!/usr/bin/env node

/**
 * Checks the production webpack graph entrypoint against its explicit byte budget while reporting
 * the delta from the pinned pre-extraction baseline, and asserts no workspace package reached the
 * bundle through its built `dist/` instead of its aliased `src/`.
 * The stats file must come from `analyze:bundle:webviews`; the secondary esbuild graph metafile is
 * intentionally not accepted because webpack produces the asset GitLens actually ships.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		baseline: { type: 'string', default: 'scripts/performance/graph-bundle-baseline.json' },
		json: { type: 'string' },
		stats: { type: 'string', default: 'out/webviews-stats.json' },
		update: { type: 'boolean', default: false },
	},
});

async function readJson(path) {
	return JSON.parse(await readFile(resolve(path), 'utf8'));
}

// Every one of these is aliased to its `src/` for all GitLens build targets (webpack's
// `getLibraryAliases()`, `scripts/esbuild.tests.mjs`, and the tsconfig `paths`), so the extension
// compiles them from source and never resolves them through node_modules to their built output.
// That matters most for `@gitkraken/commit-graph-ui`, whose published `dist/` carries its own copies
// of `@gitlens/utils` and `@gitlens/components`: if the alias ever loses, the webview ships those
// twice — once from source, once from the copies — and nothing else would notice.
const aliasedWorkspaceDists = [
	['/packages/plus/commit-graph-ui/dist/', '@gitkraken/commit-graph-ui'],
	['/packages/plus/commit-graph/dist/', '@gitkraken/commit-graph'],
	['/packages/components/dist/', '@gitlens/components'],
	['/packages/utils/dist/', '@gitlens/utils'],
];

/** @param {any} stats */
function assertNoWorkspaceDistModules(stats) {
	/** @type {Map<string, string>} */
	const offenders = new Map();

	/** @param {any[] | undefined} modules */
	function walk(modules) {
		for (const module of modules ?? []) {
			// Separators are the build machine's, and an identifier can carry loader prefixes.
			const identifier = String(module.identifier ?? '').replaceAll('\\', '/');
			for (const [path, alias] of aliasedWorkspaceDists) {
				if (identifier.includes(path) && !offenders.has(alias)) {
					offenders.set(alias, identifier);
				}
			}

			// Concatenated modules hold their inputs here, so a scope-hoisted offender only shows up nested.
			walk(module.modules);
		}
	}

	walk(stats.modules);
	for (const child of stats.children ?? []) {
		walk(child.modules);
	}

	if (offenders.size === 0) return;

	const detail = [...offenders].map(([alias, identifier]) => `${alias} (via ${identifier})`).join('; ');
	throw new Error(
		`Webview bundle pulled a workspace package from its built dist/ instead of its aliased src/: ${detail}. ` +
			`Restore the alias for that package in webpack.config.mjs \`getLibraryAliases()\`, in ` +
			`scripts/esbuild.tests.mjs, and in the tsconfig \`paths\` — dist/ copies duplicate code the ` +
			`extension already compiles from source.`,
	);
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

assertNoWorkspaceDistModules(stats);

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

if (values.update) {
	const baselinePath = resolve(values.baseline);
	// Preserve each metric's current headroom (maximum - baseline) rather than copying the old
	// `maximumBytes` verbatim, so a one-off allowance (e.g. graph.css's element-rename budget)
	// survives the update instead of collapsing to zero-growth against the new baseline.
	const updatedBaselineBytes = {};
	const updatedMaximumBytes = {};
	for (const [metric, maximum] of Object.entries(baseline.maximumBytes)) {
		const pinned = baseline.baselineBytes?.[metric] ?? maximum;
		const headroom = maximum - pinned;
		updatedBaselineBytes[metric] = actualBytes[metric];
		updatedMaximumBytes[metric] = actualBytes[metric] + headroom;
	}

	const updatedBaseline = {
		...baseline,
		sourceCommit: execFileSync('git', ['rev-parse', 'main'], { encoding: 'utf8' }).trim(),
		baselineBytes: updatedBaselineBytes,
		maximumBytes: updatedMaximumBytes,
	};
	await writeFile(baselinePath, `${JSON.stringify(updatedBaseline, null, 2)}\n`, 'utf8');
	console.log(`Updated graph bundle baseline at ${baselinePath}`);
} else if (regressions.length !== 0) {
	const regressed = regressions.map(result => `${result.metric} +${result.deltaBytes} bytes`).join(', ');
	throw new Error(
		`Graph bundle exceeds its byte budget in ${values.baseline}: ${regressed}. Re-baseline with ` +
			`\`node ./scripts/checkGraphBundle.mjs --update\` if this growth is expected.`,
	);
}
