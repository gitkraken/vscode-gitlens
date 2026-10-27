/**
 * `@debug` call logging benchmark
 *
 * Replays a burst of per-worktree provider reads (mostly cache hits, a few that run a git command)
 * through `@debug`-decorated methods, and compares the lines written and the time per call with
 * full call logging, with `quietCallsUnder`, and with debug logging off.
 */

import { Bench } from 'tinybench';
import { displayCompletion, displayResults, extractResults } from '../../__tests__/benchmarkUtils.js';
import type { LogChannel, LoggerOptions } from '../../logger.js';
import { Logger } from '../../logger.js';
import { formatLoggableScopeBlock } from '../../logger.scoped.js';
import { debug } from '../log.js';

const worktrees = Array.from({ length: 80 }, (_, i) => `/home/user/code/repo.worktrees/feature-${i}`);
/** One read in this many misses the cache and runs a git command */
const missEvery = 20;

let lines = 0;
let bytes = 0;

function configure(level: number, options?: LoggerOptions): void {
	const write = (message: string | Error, ...rest: unknown[]) => {
		lines++;
		bytes += String(message).length;
		for (const r of rest) {
			bytes += String(r).length;
		}
	};
	const channel: LogChannel = {
		name: 'benchmark',
		logLevel: level as LogChannel['logLevel'],
		trace: write,
		debug: write,
		info: write,
		warn: write,
		error: write,
	};
	Logger.configure({ name: 'benchmark', createChannel: () => channel }, false, options);
}

class Provider {
	private readonly cache = new Map<string, Promise<string[]>>();
	private reads = 0;

	@debug({ quiet: true })
	getWorktrees(repoPath: string): Promise<string[]> {
		return this.read('worktree list', repoPath);
	}

	@debug({ quiet: true })
	getBranches(repoPath: string, options?: { filter?: string; sort?: boolean }): Promise<string[]> {
		return this.read(`for-each-ref ${options?.filter ?? ''}`, repoPath);
	}

	@debug({ quiet: true })
	getRemotes(repoPath: string, options?: { sort?: boolean }): Promise<string[]> {
		return this.read(`remote -v ${options?.sort ?? ''}`, repoPath);
	}

	@debug({ quiet: true })
	async getBranch(repoPath: string): Promise<string | undefined> {
		const branches = await this.getBranches(repoPath, { filter: 'refs/heads' });
		return branches[0];
	}

	private read(command: string, repoPath: string): Promise<string[]> {
		const key = `${command}:${repoPath}`;
		let cached = this.cache.get(key);
		if (cached == null || ++this.reads % missEvery === 0) {
			cached = this.git(command, repoPath);
			this.cache.set(key, cached);
		}
		return cached;
	}

	private async git(command: string, repoPath: string): Promise<string[]> {
		await Promise.resolve();
		// Stands in for the git runner, which writes one line per command it runs
		Logger.info(`${formatLoggableScopeBlock('GIT', '3ms')} git ${command} (${repoPath}) [3ms]`);
		return ['main'];
	}
}

const provider = new Provider();

async function burst(): Promise<void> {
	await Promise.all(
		worktrees.map(async w => {
			await provider.getWorktrees(w);
			await provider.getRemotes(w, { sort: true });
			await provider.getBranch(w);
			await provider.getBranches(w, { filter: 'refs/heads', sort: true });
		}),
	);
}

const modes: { name: string; level: number; options?: LoggerOptions }[] = [
	{ name: 'debug, full call logging', level: 2 },
	{ name: 'debug, quietCallsUnder: 10', level: 2, options: { quietCallsUnder: 10 } },
	{ name: 'info (debug off)', level: 3 },
];

async function main(): Promise<void> {
	console.log(`\n@debug call logging: ${worktrees.length} worktrees x 5 reads, 1 in ${missEvery} runs git`);

	const bench = new Bench({ time: 1000, warmupTime: 200 });
	for (const mode of modes) {
		bench.add(mode.name, burst, {
			beforeAll: () => configure(mode.level, mode.options),
		});
	}
	await bench.run();
	const results = extractResults(bench.tasks);
	displayResults(results);
	for (const result of results) {
		console.log(`  ${result.name.padEnd(30)} ${(1e6 / result.opsPerSec).toFixed(0)}µs per burst`);
	}

	console.log('\nLines per burst:');
	for (const mode of modes) {
		configure(mode.level, mode.options);
		lines = 0;
		bytes = 0;
		await burst();
		console.log(`  ${mode.name.padEnd(30)} ${String(lines).padStart(5)} lines  ${String(bytes).padStart(7)} bytes`);
	}

	displayCompletion();
}

void main();
