import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { TestRepo } from './helpers.js';
import { addCommit, createTestRepo } from './helpers.js';

// A tracked file whose timestamps moved but whose content did not makes every working-tree `git diff` want to refresh
// the index and write it. These reads run in the background while the user or an agent may be staging or committing,
// so they must leave the index file alone and still answer "clean".
suite('Reads leave the index untouched when only timestamps moved', () => {
	let repo: TestRepo;

	setup(() => {
		repo = createTestRepo();
		addCommit(repo.path, 'a.txt', 'a\n', 'add a');
		addCommit(repo.path, 'b.txt', 'b\n', 'add b');
		addCommit(repo.path, 'c.txt', 'c\n', 'add c');
	});

	teardown(() => {
		repo.cleanup();
	});

	function touch(...files: string[]): void {
		for (const file of files) {
			const path = join(repo.path, file);
			const time = new Date(statSync(path).mtimeMs + 5000);
			utimesSync(path, time, time);
		}
	}

	function readIndex(): Buffer {
		const location = execFileSync('git', ['rev-parse', '--git-path', 'index'], {
			cwd: repo.path,
			encoding: 'utf8',
		}).trim();
		return readFileSync(resolve(repo.path, location));
	}

	async function assertIndexUntouched<T>(read: () => Promise<T>, assertAnswer: (answer: T) => void): Promise<void> {
		touch('a.txt', 'b.txt');
		const before = readIndex();

		const answer = await read();

		assert.ok(before.equals(readIndex()), 'the read rewrote the index');
		assertAnswer(answer);
	}

	test('hasWorkingChanges (default)', async () => {
		await assertIndexUntouched(
			() => repo.provider.status.hasWorkingChanges(repo.path),
			answer => assert.strictEqual(answer, false),
		);
	});

	test('hasWorkingChanges (unstaged only)', async () => {
		await assertIndexUntouched(
			() =>
				repo.provider.status.hasWorkingChanges(repo.path, {
					staged: false,
					unstaged: true,
					untracked: false,
				}),
			answer => assert.strictEqual(answer, false),
		);
	});

	test('getWorkingChangesState', async () => {
		await assertIndexUntouched(
			() => repo.provider.status.getWorkingChangesState(repo.path),
			answer => assert.deepStrictEqual(answer, { staged: false, unstaged: false, untracked: false }),
		);
	});

	test('getDiff', async () => {
		await assertIndexUntouched(
			() => repo.provider.diff.getDiff?.(repo.path, uncommitted),
			answer => assert.strictEqual(answer?.contents ?? '', ''),
		);
	});

	test('getDiffStatus', async () => {
		await assertIndexUntouched(
			() => repo.provider.diff.getDiffStatus(repo.path, 'HEAD'),
			answer => assert.strictEqual(answer, undefined),
		);
	});

	test('getChangedFilesCount', async () => {
		await assertIndexUntouched(
			() => repo.provider.diff.getChangedFilesCount(repo.path, uncommitted),
			answer => assert.strictEqual(answer, undefined),
		);
	});

	test('getDiffForFile', async () => {
		await assertIndexUntouched(
			() => repo.provider.diff.getDiffForFile(repo.path, 'a.txt', 'HEAD'),
			answer => assert.strictEqual(answer?.hunks?.length ?? 0, 0),
		);
	});

	test('a real edit is still reported while the index stays untouched', async () => {
		touch('a.txt', 'b.txt');
		writeFileSync(join(repo.path, 'c.txt'), 'changed\n');
		const before = readIndex();

		const hasChanges = await repo.provider.status.hasWorkingChanges(repo.path);
		const status = await repo.provider.diff.getDiffStatus(repo.path, 'HEAD');
		const diff = await repo.provider.diff.getDiff?.(repo.path, uncommitted);

		assert.ok(before.equals(readIndex()), 'a read rewrote the index');
		assert.strictEqual(hasChanges, true);
		assert.deepStrictEqual(
			status?.map(f => f.path),
			['c.txt'],
		);
		const contents = diff?.contents ?? '';
		assert.ok(contents.includes('c.txt'));
		assert.ok(!contents.includes('a.txt'));
		assert.ok(!contents.includes('b.txt'));
	});
	// The configs of every `git diff` run made while `read` executes
	async function captureDiffConfigs(read: () => Promise<unknown>): Promise<string[][]> {
		const git = repo.provider.git;
		const run = git.run.bind(git) as (options: { configs?: readonly string[] }, ...args: unknown[]) => unknown;
		const captured: string[][] = [];
		(git as unknown as { run: typeof run }).run = (options, ...args) => {
			if (args[0] === 'diff') {
				captured.push([...(options.configs ?? [])]);
			}
			return run(options, ...args);
		};
		try {
			await read();
		} finally {
			(git as unknown as { run: typeof run }).run = run;
		}
		return captured;
	}

	const noRefresh = 'diff.autoRefreshIndex=false';

	test('asks git not to refresh the index when it supports that', async () => {
		const captured = await captureDiffConfigs(async () => {
			await repo.provider.status.hasWorkingChanges(repo.path);
			await repo.provider.diff.getDiffStatus(repo.path, 'HEAD');
		});

		assert.ok(captured.length >= 2);
		for (const configs of captured) {
			assert.ok(configs.includes(noRefresh), configs.join(' '));
		}
	});

	test('leaves auto-refresh alone on a git before diffs compare contents', async () => {
		const git = repo.provider.git;
		const supports = git.supports.bind(git);
		git.supports = feature => (feature === 'git:diff:autoRefreshIndex:off' ? false : supports(feature));

		touch('a.txt', 'b.txt');
		let hasChanges: boolean | undefined;
		const captured = await captureDiffConfigs(async () => {
			hasChanges = await repo.provider.status.hasWorkingChanges(repo.path);
			await repo.provider.diff.getDiffStatus(repo.path, 'HEAD');
		});

		assert.ok(captured.length >= 2);
		for (const configs of captured) {
			assert.ok(!configs.includes(noRefresh), configs.join(' '));
		}
		// Left to refresh the index, a touched file reads as clean on any git
		assert.strictEqual(hasChanges, false);
	});
});
