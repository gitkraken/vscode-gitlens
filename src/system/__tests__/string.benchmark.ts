/**
 * String iteration performance benchmark
 *
 * Compares performance of iterateByDelimiter() vs split() across different data sizes
 * to determine optimal thresholds for the maybeIterateByDelimiter() function.
 */

import { Bench } from 'tinybench';
import { iterateByDelimiter } from '../string';
import {
	consumeArray,
	consumeIterator,
	displayAnalysisHeader,
	displayAnalysisSummary,
	displayBenchmarkHeader,
	displayCompletion,
	displayResults,
	extractResults,
	formatBytes,
	generateGitTestData,
} from './benchmarkUtils';

// Create generator version for testing the old approach
function* iterateByDelimiterGenerator(data: string | Iterable<string>, delimiter: string): IterableIterator<string> {
	const delimiterLen = delimiter.length;
	let i = 0;
	let j;

	if (typeof data === 'string') {
		while (i < data.length) {
			j = data.indexOf(delimiter, i);
			if (j === -1) {
				j = data.length;
			}

			yield data.substring(i, j);
			i = j + delimiterLen;
		}

		return;
	}

	if (Array.isArray(data)) {
		let count = 0;
		let leftover: string | undefined;
		for (let s of data as string[]) {
			count++;
			if (leftover) {
				s = leftover + s;
				leftover = undefined;
			}

			i = 0;
			while (i < s.length) {
				j = s.indexOf(delimiter, i);
				if (j === -1) {
					if (count === data.length) {
						j = s.length;
					} else {
						leftover = s.substring(i);
						break;
					}
				}

				yield s.substring(i, j);
				i = j + delimiterLen;
			}
		}

		return;
	}

	let buffer = '';
	for (const chunk of data) {
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

interface BenchmarkCase {
	name: string;
	data: string;
	delimiter: string;
	description: string;
}

async function runBenchmarkCase(benchCase: BenchmarkCase): Promise<void> {
	const { name, data, delimiter, description } = benchCase;
	const size = Buffer.byteLength(data, 'utf8');

	displayBenchmarkHeader(name, description, size, delimiter);

	const bench = new Bench({ time: 100 });

	bench
		.add('split()', () => {
			const arr = data.split(delimiter);
			consumeArray(arr);
		})
		.add('iterateByDelimiter() [iterator]', () => {
			const iter = iterateByDelimiter(data, delimiter);
			consumeIterator(iter);
		})
		.add('iterateByDelimiterGenerator() [generator]', () => {
			const iter = iterateByDelimiterGenerator(data, delimiter);
			consumeIterator(iter);
		});

	await bench.run();

	const results = extractResults(bench.tasks);
	displayResults(results);
}

async function analyze(testData: ReturnType<typeof generateGitTestData>): Promise<void> {
	displayAnalysisHeader('ANALYSIS', 'Determining optimal method for different data sizes...');

	const testCases: Array<{ name: string; data: string; delimiter: string }> = [
		{ name: 'tiny', data: testData.tiny, delimiter: '\n' },
		{ name: 'small', data: testData.small, delimiter: '\n' },
		{ name: 'medium', data: testData.medium, delimiter: '\n' },
		{ name: 'large', data: testData.large, delimiter: '\x00' },
	];

	// Run quick benchmarks for each test case to determine which is faster
	const winners = new Map<string, 'split' | 'iterator' | 'generator'>();

	for (const test of testCases) {
		const bench = new Bench({ time: 50 });

		bench
			.add('split', () => {
				const arr = test.data.split(test.delimiter);
				consumeArray(arr);
			})
			.add('iterator', () => {
				const iter = iterateByDelimiter(test.data, test.delimiter);
				consumeIterator(iter);
			})
			.add('generator', () => {
				const iter = iterateByDelimiterGenerator(test.data, test.delimiter);
				consumeIterator(iter);
			});

		await bench.run();

		const splitResult = bench.tasks.find(t => t.name === 'split')?.result;
		if (splitResult?.state !== 'completed') {
			console.log(`  ${test.name} | Winner: unknown | split() did not complete`);
			continue;
		}
		const iterResult = bench.tasks.find(t => t.name === 'iterator')?.result;
		if (iterResult?.state !== 'completed') {
			console.log(`  ${test.name} | Winner: unknown | iterateByDelimiter() did not complete`);
			continue;
		}
		const genResult = bench.tasks.find(t => t.name === 'generator')?.result;
		if (genResult?.state !== 'completed') {
			console.log(`  ${test.name} | Winner: unknown | iterateByDelimiterGenerator() did not complete`);
			continue;
		}

		// Find the fastest method
		let fastest: 'split' | 'iterator' | 'generator' = 'split';
		let fastestMean = splitResult?.throughput.mean ?? 0;

		if ((genResult?.throughput.mean ?? 0) > fastestMean) {
			fastest = 'generator';
			fastestMean = genResult?.throughput.mean ?? 0;
		}
		if ((iterResult?.throughput.mean ?? 0) > fastestMean) {
			fastest = 'iterator';
		}

		winners.set(test.name, fastest);
	}

	displayAnalysisSummary(testCases, winners, formatBytes);
}

export async function main(): Promise<void> {
	console.log('━'.repeat(80));
	console.log('STRING DELIMITER ITERATION BENCHMARK');
	console.log('━'.repeat(80));
	console.log('\nComparing three approaches:');
	console.log('  1. split() - Built-in array allocation');
	console.log('  2. iterateByDelimiter() - Iterator-based lazy iteration (class-based)');
	console.log('  3. iterateByDelimiterGenerator() - Generator-based lazy iteration\n');

	const testData = generateGitTestData();

	const benchmarks: BenchmarkCase[] = [
		{
			name: 'Tiny',
			data: testData.tiny,
			delimiter: '\n',
			description: 'Single git remote (~100 bytes)',
		},
		{
			name: 'Small',
			data: testData.small,
			delimiter: '\n',
			description: 'Multiple git remotes (~600 bytes)',
		},
		{
			name: 'Medium',
			data: testData.medium,
			delimiter: '\n',
			description: 'Git status with 50 files (~4KB)',
		},
		{
			name: 'Large',
			data: testData.large,
			delimiter: '\x00',
			description: 'Git log with 100 commits (~20KB)',
		},
		{
			name: 'Very Large',
			data: testData.veryLarge,
			delimiter: '\n',
			description: 'Git blame for 10,000 line file (~500KB)',
		},
		{
			name: 'Extreme',
			data: testData.extreme,
			delimiter: '\x00',
			description: 'Git log with 5000 commits and stats (~2MB)',
		},
	];

	// Run individual benchmarks
	for (const benchmark of benchmarks) {
		await runBenchmarkCase(benchmark);
	}

	// Threshold analysis
	await analyze(testData);

	displayCompletion();
}

// Auto-run when executed
void main();
