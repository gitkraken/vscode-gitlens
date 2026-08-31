#!/usr/bin/env node

/**
 * Benchmark runner for GitLens and its workspace packages.
 *
 * Usage:
 *   pnpm run benchmark                         # Run all benchmarks
 *   pnpm run benchmark commit-graph-engine    # Run one benchmark by name
 *   pnpm run benchmark --list                  # List all available benchmarks
 *   pnpm run benchmark commit-graph-engine -- --quick --json out/perf/graph.json
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = join(rootDir, 'out', 'benchmarks');
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'out']);

const args = process.argv.slice(2);
const separator = args.indexOf('--');
const runnerArgs = separator === -1 ? args : args.slice(0, separator);
const benchmarkArgs = separator === -1 ? [] : args.slice(separator + 1);
const shouldList = runnerArgs.includes('--list') || runnerArgs.includes('-l');
const specificBenchmark = runnerArgs.find(arg => !arg.startsWith('-'));

/** Find every `*.benchmark.ts` below a `__tests__` directory. */
function findBenchmarkFiles() {
	const benchmarks = [];

	function visit(dir, insideTests = false) {
		if (!existsSync(dir)) return;

		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isSymbolicLink() || ignoredDirectories.has(entry.name)) continue;

			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				visit(fullPath, insideTests || entry.name === '__tests__');
			} else if (insideTests && entry.name.endsWith('.benchmark.ts')) {
				const sourcePath = relative(rootDir, fullPath).replaceAll('\\', '/');
				benchmarks.push({
					name: basename(entry.name, '.benchmark.ts'),
					sourcePath: sourcePath,
					outputPath: join(outputDir, sourcePath.replace(/\.ts$/, '.mjs')),
				});
			}
		}
	}

	visit(join(rootDir, 'src'));
	visit(join(rootDir, 'packages'));
	return benchmarks.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
}

function listBenchmarks(benchmarks) {
	console.log('Available benchmarks:\n');
	for (const benchmark of benchmarks) {
		console.log(`  ${benchmark.name.padEnd(24)} - ${benchmark.sourcePath}`);
	}
	console.log(`\nTotal: ${benchmarks.length} benchmark(s)`);
	console.log('\nUse `--` before arguments intended for a benchmark.');
}

async function buildBenchmarks(benchmarks) {
	console.log('Building benchmarks...\n');
	await rm(outputDir, { recursive: true, force: true });
	await esbuild.build({
		bundle: true,
		define: { DEBUG: 'false' },
		entryNames: '[dir]/[name]',
		entryPoints: benchmarks.map(benchmark => join(rootDir, benchmark.sourcePath)),
		format: 'esm',
		logLevel: 'warning',
		minify: false,
		outbase: rootDir,
		outdir: outputDir,
		outExtension: { '.js': '.mjs' },
		platform: 'node',
		sourcemap: true,
		target: 'node20.14.0',
	});
}

function runBenchmark(benchmark) {
	if (!existsSync(benchmark.outputPath)) {
		throw new Error(`Benchmark bundle was not written to ${benchmark.outputPath}`);
	}

	console.log(`\nRunning benchmark: ${benchmark.name}`);
	console.log(`Source: ${benchmark.sourcePath}\n`);
	const result = spawnSync(process.execPath, ['--expose-gc', benchmark.outputPath, ...benchmarkArgs], {
		cwd: rootDir,
		stdio: 'inherit',
	});
	if (result.error != null) throw result.error;
	if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
	const benchmarks = findBenchmarkFiles();
	if (benchmarks.length === 0) {
		console.log('No benchmarks found.');
		console.log('Create benchmark files named *.benchmark.ts in __tests__ directories.');
		return;
	}

	if (shouldList) {
		listBenchmarks(benchmarks);
		return;
	}

	const selected =
		specificBenchmark == null ? benchmarks : benchmarks.filter(benchmark => benchmark.name === specificBenchmark);
	if (selected.length === 0) {
		console.error(`Error: Benchmark "${specificBenchmark}" not found.\n`);
		listBenchmarks(benchmarks);
		process.exit(1);
	}
	if (selected.length > 1) {
		throw new Error(`Benchmark name "${specificBenchmark}" is ambiguous; benchmark basenames must be unique.`);
	}

	await buildBenchmarks(selected);
	for (let i = 0; i < selected.length; i++) {
		if (i > 0) console.log(`\n${'━'.repeat(80)}\n`);
		runBenchmark(selected[i]);
	}

	console.log('\n✓ All benchmarks completed successfully!\n');
}

await main();
