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
 * Random moves of local `main`, `origin/main` and the task branch, from a printed seed, each followed by the base
 * re-measure with the refs that moved and a fresh full read: whenever the re-measure answers, the two must be equal.
 * `BASE_MOVES_SEED` and `BASE_MOVES_SEQUENCES` replay or widen a run.
 */
suite('Re-measuring a base after random moves of its refs', function () {
	const seed = Number(process.env.BASE_MOVES_SEED ?? 20261112);
	const sequences = Number(process.env.BASE_MOVES_SEQUENCES ?? 3);
	const movesPerSequence = 10;

	this.timeout(Math.max(60000, sequences * 10000));

	function git(cwd: string, ...args: string[]): string {
		return execFileSync('git', args, { cwd: cwd, encoding: 'utf-8', stdio: 'pipe' }).trim();
	}

	/** Whether the git command ran; a move it can't make (a fast-forward of diverged branches, say) doesn't apply */
	function tryGit(cwd: string, ...args: string[]): boolean {
		try {
			git(cwd, ...args);
			return true;
		} catch {
			return false;
		}
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
		readonly origin: string;
		readonly repo: TestRepo;
		readonly peer: TestRepo;
		readonly task: { path: string; cleanup: () => void };
		readonly upstream: boolean;
		next: number;
	};

	function createFixture(random: () => number): Fixture {
		const root = mkdtempSync(join(tmpdir(), 'gitlens-base-moves-'));
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

		git(repo.path, 'branch', '--no-track', 'task', 'origin/main');
		const task = createWorktree(repo.path, 'task');
		for (let i = 0; i < 1 + Math.floor(random() * 2); i++) {
			addCommit(task.path, `task-setup-${i}.txt`, `${i}`, `Task setup ${i}`);
		}
		return { root: root, origin: origin, repo: repo, peer: peer, task: task, upstream: upstream, next: 0 };
	}

	function disposeFixture(fixture: Fixture): void {
		fixture.task.cleanup();
		fixture.peer.cleanup();
		fixture.repo.cleanup();
		rmSync(fixture.root, { recursive: true, force: true });
	}

	type Move = { readonly name: string; readonly weight: number; readonly run: (f: Fixture) => boolean };

	function pick<T>(random: () => number, items: readonly T[]): T {
		return items[Math.floor(random() * items.length)];
	}

	function createMoves(random: () => number): readonly Move[] {
		const name = (f: Fixture, prefix: string) => `${prefix}-${f.next++}`;
		return [
			{
				name: 'peer pushes',
				weight: 3,
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
				name: 'pull',
				weight: 3,
				run: f =>
					tryGit(f.repo.path, '-c', 'pull.ff=true', '-c', 'pull.rebase=false', 'pull', '-q', '--no-edit'),
			},
			{
				name: 'fast-forward main to origin/main',
				weight: 3,
				run: f => tryGit(f.repo.path, 'merge', '-q', '--ff-only', 'origin/main'),
			},
			{
				name: 'commit on main',
				weight: 3,
				run: f => {
					const file = name(f, 'main');
					addCommit(f.repo.path, `${file}.txt`, file, file);
					return true;
				},
			},
			{
				name: 'reset main back',
				weight: 2,
				run: f => tryGit(f.repo.path, 'reset', '-q', '--hard', `HEAD~${1 + Math.floor(random() * 2)}`),
			},
			{
				name: 'reset main to origin/main',
				weight: 1,
				run: f => tryGit(f.repo.path, 'reset', '-q', '--hard', 'origin/main'),
			},
			{
				name: 'merge task into main',
				weight: 1,
				run: f => tryGit(f.repo.path, 'merge', '-q', '--no-ff', '--no-edit', 'task'),
			},
			{
				name: 'fast-forward main onto a task commit',
				weight: 1,
				run: f => tryGit(f.repo.path, 'merge', '-q', '--ff-only', `task~${Math.floor(random() * 2)}`),
			},
			{ name: 'push main', weight: 2, run: f => tryGit(f.repo.path, 'push', '-q', 'origin', 'main') },
			{
				name: 'force-push main',
				weight: 1,
				run: f => tryGit(f.repo.path, 'push', '-q', '--force', 'origin', 'main'),
			},
			{
				name: 'move upstream/main',
				weight: 2,
				run: f => {
					if (!f.upstream) return false;

					const target = pick(random, ['main', 'origin/main', 'task', 'main~1', 'origin/main~1', '']);
					if (!target) return tryGit(f.repo.path, 'update-ref', '-d', 'refs/remotes/upstream/main');

					return tryGit(f.repo.path, 'update-ref', 'refs/remotes/upstream/main', target);
				},
			},
			{
				name: 'commit on task',
				weight: 1,
				run: f => {
					const file = name(f, 'task');
					addCommit(f.task.path, `${file}.txt`, file, file);
					return true;
				},
			},
			{
				name: 'merge origin/main into task',
				weight: 1,
				run: f => tryGit(f.task.path, 'merge', '-q', '--no-ff', '--no-edit', 'origin/main'),
			},
			{
				name: 'merge main into task',
				weight: 1,
				run: f => tryGit(f.task.path, 'merge', '-q', '--no-ff', '--no-edit', 'main'),
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

	/** The refs of `dependsOn` whose tips differ between `before` and `after`, a ref created or deleted among them */
	function getMoved(
		dependsOn: readonly string[],
		before: ReadonlyMap<string, string>,
		after: ReadonlyMap<string, string>,
	): string[] {
		return dependsOn.filter(ref => before.get(ref) !== after.get(ref));
	}

	async function readFresh(path: string, validated: boolean): Promise<AheadOfBase> {
		const provider = createProvider({ validateReads: validated });
		try {
			return await provider.branches.getAheadOfBase(path, 'task');
		} finally {
			provider.dispose();
		}
	}

	type Tally = { kept: number; answered: Map<string, number>; declined: Map<string, number> };

	function count(counts: Map<string, number>, shape: string): void {
		counts.set(shape, (counts.get(shape) ?? 0) + 1);
	}

	/**
	 * One sequence. The re-measures go through one provider kept for the whole sequence, as a summary's is, with its
	 * caches cleared after each move as the watcher would clear them, so what it shares across moves is exercised
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
			let tips = readTips(fixture.repo.path);
			for (let i = 0; i < movesPerSequence; i++) {
				const move = pickMove(random, moves);
				const applied = move.run(fixture);
				log.push(applied ? move.name : `${move.name} (n/a)`);
				if (!applied) continue;

				const now = readTips(fixture.repo.path);
				const moved = getMoved(previous.dependsOn, tips, now);
				const headMoved = tips.get('refs/heads/task') !== now.get('refs/heads/task');
				tips = now;
				for (const path of paths) {
					provider.cache.clearCaches(path);
				}

				// A HEAD that moved is read in full, as is a base whose refs didn't move but whose inputs did (a ref it
				// left out while absent); neither is the re-measure's to answer
				if (headMoved || !moved.length || previous.base == null) {
					previous = await readFresh(fixture.task.path, validated);
					continue;
				}

				const shape = moved.includes('refs/heads/main')
					? moved.includes('refs/remotes/origin/main')
						? 'main and origin/main'
						: 'main'
					: 'other';
				const answer = await provider.branches.getAheadOfBaseAfterBaseMove(
					fixture.task.path,
					'task',
					{
						head: git(fixture.task.path, 'rev-parse', 'HEAD'),
						base: previous.base,
						dependsOn: previous.dependsOn,
						...(previous.defaultBranch !== undefined
							? { defaultBranch: previous.defaultBranch }
							: undefined),
						...(previous.measuredFrom !== undefined ? { measuredFrom: previous.measuredFrom } : undefined),
					},
					moved,
				);
				const fresh = await readFresh(fixture.task.path, validated);
				if (answer != null) {
					assert.deepStrictEqual(answer, fresh, `moved ${moved.join(', ')}`);
					count(tally.answered, shape);
					if (answer.base?.sha === previous.base.sha) {
						tally.kept++;
					}
				} else {
					count(tally.declined, shape);
				}
				previous = fresh;
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
		test(`answers what a full read does after every move, reads ${validated ? 'validated' : 'not validated'} (seed ${seed}, ${sequences} sequences)`, async () => {
			const tally: Tally = { kept: 0, answered: new Map(), declined: new Map() };
			for (let i = 0; i < sequences; i++) {
				await runSequence(seed + i, tally, validated);
			}
			console.error(
				`[base moves] seed ${seed}, ${sequences} sequences, ${validated ? 'validated' : 'not validated'}: answered ${JSON.stringify([...tally.answered])}, declined ${JSON.stringify([...tally.declined])}, kept unchanged ${tally.kept}`,
			);

			// A re-measure that never answers would pass the comparison, so moves of local main alone must be answered
			assert.ok((tally.answered.get('main') ?? 0) > 0, 'a move of local main alone was re-measured');
		});
	}
});
