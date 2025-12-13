/**
 * Common utilities for benchmark tests
 *
 * Provides shared functionality for consistent benchmark reporting and analysis
 */

import type { Bench, Task } from 'tinybench';

/**
 * Format byte sizes in human-readable format
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes}B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Format delimiter for display
 */
export function formatDelimiter(delimiter: string): string {
	if (delimiter === '\n') return '\\n';
	if (delimiter === '\x00') return '\\0';
	if (delimiter === '\t') return '\\t';
	return JSON.stringify(delimiter);
}

/**
 * Benchmark result data
 */
export interface BenchmarkResult {
	name: string;
	opsPerSec: number;
	avgTime: number;
	margin: number;
}

/**
 * Extract results from tinybench tasks
 */
export function extractResults(tasks: Task[]): BenchmarkResult[] {
	return tasks.map(task => {
		if (task.result.state === 'completed') {
			return {
				name: task.name,
				opsPerSec: task.result?.throughput.mean ?? 0,
				avgTime: task.result?.latency.mean ? task.result.latency.mean * 1000 : 0, // Convert to ms
				margin: task.result?.latency.rme ?? 0,
			};
		}
		return { name: task.name, opsPerSec: -1, avgTime: -1, margin: -1 };
	});
}

/**
 * Display benchmark results in a consistent format
 */
export function displayResults(results: BenchmarkResult[]): void {
	console.log('\nResults:');

	// Find fastest
	const fastest = results.reduce((prev, curr) => (curr.opsPerSec > prev.opsPerSec ? curr : prev));

	for (const result of results) {
		const isFastest = result === fastest;
		const speedup = fastest.opsPerSec / result.opsPerSec;
		const percentSlower = ((speedup - 1) * 100).toFixed(1);

		console.log(`  ${result.name}:`);
		console.log(`    ${result.opsPerSec.toLocaleString('en-US', { maximumFractionDigits: 0 })} ops/sec`);
		console.log(`    ${result.avgTime.toFixed(4)}ms avg (±${result.margin.toFixed(2)}%)`);

		if (isFastest) {
			console.log(`    ⚡ FASTEST`);
		} else {
			console.log(`    ${percentSlower}% slower (${speedup.toFixed(2)}x)`);
		}
	}

	console.log(`\n  Winner: ${fastest.name}`);
}

/**
 * Display benchmark header
 */
export function displayBenchmarkHeader(
	name: string,
	description: string,
	size: number,
	delimiter: string,
	extraInfo?: Record<string, string>,
): void {
	console.log(`\n${'='.repeat(80)}`);
	console.log(`Benchmark: ${name}`);
	console.log(`Description: ${description}`);
	console.log(`Data size: ${formatBytes(size)} (${size.toLocaleString()} bytes)`);

	if (extraInfo) {
		for (const [key, value] of Object.entries(extraInfo)) {
			console.log(`${key}: ${value}`);
		}
	}

	console.log(`Delimiter: ${formatDelimiter(delimiter)}`);
	console.log('='.repeat(80));
}

/**
 * Display analysis section header
 */
export function displayAnalysisHeader(title: string, description?: string): void {
	console.log(`\n\n${'━'.repeat(80)}`);
	console.log(title.toUpperCase());
	console.log('━'.repeat(80));

	if (description) {
		console.log(`\n${description}\n`);
	}
}

/**
 * Display analysis summary table
 */
export function displayAnalysisSummary<T extends string>(
	testCases: Array<{ name: string; data: string }>,
	winners: Map<string, T>,
	formatBytes: (bytes: number) => string,
): void {
	console.log('Size      | Winner        | Performance Summary');
	console.log('-'.repeat(80));

	for (const test of testCases) {
		const size = Buffer.byteLength(test.data, 'utf8');
		const winner = winners.get(test.name) ?? 'unknown';

		console.log(`${formatBytes(size).padEnd(9)} | ${winner.padEnd(13)} | Fastest method for ${test.name} data`);
	}

	console.log('\nSummary:');
	const winnerCounts = new Map<string, number>();
	for (const winner of winners.values()) {
		winnerCounts.set(winner, (winnerCounts.get(winner) ?? 0) + 1);
	}

	console.log('  Method performance across test cases:');
	for (const [method, count] of winnerCounts.entries()) {
		console.log(`    ${method}: won ${count}/${testCases.length} cases`);
	}
}

/**
 * Display bar chart for performance comparison
 */
export function displayBarChart(
	results: Array<{ label: string; value: number }>,
	title: string,
	columns: string[],
): void {
	console.log(columns.join(' | '));
	console.log('-'.repeat(60));

	const maxValue = Math.max(...results.map(r => r.value));

	for (const result of results) {
		const percent = ((result.value / maxValue) * 100).toFixed(1);
		const bar = '█'.repeat(Math.floor((result.value / maxValue) * 30));

		console.log(
			`${result.label.padEnd(10)} | ${result.value.toFixed(0).padStart(9)} | ${percent.padStart(5)}% ${bar}`,
		);
	}
}

/**
 * Consumer function for synchronous iterables
 */
export function consumeIterator<T>(iterable: Iterable<T>): number {
	let count = 0;
	for (const _item of iterable) {
		count++;
	}
	return count;
}

/**
 * Consumer function for arrays
 */
export function consumeArray<T>(array: T[]): number {
	let count = 0;
	for (const _item of array) {
		count++;
	}
	return count;
}

/**
 * Consumer function for async iterables
 */
export async function consumeAsyncIterator<T>(iterable: AsyncIterable<T>): Promise<number> {
	let count = 0;
	for await (const _item of iterable) {
		count++;
	}
	return count;
}

/**
 * Generate realistic Git test data
 */
export function generateGitTestData(): {
	// Tiny: ~100 bytes - single git remote
	tiny: string;
	// Small: ~600 bytes - typical git remote -v output (5 remotes)
	small: string;
	// Medium: ~4KB - git status with 50 files
	medium: string;
	// Large: ~20KB - git log output with 100 commits
	large: string;
	// Very Large: ~500KB - git blame for a large file (10,000 lines)
	veryLarge: string;
	// Extreme: ~2MB - large git log with stats (5000 commits)
	extreme: string;
} {
	return {
		// Tiny: ~100 bytes - single git remote
		tiny:
			'origin\thttps://github.com/gitkraken/vscode-gitlens.git (fetch)\n' +
			'origin\thttps://github.com/gitkraken/vscode-gitlens.git (push)\n',

		// Small: ~600 bytes - typical git remote -v output (5 remotes)
		small: Array(5)
			.fill(null)
			.map(
				(_, i) =>
					`remote${i}\thttps://github.com/gitkraken/vscode-gitlens${i}.git (fetch)\n` +
					`remote${i}\thttps://github.com/gitkraken/vscode-gitlens${i}.git (push)`,
			)
			.join('\n'),

		// Medium: ~4KB - git status with 50 files
		medium: Array(50)
			.fill(null)
			.map(
				(_, i) =>
					`M  src/path/to/file${i}.ts\n` +
					`A  src/path/to/another/file${i}.ts\n` +
					`D  src/deleted/file${i}.ts`,
			)
			.join('\n'),

		// Large: ~20KB - git log output with 100 commits
		large: Array(100)
			.fill(null)
			.map(
				(_, i) =>
					`commit abc123def456${String(i).padStart(32, '0')}\x00` +
					`author John Doe <john@example.com>\x00` +
					`date 2024-01-01T00:00:00Z\x00` +
					`message Commit message ${i} with some description about what changed\x00` +
					`M\x00src/file${i}.ts\x00A\x00src/newfile${i}.ts\x00`,
			)
			.join('\x00'),

		// Very Large: ~500KB - git blame for a large file (10,000 lines)
		veryLarge: Array(10000)
			.fill(null)
			.map(
				(_, i) =>
					`abc123def456 ${i} ${i} 1\n` +
					`author John Doe\n` +
					`author-mail <john@example.com>\n` +
					`author-time 1234567890\n` +
					`summary Line ${i} of code\n` +
					`\tconst variable${i} = someFunction();\n`,
			)
			.join('\n'),

		// Extreme: ~2MB - large git log with stats (5000 commits)
		extreme: Array(5000)
			.fill(null)
			.map(
				(_, i) =>
					`commit ${String(i).padStart(40, '0')}\x00` +
					`author Developer ${i % 10} <dev${i % 10}@example.com>\x00` +
					`date ${1234567890 + i}\x00` +
					`message Feature #${i}: Implement feature with detailed description\x00${Array(5)
						.fill(null)
						.map((_, j) => `M\x00100\x00${j * 10}\x00src/deep/path/to/file${i}_${j}.ts\x00`)
						.join('')}`,
			)
			.join('\x00'),
	};
}

/**
 * Display completion message
 */
export function displayCompletion(): void {
	console.log(`\n${'━'.repeat(80)}`);
	console.log('BENCHMARK COMPLETE');
	console.log(`${'━'.repeat(80)}\n`);
}
