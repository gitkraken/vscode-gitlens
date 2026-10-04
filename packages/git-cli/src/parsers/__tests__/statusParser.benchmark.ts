/**
 * Git status parsing benchmark
 *
 * Measures `parseGitStatus` on large synthetic porcelain v2 output, alone and
 * together with reading every parsed file's `uri`.
 */

import { Bench } from 'tinybench';
import { parseGitStatus } from '../statusParser.js';

const repoPath = '/home/user/code/some-repo';
const sha = 'a'.repeat(40);

function makeStatusV2(untracked: number, modified: number): string {
	const lines = [`# branch.oid ${sha}`, '# branch.head main', '# branch.upstream origin/main', '# branch.ab +1 -2'];
	for (let i = 0; i < modified; i++) {
		lines.push(`1 .M N... 100644 100644 100644 ${sha} ${sha} src/feature${i % 50}/module${i % 20}/file${i}.ts`);
	}
	for (let i = 0; i < untracked; i++) {
		const dir = i % 7 === 0 ? 'sub dir' : 'subdir';
		lines.push(`? packages/pkg${i % 40}/node_modules/dep${i % 300}/lib/${dir}/file${i}.js`);
	}
	return `${lines.join('\n')}\n`;
}

interface Dataset {
	name: string;
	data: string;
}

async function runDataset({ name, data }: Dataset): Promise<void> {
	const bench = new Bench({ time: 500, warmupTime: 100, warmupIterations: 3, iterations: 5 });

	bench
		.add('parseGitStatus', () => {
			parseGitStatus(data, repoPath, 2);
		})
		.add('parseGitStatus + read every uri', () => {
			const status = parseGitStatus(data, repoPath, 2);
			if (status == null) return;

			for (const file of status.files) {
				void file.uri;
			}
		});

	await bench.run();

	console.log(`\n${name} (${(data.length / 1024 / 1024).toFixed(2)}MB)`);
	for (const task of bench.tasks) {
		const result = task.result;
		if (result.state !== 'completed') {
			console.log(`  ${task.name}: did not complete (${result.state})`);
			continue;
		}

		console.log(`  ${task.name}`);
		console.log(`    ${result.throughput.mean.toLocaleString('en-US', { maximumFractionDigits: 1 })} ops/sec`);
		console.log(`    mean ${result.latency.mean.toFixed(2)}ms, max ${result.latency.max.toFixed(2)}ms`);
	}
}

export async function main(): Promise<void> {
	console.log('━'.repeat(80));
	console.log('GIT STATUS PARSING BENCHMARK');
	console.log('━'.repeat(80));

	const datasets: Dataset[] = [
		{ name: '25k untracked', data: makeStatusV2(25000, 0) },
		{ name: '100k untracked', data: makeStatusV2(100000, 0) },
		{ name: '20k untracked + 5k modified', data: makeStatusV2(20000, 5000) },
	];

	for (const dataset of datasets) {
		await runDataset(dataset);
	}

	console.log('\n✓ Benchmark complete\n');
}

void main();
