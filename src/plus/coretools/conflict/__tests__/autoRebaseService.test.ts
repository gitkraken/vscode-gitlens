import * as assert from 'assert';
import { CancellationTokenSource } from 'vscode';
import { PausedOperationAbortError } from '@gitlens/git/errors.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { StoredAutoRebaseUndo } from '../../../../constants.storage.js';
import type { Container } from '../../../../container.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import type { AutoRebaseSession } from '../autoRebase.types.js';
import { AutoRebaseService } from '../autoRebaseService.js';

interface FakeRepoState {
	pausedOp?: GitPausedOperationStatus;
	branch: string;
	headSha: string;
	hasChanges: boolean;
	resets: string[];
	stashSaves: number;
	stashPops: number;
	popConflicts?: boolean;
}

function makeFakes(record: StoredAutoRebaseUndo | undefined, repo: Partial<FakeRepoState> = {}) {
	const state: FakeRepoState = {
		branch: 'feature',
		headSha: 'post',
		hasChanges: false,
		resets: [],
		stashSaves: 0,
		stashPops: 0,
		...repo,
	};

	const storage = new Map<string, unknown>();
	if (record != null) {
		storage.set('autoRebase:undo:/repo', { v: 1, data: record });
	}

	const svc = {
		path: '/repo',
		pausedOps: { getPausedOperationStatus: () => Promise.resolve(state.pausedOp) },
		branches: { getBranch: () => Promise.resolve({ name: state.branch }) },
		revision: { resolveRevision: () => Promise.resolve({ sha: state.headSha, revision: state.headSha }) },
		status: { getStatus: () => Promise.resolve({ hasChanges: state.hasChanges }) },
		ops: {
			reset: (rev: string) => {
				state.resets.push(rev);
				// A hard reset restores the recorded pre-rebase state
				state.headSha = rev;
				state.hasChanges = false;
				return Promise.resolve();
			},
		},
		stash: {
			saveStash: () => {
				state.stashSaves++;
				state.hasChanges = false;
				return Promise.resolve();
			},
			applyStash: () => {
				state.stashPops++;
				return Promise.resolve({ conflicted: state.popConflicts ?? false });
			},
		},
	};

	const container = {
		storage: {
			getWorkspace: (key: string) => storage.get(key),
			storeWorkspace: (key: string, value: unknown) => {
				storage.set(key, value);
				return Promise.resolve();
			},
			deleteWorkspace: (key: string) => {
				storage.delete(key);
				return Promise.resolve();
			},
		},
		git: { getRepositoryService: () => svc },
		operationOrigins: { markAdopted: () => {} },
		telemetry: { sendEvent: () => {} },
		ai: {
			enabled: true,
			allowed: true,
			flushBYOKUsage: () => Promise.resolve(),
			getModel: () => Promise.resolve({ id: 'test-model', provider: { id: 'test' } }),
		},
	} as unknown as Container;

	return { service: new AutoRebaseService(container), state: state, storage: storage };
}

const record: StoredAutoRebaseUndo = {
	branch: 'feature',
	preRebaseSha: 'pre',
	postRebaseSha: 'post',
	autostash: 'none',
};

suite('coretools/conflict/AutoRebaseService undo', () => {
	test('refuses when there is no undo record', async () => {
		const { service } = makeFakes(undefined);
		const result = await service.undo('/repo');
		assert.strictEqual(result.ok, false);
		assert.strictEqual(!result.ok && result.reason, 'no-record');
	});

	test('refuses while another operation is in progress', async () => {
		const { service, state } = makeFakes(record, {
			pausedOp: { type: 'merge' } as unknown as GitPausedOperationStatus,
		});
		const result = await service.undo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'operation-in-progress');
		assert.strictEqual(state.resets.length, 0);
	});

	test('refuses when a different branch is checked out', async () => {
		const { service, state } = makeFakes(record, { branch: 'other' });
		const result = await service.undo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'branch-changed');
		assert.strictEqual(state.resets.length, 0);
	});

	test('refuses when the branch tip has moved since the rebase completed', async () => {
		const { service, state } = makeFakes(record, { headSha: 'moved' });
		const result = await service.undo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'branch-moved');
		assert.strictEqual(state.resets.length, 0);
	});

	test('refuses a dirty working tree when the run had no autostash involvement', async () => {
		const { service, state } = makeFakes(record, { hasChanges: true });
		const result = await service.undo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(state.resets.length, 0);
	});

	test('resets to the pre-rebase tip and clears the record on the happy path', async () => {
		const { service, state, storage } = makeFakes(record);
		const result = await service.undo('/repo');
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.ok && result.restoredTo, 'pre');
		assert.deepStrictEqual(state.resets, ['pre']);
		assert.strictEqual(storage.size, 0);
	});

	test('a reapplied autostash defaults to a stash → reset → pop cycle', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'reapplied' }, { hasChanges: true });
		const result = await service.undo('/repo');
		assert.strictEqual(result.ok, true);
		assert.strictEqual(state.stashSaves, 1);
		assert.deepStrictEqual(state.resets, ['pre']);
		assert.strictEqual(state.stashPops, 1);
		assert.strictEqual(result.ok && result.warning, undefined);
	});

	test('a conflicting re-pop leaves the stash entry and reports it', async () => {
		const { service } = makeFakes({ ...record, autostash: 'reapplied' }, { hasChanges: true, popConflicts: true });
		const result = await service.undo('/repo');
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.ok && result.warning, 'changes-left-in-stash');
	});

	test('a conflicted autostash application defaults to stash without re-applying (manual fixes preserved)', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'left-in-stash' }, { hasChanges: true });
		const result = await service.undo('/repo');
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.ok && result.warning, 'changes-left-in-stash');
		// Stashed verbatim (the tree could hold manual fixes) but never popped back — its diff is
		// relative to the post-rebase tip, so a pop onto the pre-rebase tip would re-conflict.
		assert.strictEqual(state.stashSaves, 1);
		assert.strictEqual(state.stashPops, 0);
		assert.deepStrictEqual(state.resets, ['pre']);
	});

	test('an explicit ifDirty discard is still honored for a conflicted autostash application', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'left-in-stash' }, { hasChanges: true });
		const result = await service.undo('/repo', { ifDirty: 'discard' });
		assert.strictEqual(result.ok, true);
		assert.strictEqual(result.ok && result.warning, 'changes-left-in-stash');
		assert.strictEqual(state.stashSaves, 0);
		assert.deepStrictEqual(state.resets, ['pre']);
	});

	test('an explicit ifDirty refuse overrides the autostash default', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'reapplied' }, { hasChanges: true });
		const result = await service.undo('/repo', { ifDirty: 'refuse' });
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(state.resets.length, 0);
	});

	test('discard is never honored unless the dirtiness is a conflicted autostash application', async () => {
		const { service, state } = makeFakes(record, { hasChanges: true });
		const result = await service.undo('/repo', { ifDirty: 'discard' });
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(state.resets.length, 0);
	});

	test('canUndo validates without mutating anything', async () => {
		const { service, state, storage } = makeFakes(record);
		const result = await service.canUndo('/repo');
		assert.strictEqual(result.ok, true);
		assert.strictEqual(state.resets.length, 0);
		assert.strictEqual(storage.size, 1);
	});

	test('canUndo flags a reapplied-autostash dirty tree as recoverable (undo would stash)', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'reapplied' }, { hasChanges: true });
		const result = await service.canUndo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(!result.ok && result.recoverable, true);
		assert.strictEqual(state.resets.length, 0);
	});

	test('canUndo flags a left-in-stash-autostash dirty tree as recoverable (undo would stash)', async () => {
		const { service, state } = makeFakes({ ...record, autostash: 'left-in-stash' }, { hasChanges: true });
		const result = await service.canUndo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(!result.ok && result.recoverable, true);
		assert.strictEqual(state.resets.length, 0);
	});

	test('canUndo reports a genuine-dirty tree (no autostash) as not recoverable', async () => {
		const { service, state } = makeFakes(record, { hasChanges: true });
		const result = await service.canUndo('/repo');
		assert.strictEqual(!result.ok && result.reason, 'dirty');
		assert.strictEqual(!result.ok && result.recoverable, false);
		assert.strictEqual(state.resets.length, 0);
	});
});

function makePausedRebaseStatus(): GitPausedOperationStatus {
	return {
		type: 'rebase',
		repoPath: '/repo',
		incoming: { ref: 'incsha', name: 'feature' },
		source: { ref: 'orig' },
		steps: { current: { number: 1, commit: { ref: 'c1' } }, total: 1 },
		isPaused: true,
	} as unknown as GitPausedOperationStatus;
}

/**
 * Harness for the takeover loop: the loop's first status read cancels the session (simulating a
 * cancel that races the run finishing), and `abortPausedOperation` then reports `nothingToAbort` —
 * the rebase already ended. Whether that resolves to `completed` or `aborted` turns on HEAD.
 */
function makeTakeoverFakes(headSha: string) {
	const state = { headSha: headSha, resets: [] as string[], statusReads: 0 };
	const storage = new Map<string, unknown>();

	let service!: AutoRebaseService;
	const status = makePausedRebaseStatus();

	const svc = {
		path: '/repo',
		pausedOps: {
			getPausedOperationStatus: () => {
				state.statusReads++;
				// 1st read: takeover's pre-flight. 2nd read: the loop's first tick — cancel here so
				// the abort signal is set before the loop consults it, then hand back a live status.
				if (state.statusReads === 2) {
					service.cancel('/repo');
				}
				return Promise.resolve(status);
			},
			abortPausedOperation: () =>
				Promise.reject(new PausedOperationAbortError({ reason: 'nothingToAbort', operation: status })),
			continuePausedOperation: () => Promise.resolve(),
		},
		branches: { getBranch: () => Promise.resolve({ name: 'feature' }) },
		revision: { resolveRevision: () => Promise.resolve({ sha: state.headSha, revision: state.headSha }) },
		status: { getStatus: () => Promise.resolve({ hasChanges: false, files: [] }) },
		ops: {
			reset: (rev: string) => {
				state.resets.push(rev);
				return Promise.resolve();
			},
		},
		staging: { stageFiles: () => Promise.resolve() },
		createUnsafeGit: () => undefined,
	};

	const container = {
		storage: {
			getWorkspace: (key: string) => storage.get(key),
			storeWorkspace: (key: string, value: unknown) => {
				storage.set(key, value);
				return Promise.resolve();
			},
			deleteWorkspace: (key: string) => {
				storage.delete(key);
				return Promise.resolve();
			},
		},
		git: { getRepositoryService: () => svc },
		operationOrigins: { markAdopted: () => {} },
		telemetry: { sendEvent: () => {} },
		ai: {
			enabled: true,
			allowed: true,
			flushBYOKUsage: () => Promise.resolve(),
			getModel: () => Promise.resolve({ id: 'test-model', provider: { id: 'test' } }),
		},
	} as unknown as Container;

	service = new AutoRebaseService(container);
	// Stub the lazily node-imported integration — the loop cancels before it's ever used.
	(service as unknown as { _integration: Promise<unknown> })._integration = Promise.resolve({});

	return { service: service, state: state, storage: storage, svc: svc as unknown as GitRepositoryService };
}

/**
 * Harness for resuming our own escalated run: the loop finds the rebase paused with nothing
 * conflicted and the escalated step's snapshot matching it, so it records the step the user resolved
 * by hand and continues to completion. Captures telemetry event names so a test can assert what the
 * resume reported.
 */
function makeResumeFakes() {
	const state = { statusReads: 0 };
	const events: string[] = [];
	const storage = new Map<string, unknown>();
	const status = makePausedRebaseStatus();

	const svc = {
		path: '/repo',
		pausedOps: {
			getPausedOperationStatus: () => {
				state.statusReads++;
				// 1st read: takeover's pre-flight. 2nd: the loop tick that records the manual step and
				// continues. 3rd: no paused operation left, so the loop reports completion.
				return Promise.resolve(state.statusReads <= 2 ? status : undefined);
			},
			continuePausedOperation: () => Promise.resolve(),
		},
		branches: { getBranch: () => Promise.resolve({ name: 'feature' }) },
		revision: { resolveRevision: () => Promise.resolve({ sha: 'post', revision: 'post' }) },
		status: { getStatus: () => Promise.resolve({ hasChanges: false, files: [] }) },
		ops: { reset: () => Promise.resolve() },
		staging: { stageFiles: () => Promise.resolve() },
		createUnsafeGit: () => undefined,
	};

	const container = {
		storage: {
			getWorkspace: (key: string) => storage.get(key),
			storeWorkspace: (key: string, value: unknown) => {
				storage.set(key, value);
				return Promise.resolve();
			},
			deleteWorkspace: (key: string) => {
				storage.delete(key);
				return Promise.resolve();
			},
		},
		git: { getRepositoryService: () => svc },
		operationOrigins: { markAdopted: () => {} },
		telemetry: { sendEvent: (name: string) => void events.push(name) },
		ai: {
			enabled: true,
			allowed: true,
			flushBYOKUsage: () => Promise.resolve(),
			getModel: () => Promise.resolve({ id: 'test-model', provider: { id: 'test' } }),
		},
	} as unknown as Container;

	const service = new AutoRebaseService(container);
	// Stub the lazily node-imported integration — the resumed step needs only the unmerged listing
	// (empty: the user resolved it) and the working-tree read for the step's "after" side.
	(service as unknown as { _integration: Promise<unknown> })._integration = Promise.resolve({
		listUnmergedEntries: () => Promise.resolve([]),
		readWorkingFiles: () => Promise.resolve(new Map([['x.txt', 'after:x.txt']])),
	});

	// Seed the escalated session takeover() resumes in place, with the snapshot captured at
	// escalation time (step 1, one file the AI attempted but couldn't apply confidently).
	const session: AutoRebaseSession = {
		id: 'session-1',
		repoPath: '/repo',
		mode: 'takeover',
		phase: 'escalated',
		preRun: { branch: 'feature', headSha: 'orig', stashCount: 0, startedAt: Date.now() },
		steps: [],
	};
	(service as unknown as { _sessions: Map<string, unknown> })._sessions.set('/repo', {
		session: session,
		cts: new CancellationTokenSource(),
		source: { source: 'commandPalette' },
		escalatedStep: {
			stepNumber: 1,
			conflictedContents: new Map([['x.txt', 'before:x.txt']]),
			resolutions: [{ filePath: 'x.txt', strategy: 'ai', description: 'merged both sides' }],
		},
	});

	return { service: service, session: session, events: events, svc: svc as unknown as GitRepositoryService };
}

suite('coretools/conflict/AutoRebaseService resume telemetry', () => {
	test('a manually-resolved step is recorded but not reported as an AI-resolved step', async () => {
		const { service, events, svc } = makeResumeFakes();

		const session = await service.takeover(svc, { source: 'commandPalette' });

		// The step must land in the summary (otherwise the assertion below would pass trivially)
		assert.strictEqual(session.phase, 'completed');
		assert.strictEqual(session.steps.length, 1);
		assert.strictEqual(session.steps[0].kind, 'manual');

		// ...but automation neither resolved nor applied it, so it must not be counted as one
		assert.ok(events.includes('autoRebase/resumed'), 'the resume itself is reported');
		assert.strictEqual(events.includes('autoRebase/step/resolved'), false);
	});
});

suite('coretools/conflict/AutoRebaseService late cancel', () => {
	test('a cancel that lands after the rebase finished finalizes as completed, not aborted', async () => {
		const { service, state, storage, svc } = makeTakeoverFakes('post');

		const session = await service.takeover(svc, { source: 'commandPalette' });

		assert.strictEqual(session.phase, 'completed');
		const stored = storage.get('autoRebase:undo:/repo') as { data: StoredAutoRebaseUndo } | undefined;
		assert.strictEqual(stored?.data.preRebaseSha, 'orig');
		assert.strictEqual(stored?.data.postRebaseSha, 'post');
		assert.strictEqual(state.resets.length, 0);
	});

	test('a cancel with the branch still at the pre-rebase tip aborts with no undo record', async () => {
		const { service, storage, svc } = makeTakeoverFakes('orig');

		const session = await service.takeover(svc, { source: 'commandPalette' });

		assert.strictEqual(session.phase, 'aborted');
		assert.strictEqual(storage.has('autoRebase:undo:/repo'), false);
	});
});

/**
 * Harness for the pre-flight ordering: `calls` records the model resolve and the rebase itself, so a
 * test can assert both whether the user was asked about AI at all and that the ask precedes anything
 * that would show progress. `pausedOp` sets what the pre-flight status read finds.
 */
function makePreflightFakes(pausedOp?: GitPausedOperationStatus) {
	const calls: string[] = [];
	const storage = new Map<string, unknown>();

	const svc = {
		path: '/repo',
		pausedOps: { getPausedOperationStatus: () => Promise.resolve(pausedOp) },
		branches: { getBranch: () => Promise.resolve({ name: 'feature' }) },
		revision: { resolveRevision: () => Promise.resolve({ sha: 'post', revision: 'post' }) },
		status: { getStatus: () => Promise.resolve({ hasChanges: false, files: [] }) },
		ops: {
			rebase: () => {
				calls.push('rebase');
				return Promise.resolve({ conflicted: false });
			},
			reset: () => Promise.resolve(),
		},
		staging: { stageFiles: () => Promise.resolve() },
		createUnsafeGit: () => undefined,
	};

	const container = {
		storage: {
			getWorkspace: (key: string) => storage.get(key),
			storeWorkspace: (key: string, value: unknown) => {
				storage.set(key, value);
				return Promise.resolve();
			},
			deleteWorkspace: (key: string) => {
				storage.delete(key);
				return Promise.resolve();
			},
		},
		git: { getRepositoryService: () => svc },
		operationOrigins: { markAdopted: () => {} },
		telemetry: { sendEvent: () => {} },
		ai: {
			enabled: true,
			allowed: true,
			flushBYOKUsage: () => Promise.resolve(),
			getModel: () => {
				calls.push('getModel');
				return Promise.resolve({ id: 'test-model', provider: { id: 'test' } });
			},
		},
	} as unknown as Container;

	const service = new AutoRebaseService(container);
	// Stub the lazily node-imported integration — no run gets far enough to use it
	(service as unknown as { _integration: Promise<unknown> })._integration = Promise.resolve({});

	return { service: service, calls: calls, svc: svc as unknown as GitRepositoryService };
}

suite('coretools/conflict/AutoRebaseService pre-flight ordering', () => {
	test('a start refused for an operation already in progress never asks about AI', async () => {
		const { service, calls, svc } = makePreflightFakes({ type: 'merge' } as unknown as GitPausedOperationStatus);

		await assert.rejects(
			service.start(svc, { upstream: 'main', source: { source: 'commandPalette' } }),
			/A merge is already in progress\./,
		);

		// The refusal was knowable without AI, so no provider/model decision may have been spent on it
		assert.deepStrictEqual(calls, []);
	});

	test('a takeover refused for having no rebase to take over never asks about AI', async () => {
		const { service, calls, svc } = makePreflightFakes(undefined);

		await assert.rejects(service.takeover(svc, { source: 'commandPalette' }), /No rebase is in progress\./);

		assert.deepStrictEqual(calls, []);
	});

	test('a start that proceeds resolves the model before the rebase begins', async () => {
		const { service, calls, svc } = makePreflightFakes(undefined);

		const session = await service.start(svc, { upstream: 'main', source: { source: 'commandPalette' } });

		// Guards the ordering the other direction: a model resolved lazily inside the run would open its
		// picker behind a panel already showing progress, which reads as a stall (#5662)
		assert.strictEqual(session.phase, 'completed');
		assert.deepStrictEqual(calls, ['getModel', 'rebase']);
	});
});
