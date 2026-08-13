import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Uri } from 'vscode';
import { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { DiscardExecutor } from '../discard.utils.js';
import { classifyFilesForDiscard, conflictHasHeadVersion, discardOneWith } from '../discard.utils.js';

// Ignore the user's global/system git config (e.g. `merge.ff=only`) so the temp repos behave
// predictably; identity is supplied per-command (never written).
const gitEnv = {
	...process.env,
	GIT_CONFIG_GLOBAL: '/dev/null',
	GIT_CONFIG_SYSTEM: '/dev/null',
	GIT_TERMINAL_PROMPT: '0',
};

function git(repo: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
		cwd: repo,
		encoding: 'utf8',
		env: gitEnv,
	});
}

/** Parse `git status --porcelain` into the GitStatusFile the provider would build for `path`. */
function statusFileOf(repo: string, path: string): GitStatusFile {
	const out = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', env: gitEnv });
	for (const line of out.split('\n')) {
		if (line.length < 3) continue;

		const x = line[0];
		const y = line[1];
		let rest = line.slice(3);
		let originalPath: string | undefined;
		const arrow = rest.indexOf(' -> ');
		if (arrow !== -1) {
			originalPath = rest.slice(0, arrow);
			rest = rest.slice(arrow + 4);
		}
		if (rest === path) {
			return new GitStatusFile(repo, x, y, rest, Uri.file(join(repo, rest)), originalPath);
		}
	}
	throw new Error(`No porcelain status entry for "${path}" in:\n${out}`);
}

/** A DiscardExecutor backed by git-CLI on the temp repo — the same effects the provider performs. */
function gitExec(repo: string): DiscardExecutor {
	return {
		canRestore: true,
		providerName: 'test',
		moveToTrash: uri => {
			rmSync(uri.fsPath, { force: true, recursive: true });
			return Promise.resolve();
		},
		unstage: path => {
			git(repo, 'reset', '-q', '--', path);
			return Promise.resolve();
		},
		restore: (path, options) => {
			if (options?.ref != null) {
				git(repo, 'checkout', options.ref, '--', path);
			} else {
				git(repo, 'checkout', '--', path);
			}
			return Promise.resolve();
		},
	};
}

suite('discard.utils — conflictHasHeadVersion', () => {
	const cases: [GitFileConflictStatus, boolean][] = [
		[GitFileConflictStatus.ModifiedByBoth, true],
		[GitFileConflictStatus.AddedByBoth, true],
		[GitFileConflictStatus.AddedByUs, true],
		[GitFileConflictStatus.DeletedByThem, true],
		[GitFileConflictStatus.AddedByThem, false],
		[GitFileConflictStatus.DeletedByUs, false],
		[GitFileConflictStatus.DeletedByBoth, false],
	];

	for (const [status, expected] of cases) {
		test(`${status} → ${expected}`, () => {
			assert.strictEqual(conflictHasHeadVersion(status), expected);
		});
	}
});

suite('discard.utils — classifyFilesForDiscard', () => {
	const repoPath = '/repo';
	const file = (x: string, y: string, path: string, originalPath?: string): GitStatusFile =>
		new GitStatusFile(repoPath, x, y, path, Uri.file(`${repoPath}/${path}`), originalPath);

	const buckets = ['untracked', 'trackedPureUnstaged', 'mixed', 'pureStaged', 'conflicted'] as const;

	/** Assert every bucket is empty except `only` (or all empty when `only` is omitted). */
	function assertOnlyBucket(
		result: ReturnType<typeof classifyFilesForDiscard>,
		only?: (typeof buckets)[number],
		count: number = 1,
	): void {
		for (const b of buckets) {
			assert.strictEqual(result[b].length, b === only ? count : 0, `${b} bucket`);
		}
	}

	test("' M' → trackedPureUnstaged", () => {
		const f = file(' ', 'M', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'trackedPureUnstaged');
		assert.strictEqual(result.trackedPureUnstaged[0], f);
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	test("' D' → trackedPureUnstaged", () => {
		const f = file(' ', 'D', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'trackedPureUnstaged');
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	test("'??' → untracked", () => {
		const f = file('?', '?', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'untracked');
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	const pureStagedCases: [string, string][] = [
		['M', 'a.txt'],
		['A', 'a.txt'],
		['D', 'a.txt'],
		['R', 'new.txt'],
	];

	for (const [x, path] of pureStagedCases) {
		test(`'${x} ' → pureStaged`, () => {
			// Real rename entries always carry an originalPath — keep it realistic even though it
			// doesn't affect classification.
			const f = x === 'R' ? file(x, ' ', path, 'old.txt') : file(x, ' ', path);

			const result = classifyFilesForDiscard([f], new Set([path]));
			assertOnlyBucket(result, 'pureStaged');
			assert.strictEqual(result.skippedMissingCount, 0);
		});
	}

	test("'MM' → mixed", () => {
		const f = file('M', 'M', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'mixed');
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	test("'UU' and 'DU' → conflicted", () => {
		for (const f of [file('U', 'U', 'a.txt'), file('D', 'U', 'a.txt')]) {
			const result = classifyFilesForDiscard([f], new Set(['a.txt']));
			assertOnlyBucket(result, 'conflicted');
			assert.strictEqual(result.skippedMissingCount, 0);
		}
	});

	test("' T' (working-tree typechange) → trackedPureUnstaged", () => {
		const f = file(' ', 'T', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'trackedPureUnstaged');
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	// Regression: `MT` parsed to indexStatus-only before working-tree `T` was mapped, so it read as
	// purely staged and a batch discard destroyed the staged content mixed semantics must preserve.
	test("'MT' → mixed, never pureStaged", () => {
		const f = file('M', 'T', 'a.txt');
		const result = classifyFilesForDiscard([f], new Set(['a.txt']));
		assertOnlyBucket(result, 'mixed');
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	test('a requested path with no matching status entry contributes to skippedMissingCount', () => {
		const result = classifyFilesForDiscard([], new Set(['gone.txt']));
		assertOnlyBucket(result);
		assert.strictEqual(result.skippedMissingCount, 1);
	});

	test('a status entry not in requestedPaths is ignored and does not affect skippedMissingCount', () => {
		const requested = file(' ', 'M', 'requested.txt');
		const other = file(' ', 'M', 'other.txt');
		const result = classifyFilesForDiscard([requested, other], new Set(['requested.txt']));
		assertOnlyBucket(result, 'trackedPureUnstaged');
		assert.strictEqual(result.trackedPureUnstaged[0], requested);
		assert.strictEqual(result.skippedMissingCount, 0);
	});

	test('a mixed selection routes each file to its own bucket', () => {
		const staged = file('M', ' ', 'staged.txt');
		const unstaged = file(' ', 'M', 'unstaged.txt');
		const both = file('M', 'M', 'mixed.txt');
		const untracked = file('?', '?', 'new.txt');

		const result = classifyFilesForDiscard(
			[staged, unstaged, both, untracked],
			new Set(['staged.txt', 'unstaged.txt', 'mixed.txt', 'new.txt']),
		);

		assert.deepStrictEqual(result.pureStaged, [staged], 'pureStaged');
		assert.deepStrictEqual(result.trackedPureUnstaged, [unstaged], 'trackedPureUnstaged');
		assert.deepStrictEqual(result.mixed, [both], 'mixed');
		assert.deepStrictEqual(result.untracked, [untracked], 'untracked');
		assert.strictEqual(result.conflicted.length, 0, 'conflicted');
		assert.strictEqual(result.skippedMissingCount, 0);
	});
});

suite('discard.utils — discardOneWith (temp repo)', function () {
	this.timeout(60000);

	let repo: string;

	setup(() => {
		repo = mkdtempSync(join(tmpdir(), 'gl-discard-'));
		git(repo, 'init', '-q', '-b', 'main');
	});

	teardown(() => {
		rmSync(repo, { recursive: true, force: true });
	});

	const commit = (msg: string): void => {
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', msg);
	};
	const tryMerge = (branch: string): void => {
		try {
			git(repo, 'merge', '--no-ff', '--no-edit', branch);
		} catch {
			// Conflict is the point of these setups — git exits non-zero and leaves the repo mid-merge.
		}
	};
	const discard = (path: string): Promise<void> => discardOneWith(gitExec(repo), statusFileOf(repo, path));
	const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
	const exists = (p: string): boolean => existsSync(join(repo, p));
	const porcelain = (): string =>
		execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8', env: gitEnv }).trim();
	// Whether `git status` still reports `p` with a 2-char unmerged code — proves a conflict discard
	// actually resolved the index, not just rewrote the file on disk.
	const conflicted = (p: string): boolean =>
		porcelain()
			.split('\n')
			.some(l => l.length >= 3 && l.slice(3) === p && /^(DD|AU|UD|UA|DU|AA|UU)$/.test(l.slice(0, 2)));

	// --- non-conflict permutations ---

	test('untracked → removed', async () => {
		writeFileSync(join(repo, 'base.txt'), 'b\n');
		commit('init');
		writeFileSync(join(repo, 'u.txt'), 'x\n');
		await discard('u.txt');
		assert.strictEqual(exists('u.txt'), false);
	});

	test('unstaged modified → reverted to HEAD, clean', async () => {
		writeFileSync(join(repo, 'm.txt'), 'base\n');
		commit('init');
		writeFileSync(join(repo, 'm.txt'), 'changed\n');
		await discard('m.txt');
		assert.strictEqual(read('m.txt'), 'base\n');
		assert.strictEqual(porcelain(), '');
	});

	test('staged modified → reverted to HEAD, clean', async () => {
		writeFileSync(join(repo, 'm.txt'), 'base\n');
		commit('init');
		writeFileSync(join(repo, 'm.txt'), 'staged\n');
		git(repo, 'add', 'm.txt');
		await discard('m.txt');
		assert.strictEqual(read('m.txt'), 'base\n');
		assert.strictEqual(porcelain(), '');
	});

	test('mixed (staged + unstaged) → keeps staged, drops unstaged', async () => {
		writeFileSync(join(repo, 'm.txt'), 'base\n');
		commit('init');
		writeFileSync(join(repo, 'm.txt'), 'staged\n');
		git(repo, 'add', 'm.txt');
		writeFileSync(join(repo, 'm.txt'), 'unstaged\n');
		await discard('m.txt');
		assert.strictEqual(read('m.txt'), 'staged\n');
		assert.strictEqual(porcelain(), 'M  m.txt');
	});

	test('mixed (staged content change + working-tree typechange, MT) → keeps staged content, drops the symlink', async function () {
		writeFileSync(join(repo, 'm.txt'), 'base\n');
		commit('init');
		writeFileSync(join(repo, 'm.txt'), 'staged\n');
		git(repo, 'add', 'm.txt');
		rmSync(join(repo, 'm.txt'));
		try {
			symlinkSync('nonexistent-target', join(repo, 'm.txt'));
		} catch {
			// Symlinks unavailable in this environment (e.g. Windows without Developer Mode) — the MT
			// setup itself can't be reproduced portably, so skip rather than fail the suite. `skip()`
			// is typed `never` (it throws to unwind the test as pending), so no `return` follows it.
			this.skip();
		}
		assert.strictEqual(porcelain(), 'MT m.txt', 'setup produced a staged content change + type change');
		await discard('m.txt');
		assert.strictEqual(
			lstatSync(join(repo, 'm.txt')).isSymbolicLink(),
			false,
			'symlink replaced with a regular file',
		);
		assert.strictEqual(read('m.txt'), 'staged\n', 'staged content preserved, not HEAD');
		assert.strictEqual(porcelain(), 'M  m.txt', 'staged change remains staged');
	});

	test('unstaged deleted → restored from HEAD', async () => {
		writeFileSync(join(repo, 'd.txt'), 'base\n');
		commit('init');
		rmSync(join(repo, 'd.txt'));
		await discard('d.txt');
		assert.strictEqual(read('d.txt'), 'base\n');
		assert.strictEqual(porcelain(), '');
	});

	test('staged added → removed', async () => {
		writeFileSync(join(repo, 'base.txt'), 'b\n');
		commit('init');
		writeFileSync(join(repo, 'a.txt'), 'x\n');
		git(repo, 'add', 'a.txt');
		await discard('a.txt');
		assert.strictEqual(exists('a.txt'), false);
		assert.strictEqual(porcelain(), '');
	});

	test('staged rename → original restored, new removed, clean', async () => {
		writeFileSync(join(repo, 'old.txt'), 'content\n');
		commit('init');
		git(repo, 'mv', 'old.txt', 'new.txt');
		await discard('new.txt');
		assert.strictEqual(exists('new.txt'), false);
		assert.strictEqual(read('old.txt'), 'content\n');
		assert.strictEqual(porcelain(), '');
	});

	// --- conflict permutations (HEAD = our/main side) ---
	// AddedByThem (UA), AddedByUs (AU), and DeletedByBoth (DD) aren't reproduced end-to-end here (they
	// need fragile rename/index scenarios). UA/DD share the no-restore "trash + unstage, no restore"
	// path that the DU test below exercises, and AU shares UD's restore-from-HEAD path; all seven are
	// covered by the pure `conflictHasHeadVersion` suite above.

	test('conflict both-modified (UU) → reverted to our (HEAD) version', async () => {
		writeFileSync(join(repo, 'c.txt'), 'base\nx\n');
		commit('init');
		git(repo, 'checkout', '-q', '-b', 'theirs');
		writeFileSync(join(repo, 'c.txt'), 'theirs\nx\n');
		commit('theirs');
		git(repo, 'checkout', '-q', 'main');
		writeFileSync(join(repo, 'c.txt'), 'main\nx\n');
		commit('main');
		tryMerge('theirs');
		assert.strictEqual(conflicted('c.txt'), true, 'setup produced a conflict');
		await discard('c.txt');
		assert.strictEqual(read('c.txt'), 'main\nx\n');
		assert.ok(!read('c.txt').includes('<<<<<<<'), 'no conflict markers remain');
		assert.strictEqual(conflicted('c.txt'), false, 'conflict resolved (index clean)');
	});

	test('conflict both-added (AA) → reverted to our (HEAD) version', async () => {
		writeFileSync(join(repo, 'base.txt'), 'b\n');
		commit('init');
		git(repo, 'checkout', '-q', '-b', 'theirs');
		writeFileSync(join(repo, 'c.txt'), 'theirs\n');
		commit('theirs-add');
		git(repo, 'checkout', '-q', 'main');
		writeFileSync(join(repo, 'c.txt'), 'main\n');
		commit('main-add');
		tryMerge('theirs');
		assert.strictEqual(conflicted('c.txt'), true, 'setup produced a conflict');
		await discard('c.txt');
		assert.strictEqual(read('c.txt'), 'main\n');
		assert.strictEqual(conflicted('c.txt'), false, 'conflict resolved (index clean)');
	});

	test('conflict modify/delete, deleted-by-us (DU) → removed (our side deleted)', async () => {
		writeFileSync(join(repo, 'c.txt'), 'base\n');
		commit('init');
		git(repo, 'checkout', '-q', '-b', 'theirs');
		writeFileSync(join(repo, 'c.txt'), 'theirs\n');
		commit('theirs-mod');
		git(repo, 'checkout', '-q', 'main');
		git(repo, 'rm', '-q', 'c.txt');
		commit('main-del');
		tryMerge('theirs');
		assert.strictEqual(conflicted('c.txt'), true, 'setup produced a modify/delete conflict');
		// git keeps theirs' working copy during a modify/delete — discard must still remove it.
		assert.strictEqual(exists('c.txt'), true);
		await discard('c.txt');
		assert.strictEqual(exists('c.txt'), false);
	});

	test('conflict modify/delete, deleted-by-them (UD) → kept as our (HEAD) version', async () => {
		writeFileSync(join(repo, 'c.txt'), 'base\n');
		commit('init');
		git(repo, 'checkout', '-q', '-b', 'theirs');
		git(repo, 'rm', '-q', 'c.txt');
		commit('theirs-del');
		git(repo, 'checkout', '-q', 'main');
		writeFileSync(join(repo, 'c.txt'), 'main\n');
		commit('main-mod');
		tryMerge('theirs');
		assert.strictEqual(conflicted('c.txt'), true, 'setup produced a modify/delete conflict');
		await discard('c.txt');
		assert.strictEqual(read('c.txt'), 'main\n');
		assert.strictEqual(conflicted('c.txt'), false, 'conflict resolved (index clean)');
	});
});
