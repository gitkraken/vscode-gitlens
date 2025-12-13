/**
 * Async string iteration performance benchmark
 *
 * Compares performance of iterateAsyncByDelimiter() vs async generator
 * across different data sizes for streaming Git command outputs.
 * Tests realistic Git command streaming scenarios with various chunk sizes.
 */

import { Bench } from 'tinybench';
import { iterateAsyncByDelimiter } from '../string';
import {
	consumeAsyncIterator,
	displayAnalysisHeader,
	displayAnalysisSummary,
	displayBarChart,
	displayBenchmarkHeader,
	displayCompletion,
	displayResults,
	extractResults,
	formatBytes,
	generateGitTestData,
} from './benchmarkUtils';

// Create async generator version for testing the old approach
async function* iterateAsyncByDelimiterGenerator(
	data: AsyncIterable<string>,
	delimiter: string,
): AsyncGenerator<string> {
	const delimiterLen = delimiter.length;
	let i = 0;
	let j;
	let buffer = '';
	for await (const chunk of data) {
		buffer += chunk;

		i = 0;
		while (i < buffer.length) {
			j = buffer.indexOf(delimiter, i);
			if (j === -1) {
				break;
			}

			yield buffer.substring(i, j);
			i = j + delimiterLen;
		}

		if (i > 0) {
			buffer = buffer.substring(i);
		}
	}

	// Yield any remaining content
	if (buffer.length > 0) {
		yield buffer;
	}
}

// Helper to convert string data to async iterable with chunking
async function* createAsyncIterable(data: string, chunkSize: number = 1024): AsyncGenerator<string> {
	for (let i = 0; i < data.length; i += chunkSize) {
		yield data.substring(i, i + chunkSize);
		// Add tiny delay to simulate async I/O
		await new Promise(resolve => setImmediate(resolve));
	}
}

interface BenchmarkCase {
	name: string;
	data: string;
	delimiter: string;
	description: string;
	chunkSize: number;
}

async function runBenchmarkCase(benchCase: BenchmarkCase): Promise<void> {
	const { name, data, delimiter, description, chunkSize } = benchCase;
	const size = Buffer.byteLength(data, 'utf8');

	displayBenchmarkHeader(name, description, size, delimiter, { 'Chunk size': formatBytes(chunkSize) });

	const bench = new Bench({ time: 100 });

	bench
		.add('iterateAsyncByDelimiter() [iterator]', async () => {
			const asyncData = createAsyncIterable(data, chunkSize);
			const iter = iterateAsyncByDelimiter(asyncData, delimiter);
			await consumeAsyncIterator(iter);
		})
		.add('iterateAsyncByDelimiterGenerator() [generator]', async () => {
			const asyncData = createAsyncIterable(data, chunkSize);
			const iter = iterateAsyncByDelimiterGenerator(asyncData, delimiter);
			await consumeAsyncIterator(iter);
		});

	await bench.run();

	const results = extractResults(bench.tasks);
	displayResults(results);
}

async function analyze(testData: ReturnType<typeof generateGitTestData>): Promise<void> {
	displayAnalysisHeader('ANALYSIS', 'Determining optimal method for different data sizes...');

	const testCases: Array<{ name: string; data: string; delimiter: string; chunkSize: number }> = [
		{ name: 'tiny', data: testData.tiny, delimiter: '\n', chunkSize: 512 },
		{ name: 'small', data: testData.small, delimiter: '\n', chunkSize: 512 },
		{ name: 'medium', data: testData.medium, delimiter: '\n', chunkSize: 1024 },
		{ name: 'large', data: testData.large, delimiter: '\x00', chunkSize: 2048 },
	];

	// Run quick benchmarks for each test case to determine which is faster
	const winners = new Map<string, 'iterator' | 'generator'>();

	for (const test of testCases) {
		const bench = new Bench({ time: 50 });

		bench
			.add('iterator', async () => {
				const asyncData = createAsyncIterable(test.data, test.chunkSize);
				const iter = iterateAsyncByDelimiter(asyncData, test.delimiter);
				await consumeAsyncIterator(iter);
			})
			.add('generator', async () => {
				const asyncData = createAsyncIterable(test.data, test.chunkSize);
				const iter = iterateAsyncByDelimiterGenerator(asyncData, test.delimiter);
				await consumeAsyncIterator(iter);
			});

		await bench.run();

		const iterResult = bench.tasks.find(t => t.name === 'iterator')?.result;
		if (iterResult?.state !== 'completed') {
			console.log(`  ${test.name} | Winner: unknown | Iterator did not complete`);
			continue;
		}
		const genResult = bench.tasks.find(t => t.name === 'generator')?.result;
		if (genResult?.state !== 'completed') {
			console.log(`  ${test.name} | Winner: unknown | Generator did not complete`);
			continue;
		}

		// Find the fastest method
		let fastest: 'iterator' | 'generator' = 'iterator';
		const fastestMean = iterResult?.throughput.mean ?? 0;

		if ((genResult?.throughput.mean ?? 0) > fastestMean) {
			fastest = 'generator';
		}

		winners.set(test.name, fastest);
	}

	displayAnalysisSummary(testCases, winners, formatBytes);
}

async function analyzeChunkSizes(testData: ReturnType<typeof generateGitTestData>): Promise<void> {
	displayAnalysisHeader('CHUNK SIZE ANALYSIS', 'Determining optimal chunk sizes for different data sizes...');

	const chunkSizes = [256, 512, 1024, 2048, 4096];
	const data = testData.medium;
	const delimiter = '\n';

	console.log(`Test data: Medium size (${formatBytes(Buffer.byteLength(data, 'utf8'))})`);
	console.log('Chunk sizes tested:', chunkSizes.map(s => formatBytes(s)).join(', '));
	console.log();

	const results: Array<{ chunkSize: number; opsPerSec: number }> = [];

	for (const chunkSize of chunkSizes) {
		const bench = new Bench({ time: 50 });

		bench.add('iterator', async () => {
			const asyncData = createAsyncIterable(data, chunkSize);
			const iter = iterateAsyncByDelimiter(asyncData, delimiter);
			await consumeAsyncIterator(iter);
		});

		await bench.run();

		const result = bench.tasks[0].result;
		if (result?.state !== 'completed') {
			console.log(`  ${formatBytes(chunkSize)} | Winner: unknown | Did not complete`);
			continue;
		}

		results.push({
			chunkSize: chunkSize,
			opsPerSec: result?.throughput.mean ?? 0,
		});
	}

	// Display results
	const chartData = results.map(r => ({
		label: formatBytes(r.chunkSize),
		value: r.opsPerSec,
	}));

	displayBarChart(chartData, 'Chunk Size Analysis', ['Chunk Size', 'Ops/sec', 'Relative Performance']);

	const optimal = results.reduce((prev, curr) => (curr.opsPerSec > prev.opsPerSec ? curr : prev));

	console.log(`\nOptimal chunk size: ${formatBytes(optimal.chunkSize)} (${optimal.opsPerSec.toFixed(0)} ops/sec)`);
}

export async function main(): Promise<void> {
	console.log('━'.repeat(80));
	console.log('ASYNC STRING DELIMITER ITERATION BENCHMARK');
	console.log('━'.repeat(80));
	console.log('\nComparing two approaches:');
	console.log('  1. iterateAsyncByDelimiter() - Async iterator-based lazy iteration (class-based)');
	console.log('  2. iterateAsyncByDelimiterGenerator() - Async generator-based lazy iteration\n');
	console.log('Simulates streaming Git command output from child processes with various chunk sizes.\n');

	const testData = generateGitTestData();

	const benchmarks: BenchmarkCase[] = [
		{
			name: 'Tiny',
			data: testData.tiny,
			delimiter: '\n',
			description: 'Single git remote (~100 bytes)',
			chunkSize: 512,
		},
		{
			name: 'Small',
			data: testData.small,
			delimiter: '\n',
			description: 'Multiple git remotes (~600 bytes)',
			chunkSize: 512,
		},
		{
			name: 'Medium',
			data: testData.medium,
			delimiter: '\n',
			description: 'Git status with 50 files (~4KB)',
			chunkSize: 1024,
		},
		{
			name: 'Large',
			data: testData.large,
			delimiter: '\x00',
			description: 'Git log with 100 commits (~20KB)',
			chunkSize: 2048,
		},
		{
			name: 'Very Large',
			data: testData.veryLarge,
			delimiter: '\n',
			description: 'Git blame for 10,000 line file (~500KB)',
			chunkSize: 4096,
		},
		{
			name: 'Extreme',
			data: testData.extreme,
			delimiter: '\x00',
			description: 'Git log with 5000 commits and stats (~2MB)',
			chunkSize: 8192,
		},
	];

	// Run individual benchmarks
	for (const benchmark of benchmarks) {
		await runBenchmarkCase(benchmark);
	}

	// Performance analysis
	await analyze(testData);

	// Chunk size analysis
	await analyzeChunkSizes(testData);

	displayCompletion();
}

// Auto-run when executed
void main();
