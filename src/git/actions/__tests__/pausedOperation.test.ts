import * as assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../../container.js';
import * as sinon from 'sinon';
import { commands, Uri, window } from 'vscode';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../gitRepositoryService.js';
import {
	continuePausedOperation,
	isContinuingPausedOperation,
	onDidChangeContinuingPausedOperation,
	showPausedOperationStatus,
} from '../pausedOperation.js';

suite('pausedOperation Test Suite', () => {
	// Deliberately the normalized (`getRepositoryKey`) form, as `svc.path` is in production. The
	// drive letter stays lowercase in the alternate-form lookups below too: `normalizePath` only
	// lowercases drive letters on Windows, so an uppercase variant would not match when the tests
	// run on other platforms.
	const repoPath = 'c:/repo';

	let sandbox: sinon.SinonSandbox;
	let showInformationMessageStub: sinon.SinonStub;
	let resolveContinue: (() => void) | undefined;
	let continueCalls: number;
	let svc: GitRepositoryService;

	setup(() => {
		sandbox = sinon.createSandbox();
		// The already-continuing guard notifies the user, so stub it rather than leaving a real
		// notification (and a promise that only settles when it's dismissed) behind the run
		showInformationMessageStub = sandbox.stub(window, 'showInformationMessage').resolves(undefined);

		continueCalls = 0;
		resolveContinue = undefined;
		svc = {
			path: repoPath,
			pausedOps: {
				getPausedOperationStatus: () =>
					Promise.resolve({ type: 'merge' } as unknown as GitPausedOperationStatus),
				continuePausedOperation: () => {
					continueCalls++;
					return new Promise<void>(resolve => (resolveContinue = resolve));
				},
			},
		} as unknown as GitRepositoryService;
	});

	teardown(async () => {
		// Settle any continue a failed assertion left in flight, so the module-level in-flight set
		// is clean for the next test rather than routing it into the already-continuing guard
		resolveContinue?.();
		await new Promise<void>(resolve => setImmediate(resolve));
		sandbox.restore();
	});

	const container = {} as unknown as Container;

	test('the in-flight flag is queryable by any path form while a continue is running', async () => {
		const pending = continuePausedOperation(container, svc);
		// The status read for rebase adoption is awaited before the continue starts; let it settle
		await new Promise<void>(resolve => setImmediate(resolve));

		assert.strictEqual(isContinuingPausedOperation(repoPath), true);
		// A raw `Uri.fsPath` — backslash separators — must still match the normalized set key
		// (Home's overview producer looks up with this form for worktree-backed branches; see #5668)
		assert.strictEqual(isContinuingPausedOperation('c:\\repo'), true);
		assert.strictEqual(isContinuingPausedOperation('c:/repo/'), true);
		assert.strictEqual(isContinuingPausedOperation('c:/other'), false);

		resolveContinue!();
		await pending;
		assert.strictEqual(isContinuingPausedOperation(repoPath), false);
		assert.strictEqual(isContinuingPausedOperation('c:\\repo'), false);
	});

	test('the change event fires with the repository key on start and on settle', async () => {
		const events: string[] = [];
		const subscription = onDidChangeContinuingPausedOperation(path => events.push(path));
		try {
			const pending = continuePausedOperation(container, svc);
			await new Promise<void>(resolve => setImmediate(resolve));
			assert.deepStrictEqual(events, [repoPath]);

			resolveContinue!();
			await pending;
			assert.deepStrictEqual(events, [repoPath, repoPath]);
		} finally {
			subscription.dispose();
		}
	});

	test('a second continue while one is in flight reports the wait instead of re-running', async () => {
		const pending = continuePausedOperation(container, svc);
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(continueCalls, 1);

		await continuePausedOperation(container, svc);
		assert.strictEqual(continueCalls, 1);

		// The guard reports the wait instead of silently doing nothing. The notification is
		// fire-and-forget behind its own status read, so let that settle before asserting.
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(showInformationMessageStub.callCount, 1);
		assert.match(showInformationMessageStub.firstCall.args[0] as string, /merge is already continuing/);

		resolveContinue!();
		await pending;
	});
});

suite('showPausedOperationStatus Test Suite', () => {
	const repoPath = 'c:/repo';

	type Surface = 'graph' | 'rebaseEditor' | 'scm';
	interface Scenario {
		type: GitPausedOperationStatus['type'];
		/** `undefined` is signed out */
		account?: { verified: boolean };
		graphAllowed: boolean;
		previewExpired?: boolean;
		fromRebaseEditor?: boolean;
		/** A rebase on the apply backend keeps no todo */
		noRebaseTodo?: boolean;
	}

	let sandbox: sinon.SinonSandbox;
	let executeCommandStub: sinon.SinonStub;
	let gitDir: string;

	setup(async () => {
		sandbox = sinon.createSandbox();
		executeCommandStub = sandbox.stub(commands, 'executeCommand').resolves();
		gitDir = await mkdtemp(join(tmpdir(), 'gitlens-paused-op-'));

		const { Container: ContainerClass } = await import('../../../container.js');
		sandbox.stub(ContainerClass, 'instance').get(() => ({ telemetry: { sendEvent: () => {} } }));
	});

	teardown(async () => {
		sandbox.restore();
		await rm(gitDir, { recursive: true, force: true });
	});

	async function surfaceFor(scenario: Scenario): Promise<Surface[]> {
		const surfaces: Surface[] = [];

		if (!scenario.noRebaseTodo) {
			await mkdir(join(gitDir, 'rebase-merge'));
			await writeFile(join(gitDir, 'rebase-merge', 'git-rebase-todo'), '');
		}

		const svc = {
			path: repoPath,
			pausedOps: {
				getPausedOperationStatus: () =>
					Promise.resolve({ type: scenario.type } as unknown as GitPausedOperationStatus),
			},
			config: { getGitDir: () => Promise.resolve({ uri: Uri.file(gitDir) }) },
			getOrOpenScmRepository: () => Promise.resolve(undefined),
		} as unknown as GitRepositoryService;

		const container = {
			git: {
				getRepositoryService: () => svc,
				access: () => Promise.resolve({ allowed: scenario.graphAllowed }),
			},
			subscription: {
				getSubscription: () => Promise.resolve({ account: scenario.account }),
				getFeaturePreview: () => ({
					feature: 'graph',
					usages: scenario.previewExpired
						? [{ startedOn: '2020-01-01T00:00:00.000Z', expiresOn: '2020-01-04T00:00:00.000Z' }]
						: [],
				}),
			},
		} as unknown as Container;

		await showPausedOperationStatus(container, repoPath, { fromRebaseEditor: scenario.fromRebaseEditor });

		for (const call of executeCommandStub.getCalls()) {
			if (call.args[0] === 'gitlens.showGraph') {
				surfaces.push('graph');
			} else if (call.args[0] === 'vscode.openWith') {
				surfaces.push('rebaseEditor');
			} else if (call.args[0] === 'workbench.view.scm') {
				surfaces.push('scm');
			}
		}

		return surfaces;
	}

	const verified = { verified: true };
	const unverified = { verified: false };

	const scenarios: [name: string, scenario: Scenario, expected: Surface][] = [
		['a merge with an accessible graph', { type: 'merge', account: verified, graphAllowed: true }, 'graph'],
		[
			'a merge signed out on a private repo while the preview is available',
			{ type: 'merge', graphAllowed: false },
			'graph',
		],
		['a merge with an unverified account', { type: 'merge', account: unverified, graphAllowed: true }, 'scm'],
		[
			'a cherry-pick signed out on a private repo after the preview ended',
			{ type: 'cherry-pick', graphAllowed: false, previewExpired: true },
			'scm',
		],
		[
			'a revert signed in without access to the graph',
			{ type: 'revert', account: verified, graphAllowed: false },
			'scm',
		],
		['a rebase with a gated graph', { type: 'rebase', account: verified, graphAllowed: false }, 'rebaseEditor'],
		[
			'a rebase with a gated graph and no todo to edit',
			{ type: 'rebase', account: verified, graphAllowed: false, noRebaseTodo: true },
			'scm',
		],
		[
			'a rebase with a gated graph, asked from the rebase editor',
			{ type: 'rebase', account: verified, graphAllowed: false, fromRebaseEditor: true },
			'scm',
		],
		[
			'a rebase with an accessible graph, asked from the rebase editor',
			{ type: 'rebase', account: verified, graphAllowed: true, fromRebaseEditor: true },
			'graph',
		],
	];

	for (const [name, scenario, expected] of scenarios) {
		test(`${name} is shown in the ${expected}`, async () => {
			assert.deepStrictEqual(await surfaceFor(scenario), [expected]);
		});
	}
});
