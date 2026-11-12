import * as assert from 'assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AheadOfBase } from '@gitlens/git/providers/branches.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProvider } from '../../../cliGitProvider.js';
import type { TestRepo } from './helpers.js';
import { addCommit, cloneTestRepo, createProvider, createTestRepo, createWorktree } from './helpers.js';

/**
 * Random moves of the task branch (commits, amends, merges, resets, cherry-picks, rebases, fast-forwards) among moves of
 * local `main`, `origin/main` and `upstream/main`, from a printed seed. After each move of the task branch, the base is
 * carried past it from the last full read (see `getAheadOfBaseAfterCommit`) and read in full: whenever the shortcut
 * answers, the two must be equal. `BASE_COMMITS_SEED` and `BASE_COMMITS_SEQUENCES` replay or widen a run.
 */
suite('Carrying a base past random moves of its branch', function () {
	const seed = Number(process.env.BASE_COMMITS_SEED ?? 20261112);
	const sequences = Number(process.env.BASE_COMMITS_SEQUENCES ?? 3);
	const movesPerSequence = 12;

	this.timeout(Math.max(60000, sequences * 12000));

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	/** Whether the git command ran; a move it can't make (a conflicting cherry-pick, say) doesn't apply */
	function tryGit(cwd: string, ...args: string[]): boolean {
		try {
			git(cwd, ...args);
			return true;
		} catch {
			return false;
		}
	}

	/** {@link tryGit}, undoing a merge, cherry-pick or rebase left stopped on a conflict */
	function tryOrAbort(cwd: string, abort: string, ...args: string[]): boolean {
		if (tryGit(cwd, ...args)) return true;

		tryGit(cwd, abort, '--abort');
		return false;
	}

	/** mulberry32: small, fast and the same everywhere for a seed */
	function createRandom(from: number): () => number {
		let state = from >>> 0;
		return () => {
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	type Fixture = {
		readonly root: string;
		readonly repo: TestRepo;
		readonly peer: TestRepo;
		readonly task: { path: string; cleanup: () => void };
		readonly upstream: boolean;
		next: number;
	};

	function createFixture(random: () => number): Fixture {
		const root = mkdtempSync(join(tmpdir(), 'gitlens-base-commits-'));
		const origin = join(root, 'origin.git');
		git(root, 'init', '-q', '--bare', '-b', 'main', origin);

		const repo = createTestRepo();
		git(repo.path, 'remote', 'add', 'origin', origin);
		git(repo.path, 'push', '-q', '-u', 'origin', 'main');
		git(repo.path, 'remote', 'set-head', 'origin', 'main');
		// Half the runs have an `upstream` remote, whose copy of the base contends with it
		const upstream = random() < 0.5;
		if (upstream) {
			git(repo.path, 'remote', 'add', 'upstream', origin);
		}

		const peer = cloneTestRepo(origin);
		for (let i = 0; i < 1 + Math.floor(random() * 3); i++) {
			addCommit(peer.path, `peer-setup-${i}.txt`, `${i}`, `Peer setup ${i}`);
		}
		git(peer.path, 'push', '-q', 'origin', 'main');
		git(repo.path, 'fetch', '-q', 'origin');
		if (random() < 0.5) {
			git(repo.path, 'merge', '-q', '--ff-only', 'origin/main');
		}

		// Taken off the remote's branch, as a host does, or off local main
		git(repo.path, 'branch', '--no-track', 'task', random() < 0.75 ? 'origin/main' : 'main');
		git(repo.path, 'branch', '--no-track', 'other', 'origin/main');
		const task = createWorktree(repo.path, 'task');
		for (let i = 0; i < Math.floor(random() * 3); i++) {
			addCommit(task.path, `task-setup-${i}.txt`, `${i}`, `Task setup ${i}`);
		}
		return { root: root, repo: repo, peer: peer, task: task, upstream: upstream, next: 0 };
	}

	function disposeFixture(fixture: Fixture): void {
		fixture.task.cleanup();
		fixture.peer.cleanup();
		fixture.repo.cleanup();
		rmSync(fixture.root, { recursive: true, force: true });
	}

	type Move = {
		readonly name: string;
		readonly weight: number;
		readonly run: (f: Fixture) => boolean;
		/** Made while the base is read in full, after the read listed the refs (see {@link readDuring}) */
		readonly duringRead?: boolean;
	};

	function pick<T>(random: () => number, items: readonly T[]): T {
		return items[Math.floor(random() * items.length)];
	}

	function createMoves(random: () => number): readonly Move[] {
		const name = (f: Fixture, prefix: string) => `${prefix}-${f.next++}`;
		return [
			{
				name: 'commit on task during a read of its base',
				weight: 2,
				duringRead: true,
				run: f => {
					const file = name(f, 'raced');
					addCommit(f.task.path, `${file}.txt`, file, file);
					return true;
				},
			},
			{
				name: 'commit on task',
				weight: 8,
				run: f => {
					const file = name(f, 'task');
					addCommit(f.task.path, `${file}.txt`, file, file);
					return true;
				},
			},
			{
				name: 'commit on task reading as its creation',
				weight: 1,
				run: f => {
					const file = name(f, 'created');
					addCommit(
						f.task.path,
						`${file}.txt`,
						file,
						`branch: Created from ${pick(random, ['main', 'other'])}`,
					);
					return true;
				},
			},
			{
				name: 'amend task',
				weight: 1,
				run: f => tryGit(f.task.path, 'commit', '-q', '--amend', '--allow-empty', '-m', name(f, 'amended')),
			},
			{
				name: 'amend task, logged as a commit',
				weight: 1,
				run: f => {
					try {
						execFileSync('git', ['commit', '-q', '--amend', '--allow-empty', '-m', name(f, 'amended')], {
							cwd: f.task.path,
							stdio: 'pipe',
							env: { ...process.env, GIT_REFLOG_ACTION: 'commit' },
						});
						return true;
					} catch {
						return false;
					}
				},
			},
			{
				name: 'merge origin/main into task',
				weight: 1,
				run: f => tryOrAbort(f.task.path, 'merge', 'merge', '-q', '--no-ff', '--no-edit', 'origin/main'),
			},
			{
				name: 'merge main into task',
				weight: 1,
				run: f => tryOrAbort(f.task.path, 'merge', 'merge', '-q', '--no-ff', '--no-edit', 'main'),
			},
			{
				name: 'merge another branch into task',
				weight: 1,
				run: f => {
					const tree = git(f.repo.path, 'rev-parse', 'other^{tree}');
					const work = git(f.repo.path, 'commit-tree', '-p', 'other', '-m', name(f, 'other'), tree);
					git(f.repo.path, 'update-ref', 'refs/heads/other', work);
					return tryOrAbort(f.task.path, 'merge', 'merge', '-q', '--no-ff', '--no-edit', 'other');
				},
			},
			{
				name: 'reset task back',
				weight: 1,
				run: f => tryGit(f.task.path, 'reset', '-q', '--hard', `HEAD~${1 + Math.floor(random() * 2)}`),
			},
			{
				name: 'cherry-pick origin/main onto task',
				weight: 1,
				run: f => tryOrAbort(f.task.path, 'cherry-pick', 'cherry-pick', '--allow-empty', 'origin/main'),
			},
			{
				name: 'rebase task onto origin/main',
				weight: 1,
				run: f => tryOrAbort(f.task.path, 'rebase', 'rebase', '-q', 'origin/main'),
			},
			{
				name: 'check out another branch and back',
				weight: 1,
				run: f =>
					tryGit(f.task.path, 'checkout', '-q', 'other') && tryGit(f.task.path, 'checkout', '-q', 'task'),
			},
			{
				// A child of the task's commit lands on the base, which then moves back off it, sometimes holding copies
				// of the task's commits: the child is a value of the base's reflog, and the task fast-forwards onto it
				name: "fast-forward task onto a commit the base's reflog holds",
				weight: 1,
				run: f => {
					const tip = git(f.repo.path, 'rev-parse', 'origin/main');
					// From this checkout, whose `origin/main` the remote may no longer hold
					git(f.peer.path, 'fetch', '-q', f.repo.path, 'refs/remotes/origin/main');
					const own = git(f.task.path, 'rev-parse', 'HEAD');
					const tree = git(f.task.path, 'rev-parse', 'HEAD^{tree}');
					const child = git(f.task.path, 'commit-tree', '-p', own, '-m', name(f, 'child'), tree);
					const pushed = tryGit(f.repo.path, 'push', '-q', '--force', 'origin', `${child}:refs/heads/main`);
					if (!pushed) return false;

					git(f.repo.path, 'fetch', '-q', 'origin');
					git(f.peer.path, 'fetch', '-q', 'origin');
					git(f.peer.path, 'reset', '-q', '--hard', tip);
					if (random() < 0.5) {
						tryOrAbort(f.peer.path, 'cherry-pick', 'cherry-pick', '--allow-empty', `${tip}..${own}`);
					}
					git(f.peer.path, 'push', '-q', '--force', 'origin', 'HEAD:refs/heads/main');
					git(f.repo.path, 'fetch', '-q', 'origin');
					return tryGit(f.task.path, 'merge', '-q', '--ff-only', child);
				},
			},
			{
				name: 'peer pushes',
				weight: 2,
				run: f => {
					git(f.peer.path, 'fetch', '-q', 'origin');
					git(f.peer.path, 'reset', '-q', '--hard', 'origin/main');
					const file = name(f, 'peer');
					addCommit(f.peer.path, `${file}.txt`, file, file);
					return tryGit(f.peer.path, 'push', '-q', 'origin', 'main');
				},
			},
			{
				name: 'peer force-pushes a rewrite',
				weight: 1,
				run: f => {
					git(f.peer.path, 'fetch', '-q', 'origin');
					if (!tryGit(f.peer.path, 'reset', '-q', '--hard', 'origin/main~1')) return false;

					const file = name(f, 'rewrite');
					addCommit(f.peer.path, `${file}.txt`, file, file);
					return tryGit(f.peer.path, 'push', '-q', '--force', 'origin', 'main');
				},
			},
			{ name: 'fetch', weight: 3, run: f => tryGit(f.repo.path, 'fetch', '-q', 'origin') },
			{
				name: 'fast-forward main to origin/main',
				weight: 1,
				run: f => tryGit(f.repo.path, 'merge', '-q', '--ff-only', 'origin/main'),
			},
			{
				name: 'commit on main',
				weight: 1,
				run: f => {
					const file = name(f, 'main');
					addCommit(f.repo.path, `${file}.txt`, file, file);
					return true;
				},
			},
			{
				name: 'reset main back',
				weight: 1,
				run: f => tryGit(f.repo.path, 'reset', '-q', '--hard', 'HEAD~1'),
			},
			{
				name: 'cherry-pick a task commit onto main',
				weight: 1,
				run: f => tryOrAbort(f.repo.path, 'cherry-pick', 'cherry-pick', '--allow-empty', 'task'),
			},
			{ name: 'push main', weight: 1, run: f => tryGit(f.repo.path, 'push', '-q', 'origin', 'main') },
			{
				name: 'move upstream/main',
				weight: 1,
				run: f => {
					if (!f.upstream) return false;

					const target = pick(random, ['main', 'origin/main', 'task', 'task~1', 'origin/main~1', '']);
					if (!target) return tryGit(f.repo.path, 'update-ref', '-d', 'refs/remotes/upstream/main');

					return tryGit(f.repo.path, 'update-ref', 'refs/remotes/upstream/main', target);
				},
			},
		];
	}

	function pickMove(random: () => number, moves: readonly Move[]): Move {
		const total = moves.reduce((sum, m) => sum + m.weight, 0);
		let at = random() * total;
		for (const move of moves) {
			at -= move.weight;
			if (at < 0) return move;
		}
		return moves.at(-1)!;
	}

	/** Every ref's tip, by full name */
	function readTips(path: string): Map<string, string> {
		const tips = new Map<string, string>();
		for (const line of git(path, 'for-each-ref', '--format=%(refname) %(objectname)').split('\n')) {
			const [ref, sha] = line.split(' ');
			if (ref && sha) {
				tips.set(ref, sha);
			}
		}
		return tips;
	}

	/** Whether any of `dependsOn` has another tip in `after` than in `before`, one created or deleted included */
	function hasMoved(
		dependsOn: readonly string[],
		before: ReadonlyMap<string, string>,
		after: ReadonlyMap<string, string>,
	): boolean {
		return dependsOn.some(ref => before.get(ref) !== after.get(ref));
	}

	/**
	 * A full read during which `move` lands, as a summary's read can see it: the branch, and the ref list the base read
	 * takes, are read before the move, the rest after. Returns that read and the HEAD the summary would report with it;
	 * `undefined` when the move doesn't apply
	 */
	async function readDuring(
		path: string,
		move: () => boolean,
		validated: boolean,
	): Promise<{ readonly answer: AheadOfBase; readonly head: string } | undefined> {
		const provider = createProvider({ validateReads: validated });
		try {
			const head = git(path, 'rev-parse', 'HEAD');
			await provider.refs.getRefs(path);
			if (!move()) return undefined;

			return { answer: await provider.branches.getAheadOfBase(path, 'task'), head: head };
		} finally {
			provider.dispose();
		}
	}

	async function readFresh(path: string, validated: boolean): Promise<AheadOfBase> {
		const provider = createProvider({ validateReads: validated });
		try {
			return await provider.branches.getAheadOfBase(path, 'task');
		} finally {
			provider.dispose();
		}
	}

	type Tally = { answered: Map<string, number>; declined: Map<string, number> };

	function count(counts: Map<string, number>, move: string): void {
		counts.set(move, (counts.get(move) ?? 0) + 1);
	}

	/**
	 * One sequence. The shortcut goes through one provider kept for the whole sequence, as a summary's is, with its
	 * caches cleared after each move as the watcher would clear them
	 */
	async function runSequence(sequenceSeed: number, tally: Tally, validated: boolean): Promise<void> {
		const random = createRandom(sequenceSeed);
		const fixture = createFixture(random);
		const moves = createMoves(random);
		const log: string[] = [];
		const provider: CliGitProvider = createProvider({ validateReads: validated });
		try {
			const paths = [fixture.repo.path, fixture.task.path];
			for (const path of paths) {
				provider.cache.registerRepoPath(fileUri(path), await provider.config.getGitDir(path));
			}

			let previous = await readFresh(fixture.task.path, validated);
			let previousHead = git(fixture.task.path, 'rev-parse', 'HEAD');
			let tips = readTips(fixture.repo.path);
			for (let i = 0; i < movesPerSequence; i++) {
				const move = pickMove(random, moves);
				let applied: boolean;
				if (move.duringRead) {
					// The read the summary keeps, at the HEAD it reports, with the move pending for its next read
					const raced = await readDuring(fixture.task.path, () => move.run(fixture), validated);
					applied = raced != null;
					if (raced != null) {
						previous = raced.answer;
						previousHead = raced.head;
					}
				} else {
					applied = move.run(fixture);
				}
				log.push(applied ? move.name : `${move.name} (n/a)`);
				if (!applied) continue;

				for (const path of paths) {
					provider.cache.clearCaches(path);
				}

				const head = git(fixture.task.path, 'rev-parse', 'HEAD');
				const now = readTips(fixture.repo.path);
				const moved = hasMoved(previous.dependsOn, tips, now);
				tips = now;
				const fresh = await readFresh(fixture.task.path, validated);
				// As a summary does, the last read is kept while neither HEAD nor a ref it depends on moved, so a ref it
				// left out while absent can appear before the next commit
				if (head === previousHead) {
					if (moved || previous.base == null) {
						previous = fresh;
					}
					continue;
				}

				if (previous.base != null) {
					const answer = await provider.branches.getAheadOfBaseAfterCommit(
						fixture.task.path,
						'task',
						{
							head: previousHead,
							base: previous.base,
							dependsOn: previous.dependsOn,
							...(previous.defaultBranch !== undefined
								? { defaultBranch: previous.defaultBranch }
								: undefined),
							...(previous.measuredFrom !== undefined
								? { measuredFrom: previous.measuredFrom }
								: undefined),
						},
						head,
					);
					if (answer != null) {
						// A host that doesn't validate reads full answers from HEAD, which name no commit they were measured
						// from; the carried answer is measured from the new HEAD either way
						const { measuredFrom, ...carried } = answer;
						assert.strictEqual(measuredFrom, head, `after ${move.name}`);
						assert.deepStrictEqual(validated ? answer : carried, fresh, `after ${move.name}`);
						count(tally.answered, move.name);
					} else {
						count(tally.declined, move.name);
					}
				}
				previous = fresh;
				previousHead = head;
			}
		} catch (ex) {
			const message = ex instanceof Error ? ex.message : String(ex);
			throw new Error(`Sequence seed ${sequenceSeed} failed after: ${log.join(' → ')}\n${message}`, {
				cause: ex,
			});
		} finally {
			provider.dispose();
			disposeFixture(fixture);
		}
	}

	for (const validated of [true, false]) {
		test(`answers what a full read does after every move of the branch, reads ${validated ? 'validated' : 'not validated'} (seed ${seed}, ${sequences} sequences)`, async () => {
			const tally: Tally = { answered: new Map(), declined: new Map() };
			for (let i = 0; i < sequences; i++) {
				await runSequence(seed + i, tally, validated);
			}
			console.error(
				`[base commits] seed ${seed}, ${sequences} sequences, ${validated ? 'validated' : 'not validated'}: answered ${JSON.stringify([...tally.answered])}, declined ${JSON.stringify([...tally.declined])}`,
			);

			// A shortcut that never answers would pass the comparison, so plain commits must be answered
			assert.ok((tally.answered.get('commit on task') ?? 0) > 0, 'a plain commit was carried forward');
		});
	}
});
