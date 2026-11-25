import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { execPath } from 'node:process';
import type { Readable } from 'node:stream';
import type { GitGraphSearch, GitGraphSearchProgress } from '@gitlens/git/models/graphSearch.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { ProcessSpawner } from '@gitlens/utils/env/node/exec.js';
import { spawnProcess } from '@gitlens/utils/env/node/exec.js';
import { FlagsRowProcessor } from './graphEquivalence.js';
import type { TestRepo } from './helpers.js';
import { addEmptyCommits, createTestRepo, getHeadSha, revParse } from './helpers.js';

type Interception =
	/** Aborts `controller` once the matching process has handed over its first chunk and is asked for another */
	| { kind: 'abortAfterFirstChunk'; matches: (args: readonly string[]) => boolean; controller: AbortController }
	/** Aborts `controller` as soon as the matching process is launched, before it has written anything */
	| { kind: 'abortAtLaunch'; matches: (args: readonly string[]) => boolean; controller: AbortController }
	/** Launches a process that writes nothing and never exits in place of the matching one */
	| { kind: 'silent'; matches: (args: readonly string[]) => boolean };

const isCancellation = (ex: unknown) => isCancellationError(ex);

/**
 * Reads whose git output is cut short because their caller cancelled them: what the read hands back, and what it keeps.
 * Each test intercepts one git process through the spawner; everything else runs real git.
 */
suite('Reads cancelled midway through their git stream (real git)', () => {
	let repo: TestRepo;
	let interception: Interception | undefined;
	/** Chunks the intercepted process handed over before the read gave up */
	let chunksRead = 0;
	/**
	 * Settles a turn after the intercepted process closed: what a shared read does with the cut-short output follows
	 * from that close with no further I/O, so by then it has been kept or dropped
	 */
	let interceptedClosed: Promise<void> = Promise.resolve();

	const spawn: ProcessSpawner = (command, args, options) => {
		const current = interception;
		if (current == null || !current.matches(args)) return spawnProcess(command, args, options);

		interception = undefined;
		if (current.kind === 'silent') return spawnProcess(execPath, ['-e', 'setTimeout(() => {}, 60000)'], options);

		const child = spawnProcess(command, args, options);
		interceptedClosed = new Promise(resolve => child.once('close', () => setImmediate(resolve)));
		if (current.kind === 'abortAtLaunch') {
			// Once the stream has its listeners on the process (the abort emits `error` on it), and before any of
			// the process's output can be read
			queueMicrotask(() => current.controller.abort());
			return child;
		}

		// The stream reads its pipe through `read()`, so the second call comes once the first chunk is consumed
		chunksRead = 0;
		const stdout: Readable = child.stdout!;
		const read = stdout.read.bind(stdout);
		stdout.read = (size?: number) => {
			if (chunksRead > 0 && !current.controller.signal.aborted) {
				current.controller.abort();
			}
			const chunk: unknown = read(size);
			if (chunk != null) {
				chunksRead++;
			}
			return chunk;
		};
		return child;
	};

	suiteSetup(function () {
		this.timeout(60000);

		repo = createTestRepo({ gitOptions: { spawn: spawn } });

		// Each commit edits a file of its own, and `history.txt`, so a page of commits with their files, or the
		// history of that one file, spans many chunks
		const commands: string[] = [];
		const identity = 'Test User <test@gitlens.test>';
		for (let i = 0; i < 400; i++) {
			const seconds = 1704067200 + i * 60;
			const message = `Commit ${i} ${'x'.repeat(200)}\n`;
			const content = `file ${i}\n${'y'.repeat(200)}\n`;
			commands.push(
				`commit refs/heads/main\nauthor ${identity} ${seconds} +0000\ncommitter ${identity} ${seconds} +0000\ndata ${Buffer.byteLength(message)}\n${message}${i === 0 ? 'from refs/heads/main^0\n' : ''}M 100644 inline f${i}.txt\ndata ${Buffer.byteLength(content)}\n${content}\nM 100644 inline history.txt\ndata ${Buffer.byteLength(content)}\n${content}\n`,
			);
		}
		execFileSync('git', ['fast-import', '--quiet', '--date-format=raw'], {
			cwd: repo.path,
			input: commands.join(''),
			stdio: ['pipe', 'pipe', 'pipe'],
		});
		// fast-import moves only the branch; a file's history is read only for a file the checkout tracks
		execFileSync('git', ['reset', '--hard', '--quiet'], { cwd: repo.path, stdio: 'pipe' });
		// Enough history that a graph page's walk spans many chunks too
		addEmptyCommits(repo.path, 3000, 'g');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	teardown(() => {
		interception = undefined;
	});

	suite('a page of commits', () => {
		const limit = 300;
		const isPageRead = (args: readonly string[]) => args.includes('log') && args.includes(`-n${limit + 1}`);

		test('rejects with the cancellation rather than returning the commits read so far', async () => {
			const controller = new AbortController();
			interception = { kind: 'abortAfterFirstChunk', matches: isPageRead, controller: controller };

			await assert.rejects(
				repo.provider.commits.getLog(
					repo.path,
					undefined,
					{ limit: limit, includeFiles: true },
					controller.signal,
				),
				isCancellation,
			);
			assert.ok(controller.signal.aborted, 'the read was cancelled');
			assert.ok(chunksRead >= 1, 'after git had started handing over its output');

			const log = await repo.provider.commits.getLog(repo.path, undefined, { limit: limit, includeFiles: true });
			assert.strictEqual(log?.commits.size, limit, 'the same read, not cancelled, returns the full page');
			assert.strictEqual(log?.hasMore, true);
		});
	});

	suite('a file’s history', () => {
		test('a read every caller cancelled midway is not kept for the next caller', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAfterFirstChunk',
				matches: args => args.includes('log') && args.includes('history.txt'),
				controller: controller,
			};

			await assert.rejects(
				repo.provider.commits.getLogForPath(repo.path, 'history.txt', undefined, undefined, controller.signal),
				isCancellation,
			);
			assert.ok(chunksRead >= 1, 'after git had started handing over its output');
			await interceptedClosed;

			const log = await repo.provider.commits.getLogForPath(repo.path, 'history.txt');
			assert.strictEqual(log?.commits.size, 400, 'the next caller reads the whole history');
		});
	});

	suite('a commit search', () => {
		test('rejects with the cancellation rather than returning an empty result', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAtLaunch',
				matches: args => args.includes('log') && args.includes('--use-mailmap'),
				controller: controller,
			};

			await assert.rejects(
				repo.provider.commits.searchCommits(repo.path, { query: 'Commit 1' }, { limit: 10 }, controller.signal),
				isCancellation,
			);

			const result = await repo.provider.commits.searchCommits(repo.path, { query: 'Commit 1' }, { limit: 10 });
			assert.strictEqual(result.log?.commits.size, 10);
		});
	});

	suite('the refs containing commits', () => {
		test('rejects with the cancellation rather than returning what the walk had propagated', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAtLaunch',
				matches: args => args.includes('rev-list'),
				controller: controller,
			};
			const root = revParse(repo.path, 'main~3400');

			await assert.rejects(
				repo.provider.refs.getRefsContainingShas(repo.path, [root], root, undefined, controller.signal),
				isCancellation,
			);

			const refs = await repo.provider.refs.getRefsContainingShas(repo.path, [root], root);
			assert.deepStrictEqual(
				refs.get(root)?.map(r => r.name),
				['main'],
			);
		});
	});

	suite('contributors', () => {
		test('a read every caller cancelled is not kept for the next caller', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAtLaunch',
				matches: args => args.includes('log'),
				controller: controller,
			};

			await assert.rejects(
				repo.provider.contributors.getContributors(repo.path, 'HEAD~1', undefined, controller.signal),
				isCancellation,
			);
			await interceptedClosed;

			const read = await repo.provider.contributors.getContributors(repo.path, 'HEAD~1');
			assert.strictEqual(read.cancelled, undefined, 'the next caller runs git rather than the cancelled read');
			assert.strictEqual(read.contributors.length, 1);
		});
	});

	suite('contributors with a time limit', () => {
		test('a read the time limit cut short says it timed out, and is not kept', async () => {
			interception = { kind: 'silent', matches: args => args.includes('log') };

			const timedOut = await repo.provider.contributors.getContributors(
				repo.path,
				undefined,
				undefined,
				undefined,
				1000,
			);
			assert.deepStrictEqual(timedOut.cancelled, { reason: 'timedout' });
			assert.strictEqual(timedOut.contributors.length, 0);

			const read = await repo.provider.contributors.getContributors(
				repo.path,
				undefined,
				undefined,
				undefined,
				1000,
			);
			assert.strictEqual(
				read.cancelled,
				undefined,
				'the same read again runs git rather than the cut-short read',
			);
			assert.strictEqual(read.contributors.length, 1);
		});
	});

	suite('the commit graph', () => {
		const isFirstWalk = (args: readonly string[]) =>
			args.includes('log') && args.includes('--all') && !args.some(a => a.startsWith('--skip='));
		const isPageWalk = (args: readonly string[]) => args.includes('log') && args.some(a => a.startsWith('--skip='));

		test('a first walk cancelled midway rejects with the cancellation', async () => {
			const controller = new AbortController();
			interception = { kind: 'abortAfterFirstChunk', matches: isFirstWalk, controller: controller };

			await assert.rejects(
				repo.provider.graph.getGraph(repo.path, undefined, { limit: 2000 }, controller.signal),
				isCancellation,
			);
			assert.ok(chunksRead >= 1, 'after git had started handing over its output');
		});

		test('a page cancelled midway keeps the rows it built, says more remain, and the next page follows on', async () => {
			const session = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				limit: 10,
			});

			const controller = new AbortController();
			interception = { kind: 'abortAfterFirstChunk', matches: isPageWalk, controller: controller };
			assert.strictEqual(await session.more(2000, undefined, controller.signal), 'added');
			assert.ok(controller.signal.aborted, 'the page was cancelled');
			const cutShort = session.window.length;
			assert.ok(cutShort > 10 && cutShort < 2010, `the page was cut short (${cutShort} rows)`);
			assert.strictEqual(session.current.paging?.hasMore, true, 'a cut-short page says more remain');

			assert.strictEqual(await session.more(2000), 'added');
			const paged = session.window.map(r => r.sha);

			const expected = await repo.provider.graph.openGraphSession(repo.path, {
				rowProcessor: new FlagsRowProcessor(),
				limit: paged.length,
			});
			assert.deepStrictEqual(
				paged,
				expected.window.map(r => r.sha),
				'no row is missing or repeated',
			);
			assert.strictEqual(paged[0], getHeadSha(repo.path));
		});

		test('a search cancelled before git wrote anything can be resumed rather than reading as complete', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAtLaunch',
				matches: args => args.includes('log') && args.includes('--use-mailmap'),
				controller: controller,
			};

			const result = await drainSearch(
				repo.provider.graph.searchGraph(repo.path, { query: 'commit' }, { limit: 100 }, controller.signal),
			);
			assert.strictEqual(result.hasMore, true);
			assert.strictEqual(result.results.size, 0);
		});
	});

	suite('a working tree presence check', () => {
		test('a cancelled check rejects with the cancellation rather than answering no', async () => {
			const controller = new AbortController();
			interception = {
				kind: 'abortAtLaunch',
				matches: args => args.includes('ls-files') && args.includes('--unmerged'),
				controller: controller,
			};

			await assert.rejects(
				repo.provider.status.hasConflictingFiles(repo.path, controller.signal),
				isCancellation,
			);
		});
	});
});

async function drainSearch(gen: AsyncGenerator<GitGraphSearchProgress, GitGraphSearch, void>): Promise<GitGraphSearch> {
	let result = await gen.next();
	while (!result.done) {
		result = await gen.next();
	}
	return result.value;
}
