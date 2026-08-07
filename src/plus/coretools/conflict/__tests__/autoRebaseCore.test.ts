import * as assert from 'assert';
import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
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
		willCommitBeEmpty: () => Promise.resolve(false),
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
		getCustomInstructions: () => undefined,
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

	// Feature under test (#5581): the resolver consults the repository (grep/show/blame) when a hunk alone
	// is ambiguous, and each consultation updates the run's progress line — step-scoped, so a long step
	// doesn't look stalled. Captured inside `onProgress` because the loop overwrites `progressMessage` with
	// 'Continuing…' as soon as the step is applied.
	test('reports a resolver tool call as step-scoped inspecting progress', async () => {
		const repo = makeRepo({ 1: ['service.py'], 2: ['b.txt'], 3: ['c.txt'] });
		const session = makeSession();
		let toolCallMessage: string | undefined;

		const ports = makePorts(repo);
		const baseResolve = ports.resolveConflicts;
		ports.resolveConflicts = args => {
			if (repo.step === 1) {
				args.onProgress({
					type: 'resolver:tool-call',
					filePath: 'service.py',
					tool: 'grep',
					args: {},
					stepNumber: 1,
					reason: 'is the renamed symbol still referenced?',
				});
				toolCallMessage = session.progressMessage;
			}
			return baseResolve(args);
		};

		const result = await run(session, ports);

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(toolCallMessage, 'Step 1/3 · Inspecting grep for service.py…');
		// The progress line is overwritten within milliseconds, so the step record is where the evidence
		// has to survive — it's what the summary sheet reads to cite what AI looked at.
		assert.deepStrictEqual(session.steps[0].files.find(f => f.path === 'service.py')?.consulted, [
			{ tool: 'grep', reason: 'is the renamed symbol still referenced?' },
		]);
	});

	test('passes the standing custom instructions to every step it resolves', async () => {
		// A preference like "prefer the incoming side for lockfiles" has to govern conflicts an automatic
		// rebase resolves too, not just the ones resolved by hand in the panel — the run never gets a
		// chance to type guidance.
		const repo = makeRepo({ 1: ['a.txt'], 2: ['b.txt'] });
		const session = makeSession();
		const seen: (string | undefined)[] = [];

		const ports = makePorts(repo, { getCustomInstructions: () => 'prefer the incoming side for lockfiles' });
		const baseResolve = ports.resolveConflicts;
		ports.resolveConflicts = args => {
			seen.push(args.context.userGuidance);
			return baseResolve(args);
		};

		const result = await run(session, ports);

		assert.strictEqual(result.type, 'completed');
		assert.deepStrictEqual(seen, [
			'prefer the incoming side for lockfiles',
			'prefer the incoming side for lockfiles',
		]);
	});

	test('omits userGuidance entirely when no instructions are configured', () => {
		// `userGuidance` renders as a `<user-guidance>` block in the prompt, so an empty one would tell
		// the model the user said something when they didn't.
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();
		const ports = makePorts(repo);
		const baseResolve = ports.resolveConflicts;
		let context: { userGuidance?: string } | undefined;
		ports.resolveConflicts = args => {
			context = args.context;
			return baseResolve(args);
		};

		return run(session, ports).then(() => {
			assert.strictEqual(context != null && 'userGuidance' in context, false);
		});
	});

	test('escalates as ai-unavailable when AI runs out mid-run, not as a per-file failure', async () => {
		// Out of credits isn't a file that resisted resolution — every remaining step would fail the same
		// way. Reporting it as `resolve-errors` ("The AI couldn't resolve service.py") blames the file and
		// sends the user to look at the wrong thing, so the reason and message have to name the real cause.
		const repo = makeRepo({ 1: ['service.py'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				resolveConflicts: () =>
					Promise.resolve({
						resolutions: [],
						errors: [
							{
								filePath: 'service.py',
								error: new AIError(AIErrorReason.UserQuotaExceeded),
							},
						],
						skipped: [],
					}),
			}),
		);

		assert.strictEqual(result.type, 'escalated');
		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'ai-unavailable');
		assert.strictEqual(
			result.type === 'escalated' && /token limit/i.test(result.escalation.message),
			true,
			'the message must carry the real cause, not the file name',
		);
		// Nothing written, and the rebase is left paused for the user — not aborted over a billing state.
		assert.strictEqual(repo.applied.length, 0);
		assert.strictEqual(repo.continues.length, 0);
	});

	test('still escalates a genuine per-file failure as resolve-errors', async () => {
		// `RequestTooLarge` is a property of the one request, so a different file may well succeed —
		// it must not be swept into the run-level classification above.
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(
			session,
			makePorts(repo, {
				resolveConflicts: () =>
					Promise.resolve({
						resolutions: [],
						errors: [{ filePath: 'a.txt', error: new AIError(AIErrorReason.RequestTooLarge) }],
						skipped: [],
					}),
			}),
		);

		assert.strictEqual(result.type === 'escalated' && result.escalation.reason, 'resolve-errors');
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

	test('resuming records the human-resolved escalated step, then continues with AI', async () => {
		// Step 1 was escalated + resolved by the user (staged, no unmerged); step 2 conflicts and is
		// AI-resolved on resume. The manual step must land in the summary with before/after content.
		const repo = makeRepo({ 2: ['b.txt'] }, 2);
		const session = makeSession();

		const ports = makePorts(repo, {
			// Step 1 is staged (the human's resolution); step 2 isn't.
			hasStagedChanges: () => Promise.resolve(repo.step === 1),
			readWorkingFiles: paths => Promise.resolve(new Map(paths.map(p => [p, `after:${p}`]))),
		});

		const result = await runAutoRebaseLoop(session, ports, new AbortController().signal, () => {}, {
			escalatedStep: {
				stepNumber: 1,
				conflictedContents: new Map([['x.txt', 'before:x.txt']]),
				resolutions: [{ filePath: 'x.txt', strategy: 'take-ours', description: 'kept ours' }],
			},
		});

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 2);

		const manual = session.steps[0];
		assert.strictEqual(manual.kind, 'manual');
		assert.strictEqual(manual.stepNumber, 1);
		assert.strictEqual(manual.commit.sha, 'c1');
		assert.strictEqual(manual.files.length, 1);
		assert.strictEqual(manual.files[0].path, 'x.txt');
		assert.strictEqual(manual.files[0].conflictedContent, 'before:x.txt');
		assert.strictEqual(manual.files[0].resolvedContent, 'after:x.txt');
		assert.strictEqual(manual.files[0].note, 'Resolved manually');

		assert.strictEqual(session.steps[1].kind, 'conflicts');
		assert.strictEqual(session.steps[1].stepNumber, 2);
	});

	test('resume without an escalated-step snapshot just continues (no synthetic step)', async () => {
		// A non-handoff escalation (or a takeover of an external rebase): step 1 is staged/resolved
		// with no snapshot, so nothing is recorded for it — only the AI-resolved step 2.
		const repo = makeRepo({ 2: ['b.txt'] }, 2);
		const session = makeSession();
		const ports = makePorts(repo, { hasStagedChanges: () => Promise.resolve(repo.step === 1) });

		const result = await runAutoRebaseLoop(session, ports, new AbortController().signal, () => {}, {});

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 1);
		assert.strictEqual(session.steps[0].stepNumber, 2);
	});

	test('resuming continues an escalated step resolved to a HEAD-matching (unstaged) result', async () => {
		// The escalated step (1) was resolved so its result matches HEAD (e.g. "stage current" on a
		// both-modified binary), leaving NOTHING staged. The loop must still continue it — no unmerged
		// entries means it's resolved — rather than escalating 'non-conflict-pause'.
		const repo = makeRepo({ 2: ['b.txt'] }, 2);
		const session = makeSession();
		const ports = makePorts(repo, { hasStagedChanges: () => Promise.resolve(false) });

		const result = await runAutoRebaseLoop(session, ports, new AbortController().signal, () => {}, {
			escalatedStep: {
				stepNumber: 1,
				conflictedContents: new Map([['icon.bin', 'before']]),
				resolutions: [{ filePath: 'icon.bin', strategy: 'take-ours', description: 'kept ours' }],
			},
		});

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 2);
		assert.strictEqual(session.steps[0].kind, 'manual');
		assert.strictEqual(session.steps[0].stepNumber, 1);
		assert.strictEqual(session.steps[1].stepNumber, 2);
		assert.strictEqual(repo.continues.length, 2);
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

	test('records a dropped commit when git empties it silently and exits 0 (real git behavior)', async () => {
		// A rebase `--continue` whose index matches HEAD drops the commit and reports success — no
		// `emptyCommit` error is ever raised, so the emptiness has to be detected before continuing.
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(session, makePorts(repo, { willCommitBeEmpty: () => Promise.resolve(true) }));

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps.length, 1);
		assert.strictEqual(session.steps[0].kind, 'empty-skipped');
		// Plain `--continue`, never `--skip`: a mis-detection must not discard real staged content.
		assert.deepStrictEqual(repo.continues, [{}]);
	});

	test('records a dropped commit even when the continue reports a LATER step conflict', async () => {
		// One `--continue` drives the whole rebase: this step's commit can be dropped as empty and the
		// command still exit non-zero for a later step's conflict. The drop must not go unrecorded.
		const repo = makeRepo({ 1: ['a.txt'], 3: ['a.txt'] }, 3);
		const session = makeSession();

		const ports = makePorts(repo, { willCommitBeEmpty: () => Promise.resolve(repo.step === 1) });
		ports.continueOperation = () => {
			repo.continues.push({});
			if (repo.step === 1) {
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
		assert.strictEqual(session.steps[0].kind, 'empty-skipped');
	});

	test('leaves a non-empty step recorded as resolved', async () => {
		const repo = makeRepo({ 1: ['a.txt'] });
		const session = makeSession();

		const result = await run(session, makePorts(repo, { willCommitBeEmpty: () => Promise.resolve(false) }));

		assert.strictEqual(result.type, 'completed');
		assert.strictEqual(session.steps[0].kind, 'conflicts');
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
