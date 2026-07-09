import * as assert from 'assert';
import { PausedOperationContinueError } from '@gitlens/git/errors.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { AutoRebaseSession } from '../autoRebase.types.js';
import type { AutoRebaseLoopPorts } from '../autoRebaseCore.js';
import { runAutoRebaseLoop } from '../autoRebaseCore.js';
import type { Resolution, StepResult, UnmergedEntry } from '../types.js';

function makeStatus(
	step: number,
	total: number,
	options?: { isPaused?: boolean; type?: string },
): GitPausedOperationStatus {
	return {
		type: options?.type ?? 'rebase',
		repoPath: '/repo',
		HEAD: { ref: 'headsha' },
		current: undefined,
		incoming: { ref: 'incsha', name: 'feature' },
		mergeBase: 'base',
		onto: { ref: 'ontosha' },
		source: { ref: 'origsha' },
		steps: { current: { number: step, commit: { ref: `c${step}`, message: `msg${step}` } }, total: total },
		hasStarted: true,
		isPaused: options?.isPaused ?? true,
		isInteractive: false,
	} as unknown as GitPausedOperationStatus;
}

function makeSession(): AutoRebaseSession {
	return {
		id: 'session-1',
		repoPath: '/repo',
		mode: 'started',
		phase: 'starting',
		preRun: { branch: 'feature', headSha: 'origsha', stashCount: 0, startedAt: 0 },
		steps: [],
	};
}

function resolution(path: string, confidence = 0.9, strategy: Resolution['strategy'] = 'ai'): Resolution {
	return {
		filePath: path,
		content: `resolved:${path}`,
		strategy: strategy,
		confidence: confidence,
		description: 'why',
	};
}

/**
 * A tiny scriptable "repo": the loop's ports read/advance this state the way git would — a
 * successful continue advances the step (or finishes), the unmerged set belongs to the current
 * step, and reads reflect the current content.
 */
interface FakeRepo {
	step: number;
	total: number;
	done: boolean;
	/** Unmerged paths for the current step (keyed by step number) */
	unmergedByStep: Record<number, string[]>;
	applied: Resolution[][];
	staged: string[][];
	continues: { skip?: boolean }[];
}

function makeRepo(unmergedByStep: Record<number, string[]>, total?: number): FakeRepo {
	return {
		step: 1,
		total: total ?? Object.keys(unmergedByStep).length,
		done: false,
		unmergedByStep: unmergedByStep,
		applied: [],
		staged: [],
		continues: [],
	};
}

function makePorts(repo: FakeRepo, overrides?: Partial<AutoRebaseLoopPorts>): AutoRebaseLoopPorts {
	const unmerged = () => repo.unmergedByStep[repo.step] ?? [];
	return {
		getPausedOperationStatus: () => Promise.resolve(repo.done ? undefined : makeStatus(repo.step, repo.total)),
		listUnmergedEntries: () =>
			Promise.resolve(unmerged().map((p): UnmergedEntry => ({ path: p, reason: 'both-modified' }))),
		listUnmergedPaths: () => Promise.resolve(new Set(unmerged())),
		readWorkingFiles: paths => Promise.resolve(new Map(paths.map(p => [p, `conflicted:${p}`]))),
		resolveConflicts: args =>
			Promise.resolve({
				resolutions: args.entries.map(e => resolution(e.path)),
				errors: [],
				skipped: [],
			} satisfies StepResult),
		applyResolutions: resolutions => {
			repo.applied.push([...resolutions]);
			return Promise.resolve();
		},
		stageFiles: paths => {
			repo.staged.push(paths);
			return Promise.resolve();
		},
		hasStagedChanges: () => Promise.resolve(false),
		continueOperation: options => {
			repo.continues.push(options ?? {});
			if (repo.step < repo.total) {
				repo.step++;
			} else {
				repo.done = true;
			}
			return Promise.resolve();
		},
		getConfidenceThreshold: () => 0.8,
		delay: () => Promise.resolve(),
		...overrides,
	};
}

function run(session: AutoRebaseSession, ports: AutoRebaseLoopPorts, signal?: AbortSignal) {
	return runAutoRebaseLoop(session, ports, signal ?? new AbortController().signal, () => {});
}

suite('coretools/conflict/autoRebaseCore', () => {
	test('resolves, applies, stages, and continues each conflicted step to completion', async () => {
		const repo = makeRepo({ 1: ['a.txt'], 2: ['b.txt', 'c.txt'] });
		const session = makeSession();

		const result = await run(session, makePorts(repo));

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 2);
		assert.deepStrictEqual(
			session.steps.map(s => s.stepNumber),
			[1, 2],
		);
		assert.strictEqual(session.steps[1].files.length, 2);
		assert.strictEqual(session.steps[0].files[0].conflictedContent, 'conflicted:a.txt');
		assert.strictEqual(session.steps[0].files[0].resolvedContent, 'resolved:a.txt');
		assert.strictEqual(session.steps[0].commit.sha, 'c1');
		assert.strictEqual(session.steps[0].commit.message, 'msg1');
		assert.strictEqual(repo.applied.length, 2);
		assert.deepStrictEqual(repo.staged[1], ['b.txt', 'c.txt']);
		assert.strictEqual(repo.continues.length, 2);
	});

	test('threads previousResolutions across steps (bounded)', async () => {
		const repo = makeRepo({ 1: ['a.txt'], 2: ['b.txt'], 3: ['c.txt'] });
		const session = makeSession();
		const seen: (number | undefined)[] = [];

		const ports = makePorts(repo);
		const baseResolve = ports.resolveConflicts;
		ports.resolveConflicts = args => {
			seen.push(args.context.previousResolutions?.length);
			return baseResolve(args);
		};

		const result = await run(session, ports);

		assert.strictEqual(result.type, 'completed');
		assert.deepStrictEqual(seen, [undefined, 1, 2]);
	});

	test('escalates on low confidence without applying anything, handing off all resolutions', async () => {
		const repo = makeRepo({ 1: ['a.txt', 'b.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				resolveConflicts: () =>
					Promise.resolve({
						resolutions: [resolution('a.txt', 0.95), resolution('b.txt', 0.5)],
						errors: [],
						skipped: [],
					}),
			}),
		);

		assert.strictEqual(result.type, 'escalated');
		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'low-confidence');
		assert.strictEqual(result.type === 'escalated' && result.handoff?.resolutions.length, 2);
		assert.strictEqual(result.type === 'escalated' && result.handoff?.conflictedContents.size, 2);
		assert.strictEqual(repo.applied.length, 0);
		assert.strictEqual(repo.continues.length, 0);
		assert.strictEqual(session.steps.length, 0);
	});

	test('confidence exactly at the threshold passes; deterministic deleted resolutions are exempt', async () => {
		const repo = makeRepo({ 1: ['a.txt', 'gone.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				resolveConflicts: () =>
					Promise.resolve({
						resolutions: [resolution('a.txt', 0.8), resolution('gone.txt', 0, 'deleted')],
						errors: [],
						skipped: [],
					}),
			}),
		);

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(repo.applied.length, 1);
	});

	test('escalates on resolver errors and skipped (marker-less) files', async () => {
		for (const [field, reason] of [
			['errors', 'resolve-errors'],
			['skipped', 'skipped-files'],
		] as const) {
			const repo = makeRepo({ 1: ['a.txt'] });
			const session = makeSession();

			const result = await run(
				session,
				makePorts(repo, {
					resolveConflicts: () =>
						Promise.resolve({
							resolutions: [],
							errors: field === 'errors' ? [{ filePath: 'a.txt', error: new Error('nope') }] : [],
							skipped: field === 'skipped' ? [{ filePath: 'a.txt', reason: 'no-markers' }] : [],
						}),
				}),
			);

			assert.strictEqual(result.type === 'escalated' && result.escalation.reason, reason);
			assert.strictEqual(repo.applied.length, 0);
		}
	});

	test('escalates when a resolution has the skipped strategy (no markers resolved), applying nothing', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				// High confidence, but the AI resolved zero markers — applying it would stage the
				// still-marker-laden file and commit raw conflict markers.
				resolveConflicts: () =>
					Promise.resolve({
						resolutions: [resolution('a.txt', 0.95, 'skipped')],
						errors: [],
						skipped: [],
					}),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'skipped-files');
		assert.strictEqual(result.type === 'escalated' && result.handoff?.resolutions[0].strategy, 'skipped');
		assert.strictEqual(repo.applied.length, 0);
		assert.strictEqual(repo.staged.length, 0);
		assert.strictEqual(repo.continues.length, 0);
		assert.strictEqual(session.steps.length, 0);
	});

	test('escalates when a conflicted file changes externally while resolving', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		let reads = 0;
		const result = await run(
			session,
			makePorts(repo, {
				// First read = snapshot; second read (the recheck) sees different content
				readWorkingFiles: paths =>
					Promise.resolve(new Map(paths.map(p => [p, reads++ === 0 ? 'original' : 'tampered']))),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'external-modification');
		assert.strictEqual(repo.applied.length, 0);
	});

	test('escalates when a resolved file is no longer unmerged (resolved externally)', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				// Entries (from listUnmergedEntries) feed the resolve, but by the time the
				// post-resolve stale-guard lists unmerged paths the file was resolved externally
				listUnmergedPaths: () => Promise.resolve(new Set<string>()),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'external-modification');
		assert.strictEqual(repo.applied.length, 0);
	});

	test('escalates when the rebase advances externally while resolving', async () => {
		const repo = makeRepo({ 1: ['a.txt'], 2: ['a.txt'] }, 2);
		const session = makeSession();

		const ports = makePorts(repo);
		const baseResolve = ports.resolveConflicts;
		ports.resolveConflicts = args => {
			// Someone runs `git rebase --continue` in a terminal mid-resolve
			repo.step = 2;
			return baseResolve(args);
		};

		const result = await run(session, ports);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'external-modification');
		assert.strictEqual(repo.applied.length, 0);
	});

	test('escalates via stall detection when a continued step does not advance', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				// Continue "succeeds" but the repo never advances (msgnum stuck)
				continueOperation: () => Promise.resolve(),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'step-cap');
		// The first pass applied + recorded; the stalled second pass must not re-apply
		assert.strictEqual(repo.applied.length, 1);
	});

	test('escalates at the iteration cap when the conflict set keeps shifting', async () => {
		const repo = makeRepo({ 1: ['a.txt'] }, 1); // cap = 1 * 2 + 10 = 12
		const session = makeSession();

		let i = 0;
		const result = await run(
			session,
			makePorts(repo, {
				listUnmergedEntries: (): Promise<UnmergedEntry[]> =>
					Promise.resolve([{ path: `f${i}.txt`, reason: 'both-modified' }]),
				listUnmergedPaths: () => Promise.resolve(new Set([`f${i}.txt`])),
				// Each continue "succeeds" but the next iteration presents a different conflict
				// at the same step (a todo rewriting itself) — so the stall key never repeats
				// and only the absolute iteration cap can stop the loop
				continueOperation: () => {
					i++;
					return Promise.resolve();
				},
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'step-cap');
	});

	test('auto-skips a step whose resolution made the commit empty', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		let attempts = 0;
		const result = await run(
			session,
			makePorts(repo, {
				continueOperation: options => {
					attempts++;
					if (attempts === 1 && options?.skip !== true) {
						throw new PausedOperationContinueError({
							reason: 'emptyCommit',
							operation: makeStatus(1, 1),
							skip: false,
							gitCommand: { repoPath: '/repo', args: ['rebase', '--continue'] },
						});
					}

					repo.done = true;
					return Promise.resolve();
				},
			}),
		);

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 1);
		assert.strictEqual(session.steps[0].kind, 'empty-skipped');
		assert.strictEqual(attempts, 2);
	});

	test('keeps going when a continue "fails" because a LATER step conflicted (real git behavior)', async () => {
		// `git rebase --continue` continues the whole rebase — when a later step conflicts, the
		// continue itself exits with a conflict error even though the current step committed fine
		const repo = makeRepo({ 1: ['a.txt'], 3: ['a.txt'] }, 3);
		const session = makeSession();

		const ports = makePorts(repo);
		ports.continueOperation = () => {
			repo.continues.push({});
			if (repo.step === 1) {
				// Step 1 commits, step 2 applies cleanly, step 3 conflicts — continue throws
				repo.step = 3;
				throw new PausedOperationContinueError({
					reason: 'conflicts',
					operation: makeStatus(3, 3),
					skip: false,
					gitCommand: { repoPath: '/repo', args: ['rebase', '--continue'] },
				});
			}
			repo.done = true;
			return Promise.resolve();
		};

		const result = await run(session, ports);

		assert.strictEqual(result.type, 'completed');
		assert.deepStrictEqual(
			session.steps.map(s => s.stepNumber),
			[1, 3],
		);
		assert.strictEqual(repo.applied.length, 2);
	});

	test('a continue conflict that made NO progress trips the stall detector', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				continueOperation: () => {
					// Same step, same conflict set re-surfaces — a genuine external race
					throw new PausedOperationContinueError({
						reason: 'conflicts',
						operation: makeStatus(1, 1),
						skip: false,
						gitCommand: { repoPath: '/repo', args: ['rebase', '--continue'] },
					});
				},
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'step-cap');
		// Only the first pass applied — the stalled retry must not re-apply
		assert.strictEqual(repo.applied.length, 1);
	});

	test('escalates other continue failures as continue-error', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				continueOperation: () => {
					throw new PausedOperationContinueError({
						reason: 'uncommittedChanges',
						operation: makeStatus(1, 1),
						skip: false,
						gitCommand: { repoPath: '/repo', args: ['rebase', '--continue'] },
					});
				},
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'continue-error');
	});

	test('escalates a paused rebase with no conflicts and nothing staged (edit/break stop)', async () => {
		const repo = makeRepo({ 1: [] }, 1);
		const session = makeSession();

		const result = await run(session, makePorts(repo));

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'non-conflict-pause');
	});

	test('continues a takeover that starts on a step already resolved and staged externally', async () => {
		// After an escalation the user applies via the Resolve panel (everything staged) and then
		// re-engages automation — the paused step has no conflicts but IS ready to continue
		const repo = makeRepo({ 2: ['a.txt'] }, 2);
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				hasStagedChanges: () => Promise.resolve(repo.step === 1),
			}),
		);

		assert.strictEqual(result.type, 'completed');
		// The staged step 1 was continued (not recorded); the step-2 conflict was resolved + recorded
		assert.deepStrictEqual(
			session.steps.map(s => s.stepNumber),
			[2],
		);
		assert.strictEqual(repo.continues.length, 2);
		assert.strictEqual(repo.applied.length, 1);
	});

	test('escalates when a different operation type is in progress', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				getPausedOperationStatus: () => Promise.resolve(makeStatus(1, 1, { type: 'merge' })),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'non-conflict-pause');
	});

	test('retries once through a transient not-paused window', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();
		let delays = 0;

		let statusCalls = 0;
		const result = await run(
			session,
			makePorts(repo, {
				getPausedOperationStatus: () => {
					statusCalls++;
					if (repo.done) return Promise.resolve(undefined);
					// The very first read lands in the transient window right after a continue
					return Promise.resolve(makeStatus(repo.step, repo.total, { isPaused: statusCalls > 1 }));
				},
				delay: () => {
					delays++;
					return Promise.resolve();
				},
			}),
		);

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(delays, 1);
	});

	test('returns cancelled without applying when aborted mid-resolve', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();
		const controller = new AbortController();

		const ports = makePorts(repo);
		const baseResolve = ports.resolveConflicts;
		ports.resolveConflicts = args => {
			controller.abort();
			return baseResolve(args);
		};

		const result = await run(session, ports, controller.signal);

		assert.strictEqual(result.type, 'cancelled');
		assert.strictEqual(repo.applied.length, 0);
	});

	test('returns cancelled immediately when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		const result = await run(makeSession(), makePorts(makeRepo({ 1: ['a.txt'] })), controller.signal);

		assert.strictEqual(result.type, 'cancelled');
	});

	test('completes (not cancelled) when cancellation lands after the final continue', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();
		const controller = new AbortController();

		const ports = makePorts(repo);
		const baseContinue = ports.continueOperation;
		ports.continueOperation = options => {
			const result = baseContinue(options);
			// The last continue just finished the rebase (repo.done) — a cancel landing now must not
			// turn a completed run into a spurious cancellation.
			if (repo.done) {
				controller.abort();
			}
			return result;
		};

		const result = await run(session, ports, controller.signal);

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 1);
	});

	test('completes immediately when no paused operation exists', async () => {
		const repo = makeRepo({});
		repo.done = true;
		const session = makeSession();

		const result = await run(session, makePorts(repo));

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 0);
	});
});
