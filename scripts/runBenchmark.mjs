#!/usr/bin/env node

/**
 * Benchmark runner for GitLens
 *
 * Usage:
 *   pnpm run benchmark              # Run all benchmarks
 *   pnpm run benchmark string       # Run specific benchmark by name
 *   pnpm run benchmark --list       # List all available benchmarks
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, basename } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Parse command line arguments
const args = process.argv.slice(2);
const shouldList = args.includes('--list') || args.includes('-l');
const specificBenchmark = args.find(arg => !arg.startsWith('--'));

/**
 * Find all benchmark files in the codebase
 */
function findBenchmarkFiles() {
	const benchmarks = [];
	const testDirs = [];

	// Find all __tests__ directories
	function findTestDirs(dir) {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;

			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === '__tests__') {
					testDirs.push(fullPath);
				}
				findTestDirs(fullPath);
			}
		}
	}

	findTestDirs(join(rootDir, 'src'));

	// Find benchmark files in test directories
	for (const testDir of testDirs) {
		const entries = readdirSync(testDir);
		for (const entry of entries) {
			if (entry.endsWith('.benchmark.ts')) {
				const fullPath = join(testDir, entry);
				const relativePath = fullPath.replace(rootDir, '').replace(/\\/g, '/').substring(1);
				const name = basename(entry, '.benchmark.ts');

				benchmarks.push({
					name,
					sourcePath: relativePath,
					outputPath: relativePath.replace('src/', 'out/tests/').replace('.ts', '.js'),
				});
			}
		}
	}

	return benchmarks;
}

/**
 * List all available benchmarks
 */
function listBenchmarks(benchmarks) {
	console.log('Available benchmarks:\n');
	for (const benchmark of benchmarks) {
		console.log(`  ${benchmark.name.padEnd(20)} - ${benchmark.sourcePath}`);
	}
	console.log(`\nTotal: ${benchmarks.length} benchmark(s)`);
	console.log('\nUsage:');
	console.log('  pnpm run benchmark              # Run all benchmarks');
	console.log('  pnpm run benchmark <name>       # Run specific benchmark');
	console.log('  pnpm run benchmark --list       # Show this list');
}

/**
 * Build benchmarks
 */
function buildBenchmarks() {
	console.log('Building benchmarks...\n');
	try {
		execSync(`node ${join(rootDir, 'scripts', 'esbuild.tests.mjs')}`, {
			stdio: 'inherit',
			cwd: rootDir,
		});
	} catch (error) {
		console.error('Error building benchmarks:', error.message);
		process.exit(1);
	}
}

/**
 * Run a specific benchmark
 */
function runBenchmark(benchmark) {
	const benchmarkPath = join(rootDir, benchmark.outputPath);

	if (!existsSync(benchmarkPath)) {
		console.error(`Error: Benchmark file not found at ${benchmarkPath}`);
		console.error('Make sure the build completed successfully.');
		process.exit(1);
	}

	console.log(`\nRunning benchmark: ${benchmark.name}`);
	console.log(`Source: ${benchmark.sourcePath}\n`);

	try {
		execSync(`node "${benchmarkPath}"`, { stdio: 'inherit', cwd: rootDir });
	} catch (error) {
		console.error(`Error running benchmark ${benchmark.name}:`, error.message);
		process.exit(1);
	}
}

/**
 * Main execution
 */
function main() {
	const benchmarks = findBenchmarkFiles();

	if (benchmarks.length === 0) {
		console.log('No benchmarks found.');
		console.log('Create benchmark files named *.benchmark.ts in __tests__ directories.');
		process.exit(0);
	}

	// Handle --list flag
	if (shouldList) {
		listBenchmarks(benchmarks);
		process.exit(0);
	}

	// Build benchmarks
	buildBenchmarks();

	// Run specific benchmark if specified
	if (specificBenchmark) {
		const benchmark = benchmarks.find(b => b.name === specificBenchmark);
		if (!benchmark) {
			console.error(`Error: Benchmark "${specificBenchmark}" not found.`);
			console.error('\nAvailable benchmarks:');
			for (const b of benchmarks) {
				console.error(`  - ${b.name}`);
			}
			process.exit(1);
		}

		runBenchmark(benchmark);
	} else {
		// Run all benchmarks
		console.log(`\nRunning ${benchmarks.length} benchmark(s)...\n`);

		for (let i = 0; i < benchmarks.length; i++) {
			if (i > 0) {
				console.log('\n' + '━'.repeat(80) + '\n');
			}
			runBenchmark(benchmarks[i]);
		}
	}

	console.log('\n✓ All benchmarks completed successfully!\n');
}

main();
