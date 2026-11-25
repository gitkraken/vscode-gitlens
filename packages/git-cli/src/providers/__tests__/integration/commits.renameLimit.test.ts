import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitConfigsLogWithFiles } from '../../../exec/git.js';
import type { TestRepo } from './helpers.js';
import { createTestRepo } from './helpers.js';

/**
 * What the fallback for a page that runs out of time relies on, without any timeout: with git's finite rename limit,
 * only a commit with more rename candidates than the limit loses its inexact renames. Core's log reads set
 * `diff.renameLimit=0` (unlimited), which the command line's `-l` overrides.
 */
suite('CommitsSubProvider — git’s rename limit on a page of commits', () => {
	// Git's own default for `diff.renameLimit`
	const renameLimit = 1000;
	const bigCount = renameLimit + 1;
	const smallCount = 3;

	let repo: TestRepo;
	let bigSha: string;
	let smallSha: string;

	function commit(message: string): string {
		execFileSync('git', ['add', '-A'], { cwd: repo.path, stdio: 'pipe' });
		execFileSync('git', ['commit', '-m', message], { cwd: repo.path, stdio: 'pipe' });
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo.path, stdio: 'pipe' }).toString().trim();
	}

	/** Every line is unique to its file, so no two files resemble each other and a file resembles only its own edit */
	function content(name: string, edited: boolean): string {
		return Array.from({ length: 20 }, (_, i) => `${name} line ${i}${edited && i === 0 ? ' edited' : ''}\n`).join(
			'',
		);
	}

	suiteSetup(function () {
		this.timeout(60000);
		repo = createTestRepo();

		mkdirSync(join(repo.path, 'big'));
		mkdirSync(join(repo.path, 'small'));
		for (let i = 0; i < bigCount; i++) {
			writeFileSync(join(repo.path, 'big', `f${i}.txt`), content(`big${i}`, false));
		}
		for (let i = 0; i < smallCount; i++) {
			writeFileSync(join(repo.path, 'small', `f${i}.txt`), content(`small${i}`, false));
		}
		writeFileSync(join(repo.path, 'unedited.txt'), content('unedited', false));
		commit('Add files');

		// One commit moves and edits more files than the limit, and moves one without editing it. Each is renamed too:
		// git matches an edited file moved under the same name in a cheaper pass that the limit doesn't stop

		mkdirSync(join(repo.path, 'big-moved'));
		for (let i = 0; i < bigCount; i++) {
			renameSync(join(repo.path, 'big', `f${i}.txt`), join(repo.path, 'big-moved', `g${i}.txt`));
			writeFileSync(join(repo.path, 'big-moved', `g${i}.txt`), content(`big${i}`, true));
		}
		renameSync(join(repo.path, 'unedited.txt'), join(repo.path, 'unedited-moved.txt'));
		bigSha = commit('Move and edit many files');

		// The next one moves and edits only a few
		mkdirSync(join(repo.path, 'small-moved'));
		for (let i = 0; i < smallCount; i++) {
			renameSync(join(repo.path, 'small', `f${i}.txt`), join(repo.path, 'small-moved', `g${i}.txt`));
			writeFileSync(join(repo.path, 'small-moved', `g${i}.txt`), content(`small${i}`, true));
		}
		smallSha = commit('Move and edit a few files');
	});

	suiteTeardown(() => {
		repo.cleanup();
	});

	/** The name-status lines of each commit on the page, by sha, read the way a page is */
	async function readPage(...limitArgs: string[]): Promise<Map<string, string[]>> {
		const result = await repo.provider.git.run(
			{ cwd: repo.path, configs: gitConfigsLogWithFiles },
			'log',
			'--format=%x01%H',
			'--name-status',
			'-M',
			...limitArgs,
			'-n2',
			'HEAD',
			'--',
		);

		const byCommit = new Map<string, string[]>();
		for (const block of result.stdout.split('\x01').filter(b => b.trim())) {
			const [sha, ...lines] = block.split('\n');
			byCommit.set(
				sha.trim(),
				lines.filter(l => l.trim()),
			);
		}
		return byCommit;
	}

	const renames = (lines: string[]) => lines.filter(l => l.startsWith('R'));

	test('with the limit, a commit past it keeps only its exact moves while the rest of the page keeps its renames', async () => {
		const page = await readPage(`-l${renameLimit}`);
		const big = page.get(bigSha)!;
		const small = page.get(smallSha)!;

		assert.strictEqual(renames(big).length, 1, 'only the move without edits is still a rename');
		assert.ok(renames(big)[0].endsWith('unedited.txt\tunedited-moved.txt'));
		assert.strictEqual(big.filter(l => l.startsWith('D\tbig/')).length, bigCount, 'each edited move is a delete');
		assert.strictEqual(big.filter(l => l.startsWith('A\tbig-moved/')).length, bigCount, '...and an add');

		assert.strictEqual(renames(small).length, smallCount, 'a commit under the limit keeps its renames');
	});

	test('without the limit, the same commit’s edited moves are renames too', async () => {
		const page = await readPage();

		assert.strictEqual(renames(page.get(bigSha)!).length, bigCount + 1);
		assert.strictEqual(renames(page.get(smallSha)!).length, smallCount);
	});
});
