/**
 * Iterable utilities performance benchmark
 *
 * Compares performance of generator-based vs iterator-based implementations for common iterable operations used throughout GitLens
 */

import { Bench } from 'tinybench';
import { chunk, filter, map, skip, take } from '../iterable';
import {
	consumeIterator,
	displayAnalysisHeader,
	displayBenchmarkHeader,
	displayCompletion,
	displayResults,
	extractResults,
	formatBytes,
} from './benchmarkUtils';

// ============================================================================
// Generator versions for comparison
// ============================================================================

function* filterGenerator<T>(source: Iterable<T>, predicate: (item: T) => boolean): Iterable<T> {
	for (const item of source) {
		if (predicate(item)) yield item;
	}
}

function* mapGenerator<T, TMapped>(source: Iterable<T>, mapper: (item: T) => TMapped): IterableIterator<TMapped> {
	for (const item of source) {
		yield mapper(item);
	}
}

function* takeGenerator<T>(source: Iterable<T>, count: number): Iterable<T> {
	if (count > 0) {
		let i = 0;
		for (const item of source) {
			yield item;
			i++;
			if (i >= count) break;
		}
	}
}

function* skipGenerator<T>(source: Iterable<T>, count: number): IterableIterator<T> {
	let i = 0;
	for (const item of source) {
		if (i >= count) yield item;
		i++;
	}
}

function* chunkGenerator<T>(source: T[], size: number): Iterable<T[]> {
	let chunk: T[] = [];

	for (const item of source) {
		if (chunk.length < size) {
			chunk.push(item);
			continue;
		}

		yield chunk;
		chunk = [];
	}

	if (chunk.length > 0) {
		yield chunk;
	}
}

// ============================================================================
// Test data generators
// ============================================================================

interface GitCommit {
	sha: string;
	author: string;
	date: Date;
	message: string;
}

function generateCommits(count: number): GitCommit[] {
	return Array.from({ length: count }, (_, i) => ({
		sha: `abc123def456${String(i).padStart(32, '0')}`,
		author: `Developer ${i % 10}`,
		date: new Date(Date.now() - i * 3600000),
		message: `Commit message ${i}`,
	}));
}

function generateFiles(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `src/path/to/file${i}.ts`);
}

// ============================================================================
// Benchmark cases
// ============================================================================

interface BenchmarkCase {
	name: string;
	description: string;
	run: (bench: Bench) => void;
}

const benchmarkCases: BenchmarkCase[] = [
	{
		name: 'filter() - Small dataset (10 items)',
		description: 'Filter commits by author on small array',
		run: bench => {
			const commits = generateCommits(10);
			const predicate = (c: GitCommit) => c.author === 'Developer 5';

			bench
				.add('Array.filter() [baseline]', () => {
					const arr = commits.filter(predicate);
					consumeIterator(arr);
				})
				.add('filterGenerator() [generator]', () => {
					const iter = filterGenerator(commits, predicate);
					consumeIterator(iter);
				})
				.add('filter() [iterator]', () => {
					const iter = filter(commits, predicate);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'filter() - Medium dataset (100 items)',
		description: 'Filter commits by author on medium array',
		run: bench => {
			const commits = generateCommits(100);
			const predicate = (c: GitCommit) => c.author === 'Developer 5';

			bench
				.add('Array.filter() [baseline]', () => {
					const arr = commits.filter(predicate);
					consumeIterator(arr);
				})
				.add('filterGenerator() [generator]', () => {
					const iter = filterGenerator(commits, predicate);
					consumeIterator(iter);
				})
				.add('filter() [iterator]', () => {
					const iter = filter(commits, predicate);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'filter() - Large dataset (1000 items)',
		description: 'Filter commits by author on large array',
		run: bench => {
			const commits = generateCommits(1000);
			const predicate = (c: GitCommit) => c.author === 'Developer 5';

			bench
				.add('Array.filter() [baseline]', () => {
					const arr = commits.filter(predicate);
					consumeIterator(arr);
				})
				.add('filterGenerator() [generator]', () => {
					const iter = filterGenerator(commits, predicate);
					consumeIterator(iter);
				})
				.add('filter() [iterator]', () => {
					const iter = filter(commits, predicate);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'map() - Small dataset (10 items)',
		description: 'Map commits to SHA strings on small array',
		run: bench => {
			const commits = generateCommits(10);
			const mapper = (c: GitCommit) => c.sha;

			bench
				.add('Array.map() [baseline]', () => {
					const arr = commits.map(mapper);
					consumeIterator(arr);
				})
				.add('mapGenerator() [generator]', () => {
					const iter = mapGenerator(commits, mapper);
					consumeIterator(iter);
				})
				.add('map() [iterator]', () => {
					const iter = map(commits, mapper);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'map() - Medium dataset (100 items)',
		description: 'Map commits to SHA strings on medium array',
		run: bench => {
			const commits = generateCommits(100);
			const mapper = (c: GitCommit) => c.sha;

			bench
				.add('Array.map() [baseline]', () => {
					const arr = commits.map(mapper);
					consumeIterator(arr);
				})
				.add('mapGenerator() [generator]', () => {
					const iter = mapGenerator(commits, mapper);
					consumeIterator(iter);
				})
				.add('map() [iterator]', () => {
					const iter = map(commits, mapper);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'map() - Large dataset (1000 items)',
		description: 'Map commits to SHA strings on large array',
		run: bench => {
			const commits = generateCommits(1000);
			const mapper = (c: GitCommit) => c.sha;

			bench
				.add('Array.map() [baseline]', () => {
					const arr = commits.map(mapper);
					consumeIterator(arr);
				})
				.add('mapGenerator() [generator]', () => {
					const iter = mapGenerator(commits, mapper);
					consumeIterator(iter);
				})
				.add('map() [iterator]', () => {
					const iter = map(commits, mapper);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'take() - Take 10 from 100',
		description: 'Take first 10 commits from array of 100',
		run: bench => {
			const commits = generateCommits(100);
			const count = 10;

			bench
				.add('Array.slice() [baseline]', () => {
					const arr = commits.slice(0, count);
					consumeIterator(arr);
				})
				.add('takeGenerator() [generator]', () => {
					const iter = takeGenerator(commits, count);
					consumeIterator(iter);
				})
				.add('take() [iterator]', () => {
					const iter = take(commits, count);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'take() - Take 10 from 1000',
		description: 'Take first 10 commits from array of 1000',
		run: bench => {
			const commits = generateCommits(1000);
			const count = 10;

			bench
				.add('Array.slice() [baseline]', () => {
					const arr = commits.slice(0, count);
					consumeIterator(arr);
				})
				.add('takeGenerator() [generator]', () => {
					const iter = takeGenerator(commits, count);
					consumeIterator(iter);
				})
				.add('take() [iterator]', () => {
					const iter = take(commits, count);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'skip() - Skip 10 from 100',
		description: 'Skip first 10 commits from array of 100',
		run: bench => {
			const commits = generateCommits(100);
			const count = 10;

			bench
				.add('Array.slice() [baseline]', () => {
					const arr = commits.slice(count);
					consumeIterator(arr);
				})
				.add('skipGenerator() [generator]', () => {
					const iter = skipGenerator(commits, count);
					consumeIterator(iter);
				})
				.add('skip() [iterator]', () => {
					const iter = skip(commits, count);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'skip() - Skip 50 from 1000',
		description: 'Skip first 50 commits from array of 1000',
		run: bench => {
			const commits = generateCommits(1000);
			const count = 50;

			bench
				.add('Array.slice() [baseline]', () => {
					const arr = commits.slice(count);
					consumeIterator(arr);
				})
				.add('skipGenerator() [generator]', () => {
					const iter = skipGenerator(commits, count);
					consumeIterator(iter);
				})
				.add('skip() [iterator]', () => {
					const iter = skip(commits, count);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'chunk() - Chunk 100 items by 10',
		description: 'Split 100 files into chunks of 10',
		run: bench => {
			const files = generateFiles(100);
			const size = 10;

			bench
				.add('Manual chunking [baseline]', () => {
					const chunks: string[][] = [];
					for (let i = 0; i < files.length; i += size) {
						chunks.push(files.slice(i, i + size));
					}
					consumeIterator(chunks);
				})
				.add('chunkGenerator() [generator]', () => {
					const iter = chunkGenerator(files, size);
					consumeIterator(iter);
				})
				.add('chunk() [iterator]', () => {
					const iter = chunk(files, size);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'chunk() - Chunk 1000 items by 50',
		description: 'Split 1000 files into chunks of 50',
		run: bench => {
			const files = generateFiles(1000);
			const size = 50;

			bench
				.add('Manual chunking [baseline]', () => {
					const chunks: string[][] = [];
					for (let i = 0; i < files.length; i += size) {
						chunks.push(files.slice(i, i + size));
					}
					consumeIterator(chunks);
				})
				.add('chunkGenerator() [generator]', () => {
					const iter = chunkGenerator(files, size);
					consumeIterator(iter);
				})
				.add('chunk() [iterator]', () => {
					const iter = chunk(files, size);
					consumeIterator(iter);
				});
		},
	},
	{
		name: 'Chained operations - filter + map + take',
		description: 'Real-world pipeline: filter commits, map to SHA, take 10',
		run: bench => {
			const commits = generateCommits(1000);

			bench
				.add('Array methods [baseline]', () => {
					const result = commits
						.filter(c => c.author === 'Developer 5')
						.map(c => c.sha)
						.slice(0, 10);
					consumeIterator(result);
				})
				.add('Generators', () => {
					const filtered = filterGenerator(commits, c => c.author === 'Developer 5');
					const mapped = mapGenerator(filtered, c => c.sha);
					const taken = takeGenerator(mapped, 10);
					consumeIterator(taken);
				})
				.add('Iterators', () => {
					const filtered = filter(commits, c => c.author === 'Developer 5');
					const mapped = map(filtered, c => c.sha);
					const taken = take(mapped, 10);
					consumeIterator(taken);
				});
		},
	},
];

// ============================================================================
// Main benchmark runner
// ============================================================================

async function runBenchmarkCase(benchCase: BenchmarkCase): Promise<void> {
	displayBenchmarkHeader(benchCase.name, benchCase.description, 0, '');

	const bench = new Bench({ time: 100 });
	benchCase.run(bench);

	await bench.run();

	const results = extractResults(bench.tasks);
	displayResults(results);
}

async function analyzeOverall(): Promise<void> {
	displayAnalysisHeader('OVERALL ANALYSIS', 'Comparing generator vs iterator performance across all operations');

	const operations = ['filter', 'map', 'take', 'skip', 'chunk'] as const;
	const wins = new Map<string, number>();
	wins.set('generator', 0);
	wins.set('iterator', 0);
	wins.set('baseline', 0);

	// Quick test each operation
	for (const op of operations) {
		let testData: any;
		let bench: Bench;

		switch (op) {
			case 'filter':
				testData = generateCommits(100);
				bench = new Bench({ time: 50 });
				bench
					.add('generator', () => {
						const iter = filterGenerator(testData, (c: GitCommit) => c.author === 'Developer 5');
						consumeIterator(iter);
					})
					.add('iterator', () => {
						const iter = filter(testData, (c: GitCommit) => c.author === 'Developer 5');
						consumeIterator(iter);
					});
				break;
			case 'map':
				testData = generateCommits(100);
				bench = new Bench({ time: 50 });
				bench
					.add('generator', () => {
						const iter = mapGenerator(testData, (c: GitCommit) => c.sha);
						consumeIterator(iter);
					})
					.add('iterator', () => {
						const iter = map(testData, (c: GitCommit) => c.sha);
						consumeIterator(iter);
					});
				break;
			case 'take':
				testData = generateCommits(100);
				bench = new Bench({ time: 50 });
				bench
					.add('generator', () => {
						const iter = takeGenerator(testData, 10);
						consumeIterator(iter);
					})
					.add('iterator', () => {
						const iter = take(testData, 10);
						consumeIterator(iter);
					});
				break;
			case 'skip':
				testData = generateCommits(100);
				bench = new Bench({ time: 50 });
				bench
					.add('generator', () => {
						const iter = skipGenerator(testData, 10);
						consumeIterator(iter);
					})
					.add('iterator', () => {
						const iter = skip(testData, 10);
						consumeIterator(iter);
					});
				break;
			case 'chunk':
				testData = generateFiles(100);
				bench = new Bench({ time: 50 });
				bench
					.add('generator', () => {
						const iter = chunkGenerator(testData, 10);
						consumeIterator(iter);
					})
					.add('iterator', () => {
						const iter = chunk(testData, 10);
						consumeIterator(iter);
					});
				break;
		}

		await bench.run();

		const genResult = bench.tasks.find(t => t.name === 'generator')?.result;
		if (genResult?.state !== 'completed') {
			console.log(`  ${op.padEnd(10)} | Winner: unknown | Generator did not complete`);
			continue;
		}
		const iterResult = bench.tasks.find(t => t.name === 'iterator')?.result;
		if (iterResult?.state !== 'completed') {
			console.log(`  ${op.padEnd(10)} | Winner: unknown | Iterator did not complete`);
			continue;
		}

		const winner =
			(iterResult?.throughput.mean ?? 0) > (genResult?.throughput.mean ?? 0) ? 'iterator' : 'generator';
		wins.set(winner, (wins.get(winner) ?? 0) + 1);

		console.log(
			`${op.padEnd(10)} | Winner: ${winner.padEnd(10)} | Iterator ${((iterResult?.throughput.mean ?? 0) / (genResult?.throughput.mean ?? 1)).toFixed(2)}x`,
		);
	}

	console.log(`\n${'-'.repeat(80)}`);
	console.log('\nSummary:');
	console.log(`  Iterator won ${wins.get('iterator')}/${operations.length} operations`);
	console.log(`  Generator won ${wins.get('generator')}/${operations.length} operations`);

	const iteratorWins = wins.get('iterator') ?? 0;
	if (iteratorWins > operations.length / 2) {
		console.log('\n✅ Iterator implementation shows performance benefits');
	} else {
		console.log(
			'\n\u26A0\ufe0f Generator implementation is competitive - optimization may not be worth the complexity',
		);
	}
}

export async function main(): Promise<void> {
	console.log('━'.repeat(80));
	console.log('ITERABLE UTILITIES BENCHMARK');
	console.log('━'.repeat(80));
	console.log('\nComparing three approaches:');
	console.log('  1. Array methods (baseline) - Built-in eager evaluation');
	console.log('  2. Generators - Generator-based lazy iteration');
	console.log('  3. Iterators - Class-based iterator lazy iteration\n');

	// Run individual benchmarks
	for (const benchmark of benchmarkCases) {
		await runBenchmarkCase(benchmark);
	}

	// Overall analysis
	await analyzeOverall();

	displayCompletion();
}

// Auto-run when executed
void main();
