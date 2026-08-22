import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../container.js';
import * as sinon from 'sinon';
import type { GitHealthReport } from '@gitlens/git/gitHealth.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import type {
	GitHealthDetails,
	GitHealthSnapshot,
	GitMaintenanceSubProvider,
	GitMaintenanceTask,
	GitOptimizationCapability,
	GitOptimizationId,
} from '@gitlens/git/providers/maintenance.js';
import type { SubProviderForRepo } from '@gitlens/git/repositoryService.js';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import { GitHealthService } from '../gitHealthService.js';
import type { GlRepository } from '../models/repository.js';

type Maintenance = SubProviderForRepo<GitMaintenanceSubProvider>;
type RepositoryChangeListener = (e: {
	readonly repository: { readonly path: string };
	changed(...changes: RepositoryChange[]): boolean;
}) => void;
type RepositoriesChangeListener = (e: {
	readonly added: readonly GlRepository[];
	readonly removed: readonly GlRepository[];
}) => void;
type TestableGitHealthService = {
	onConfigurationChanged(e: undefined): void;
	probe(repo: GlRepository): Promise<GitHealthReport | undefined>;
	runAutoPassIfDue(repo: GlRepository, report: GitHealthReport): Promise<void>;
};

type Harness = {
	readonly service: GitHealthService;
	readonly repo: GlRepository;
	readonly getHealthSnapshot: sinon.SinonStub<[], Promise<GitHealthSnapshot>>;
	readonly getHealthDetails: sinon.SinonStub<[AbortSignal?], Promise<GitHealthDetails>>;
	readonly request: sinon.SinonStub<[GitMaintenanceTask], Promise<boolean> | undefined>;
	readonly claimMaintenancePass: sinon.SinonStub<[number], Promise<boolean>>;
	readonly runMaintenanceTask: sinon.SinonStub<
		[GitMaintenanceTask, { readonly auto?: boolean; readonly cancellation?: AbortSignal }?],
		Promise<boolean>
	>;
	readonly getWorkspace: sinon.SinonStub<[string], unknown>;
	readonly storeWorkspace: sinon.SinonStub<[string, unknown], Promise<void>>;
	readonly deleteWorkspace: sinon.SinonStub<[string], Promise<void>>;
	readonly fireRepositoryChange: (change: RepositoryChange) => void;
	readonly fireRepositoriesChange: (added: readonly GlRepository[], removed: readonly GlRepository[]) => void;
};

function makeSnapshot(): GitHealthSnapshot {
	return {
		repository: {
			shallow: false,
			partial: false,
			sparseCheckout: false,
			sparseCheckoutCone: false,
			sparseIndex: false,
			splitIndex: false,
			refFormat: 'files',
		},
		looseRefs: { count: 0, exact: true },
		commitGraph: {
			present: true,
			mtime: 1000,
			changedPaths: true,
			changedPathsSupported: true,
			disabled: false,
			readDisabled: false,
		},
		multiPackIndex: false,
		multiPackIndexEnabled: true,
		packCount: 1,
		packsOutsideMultiPackIndex: 1,
		incrementalRepackAutoThreshold: 10,
		packBytes: 1000,
		looseObjects: { objectsInSampledDirs: 0, dirsSampled: 16 },
		indexBytes: 1000,
		indexEntryCount: 10,
		indexEntryCountType: 'full',
		config: { fsmonitor: false, untrackedCache: false, untrackedCacheConfigured: false, manyFiles: false },
		maintenanceRegistered: false,
		fsmonitorNotApplicable: false,
		untrackedCacheNotApplicable: false,
		applied: {
			untrackedCache: false,
			fsmonitor: false,
			manyFiles: false,
			backgroundMaintenance: false,
			sparseIndex: false,
		},
		supportsMaintenanceRun: true,
		supportsPackRefsMaintenance: true,
	};
}

function makeCapabilities(): GitOptimizationCapability[] {
	const ids: GitOptimizationId[] = [
		'untrackedCache',
		'fsmonitor',
		'backgroundMaintenance',
		'manyFiles',
		'sparseIndex',
	];
	return ids.map(id => ({ id: id, supported: true }));
}

function makeHarness(sandbox: sinon.SinonSandbox): Harness {
	const repoPath = '/repo';
	const getHealthSnapshot = sandbox.stub<[], Promise<GitHealthSnapshot>>().resolves(makeSnapshot());
	const getHealthDetails = sandbox
		.stub<[AbortSignal?], Promise<GitHealthDetails>>()
		.resolves({ commitCount: 42, countObjects: undefined });
	const request = sandbox.stub<[GitMaintenanceTask], Promise<boolean> | undefined>().resolves(false);
	const claimMaintenancePass = sandbox.stub<[number], Promise<boolean>>().resolves(false);
	const runMaintenanceTask = sandbox
		.stub<
			[GitMaintenanceTask, { readonly auto?: boolean; readonly cancellation?: AbortSignal }?],
			Promise<boolean>
		>()
		.resolves(false);
	const maintenance = {
		getHealthSnapshot: getHealthSnapshot,
		getHealthDetails: getHealthDetails,
		getCapabilities: () => Promise.resolve(makeCapabilities()),
		request: request,
		claimMaintenancePass: claimMaintenancePass,
		runMaintenanceTask: runMaintenanceTask,
		applyOptimization: () => Promise.resolve(false),
		revertOptimization: () => Promise.resolve(),
		setCommitGraphDisabled: () => Promise.resolve(),
	} satisfies Maintenance;
	const repo = {
		path: repoPath,
		git: {
			maintenance: maintenance,
			config: { getGitDir: () => Promise.resolve(undefined) },
		},
	} as unknown as GlRepository;

	const getWorkspace = sandbox.stub<[string], unknown>().returns(undefined);
	const storeWorkspace = sandbox.stub<[string, unknown], Promise<void>>().resolves();
	const deleteWorkspace = sandbox.stub<[string], Promise<void>>().resolves();
	let repositoryOpen = true;
	let repositoryChangeListener: RepositoryChangeListener | undefined;
	let repositoriesChangeListener: RepositoriesChangeListener | undefined;
	const noopDisposable = { dispose: () => {} };
	const container = {
		git: {
			openRepositories: [],
			getRepository: (path: string) => (repositoryOpen && path.startsWith(repoPath) ? repo : undefined),
			onDidChangeRepository: (listener: RepositoryChangeListener) => {
				repositoryChangeListener = listener;
				return noopDisposable;
			},
			onDidChangeRepositories: (listener: RepositoriesChangeListener) => {
				repositoriesChangeListener = listener;
				return noopDisposable;
			},
		},
		storage: {
			getWorkspace: getWorkspace,
			storeWorkspace: storeWorkspace,
			deleteWorkspace: deleteWorkspace,
		},
		telemetry: { sendEvent: () => {} },
	} as unknown as Container;

	const service = new GitHealthService(container);
	return {
		service: service,
		repo: repo,
		getHealthSnapshot: getHealthSnapshot,
		getHealthDetails: getHealthDetails,
		request: request,
		claimMaintenancePass: claimMaintenancePass,
		runMaintenanceTask: runMaintenanceTask,
		getWorkspace: getWorkspace,
		storeWorkspace: storeWorkspace,
		deleteWorkspace: deleteWorkspace,
		fireRepositoryChange: change => {
			repositoryChangeListener?.({
				repository: repo,
				changed: (...changes) => changes.includes(change),
			});
		},
		fireRepositoriesChange: (added, removed) => {
			if (removed.includes(repo)) {
				repositoryOpen = false;
			}
			if (added.includes(repo)) {
				repositoryOpen = true;
			}

			repositoriesChangeListener?.({ added: added, removed: removed });
		},
	};
}

async function settleAsyncWork(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
	await new Promise<void>(resolve => setImmediate(resolve));
}

suite('GitHealthService Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let harness: Harness;
	let configurationGet: sinon.SinonStubbedMember<typeof configuration.get>;

	setup(() => {
		sandbox = sinon.createSandbox();
		configurationGet = sandbox.stub(configuration, 'get').returns(true);
		harness = makeHarness(sandbox);
	});

	teardown(() => {
		harness.service.dispose();
		sandbox.restore();
	});

	test('records only classified local operations and targets worktree slowness', async () => {
		for (const operation of ['fetch', 'push', 'pull', 'clone', 'commit']) {
			harness.service.recordSlowCommand(harness.repo.path, 2500, operation);
		}

		const service = harness.service as unknown as TestableGitHealthService;
		const before = await service.probe(harness.repo);
		assert.ok(before != null);
		assert.strictEqual(
			before.findings.some(f => f.reason === 'worktreeSlowness'),
			false,
			'remote and interactive operations must not become repository-health evidence',
		);

		harness.service.recordSlowCommand(harness.repo.path, 2500, 'log');
		const afterHistory = await service.probe(harness.repo);
		assert.ok(afterHistory != null);
		assert.strictEqual(
			afterHistory.findings.some(f => f.reason === 'worktreeSlowness'),
			false,
			'history slowness must not advertise worktree optimizations',
		);

		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');
		const after = await service.probe(harness.repo);
		assert.ok(after != null);
		assert.strictEqual(
			after.findings.some(f => f.reason === 'worktreeSlowness'),
			true,
			'a slow local status operation should become repository-health evidence',
		);
	});

	test('hydrates only v3 slowness and deletes retired aggregate keys once', async () => {
		const now = Date.now();
		harness.getWorkspace.withArgs('gitHealth:slowness:v3').returns({
			[harness.repo.path]: { worktree: { count: 2, lastAt: now, maxDurationMs: 1200 } },
		});
		harness.getWorkspace.withArgs('gitHealth:slowness').returns({
			[harness.repo.path]: { count: 100, lastAt: now, maxDurationMs: 10000 },
		});
		harness.getWorkspace.withArgs('gitHealth:slowness:v2').returns({
			[harness.repo.path]: { count: 100, lastAt: now, maxDurationMs: 10000 },
		});

		harness.service.recordSlowCommand(harness.repo.path, 2000, 'status');
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		sinon.assert.calledOnceWithExactly(harness.getWorkspace, 'gitHealth:slowness:v3');
		sinon.assert.calledWithExactly(harness.deleteWorkspace, 'gitHealth:slowness');
		sinon.assert.calledWithExactly(harness.deleteWorkspace, 'gitHealth:slowness:v2');

		// Dispose flushes the debounced write so the persisted value proves the retired v1 data was never merged.
		harness.service.dispose();
		await settleAsyncWork();
		sinon.assert.calledOnce(harness.storeWorkspace);
		const [key, stored] = harness.storeWorkspace.firstCall.args;
		assert.strictEqual(key, 'gitHealth:slowness:v3');
		const storedByRepo = stored as Record<
			string,
			{ worktree: { count: number; lastAt: number; maxDurationMs: number } }
		>;
		assert.strictEqual(storedByRepo[harness.repo.path].worktree.count, 4);
		assert.ok(storedByRepo[harness.repo.path].worktree.lastAt >= now);
		assert.strictEqual(storedByRepo[harness.repo.path].worktree.maxDurationMs, 2500);
	});

	test('persists slow operations in their worktree, history, refs, and object families', async () => {
		for (const operation of ['status', 'log', 'for-each-ref', 'cat-file']) {
			harness.service.recordSlowCommand(harness.repo.path, 2500, operation);
		}

		harness.service.dispose();
		await settleAsyncWork();
		const [, stored] = harness.storeWorkspace.firstCall.args;
		const storedByRepo = stored as Record<
			string,
			Record<'worktree' | 'history' | 'refs' | 'objects', { count: number }>
		>;
		assert.deepStrictEqual(
			Object.fromEntries(
				Object.entries(storedByRepo[harness.repo.path]).map(([category, sample]) => [category, sample.count]),
			),
			{ worktree: 1, history: 1, refs: 1, objects: 1 },
		);
	});

	test('drops malformed and stale v3 categories without discarding recent valid evidence', async () => {
		const now = Date.now();
		harness.getWorkspace.withArgs('gitHealth:slowness:v3').returns({
			[harness.repo.path]: {
				worktree: 'malformed',
				history: { count: 4, lastAt: 0, maxDurationMs: 9000 },
				refs: { count: 2, lastAt: now, maxDurationMs: 3000 },
			},
		});

		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');
		harness.service.dispose();
		await settleAsyncWork();
		const [, stored] = harness.storeWorkspace.firstCall.args;
		const storedByRepo = stored as Record<string, Record<string, { count: number }>>;
		assert.deepStrictEqual(Object.keys(storedByRepo[harness.repo.path]).sort(), ['refs', 'worktree']);
		assert.strictEqual(storedByRepo[harness.repo.path].refs.count, 2);
		assert.strictEqual(storedByRepo[harness.repo.path].worktree.count, 1);
	});

	test('caches completed details across repeated calls', async () => {
		const first = await harness.service.getDetails(harness.repo.path);
		const second = await harness.service.getDetails(harness.repo.path);

		assert.deepStrictEqual(first, { commitCount: 42, countObjects: undefined });
		assert.strictEqual(second, first, 'the completed cached details should be reused');
		assert.strictEqual(harness.getHealthDetails.callCount, 1);
	});

	test('keeps details for index changes and invalidates them for ref changes', async () => {
		await harness.service.getDetails(harness.repo.path);

		harness.fireRepositoryChange('index');
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(harness.getHealthDetails.callCount, 1, 'index-only changes reuse full-history details');

		harness.fireRepositoryChange('heads');
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(harness.getHealthDetails.callCount, 2, 'heads changes invalidate full-history details');

		harness.fireRepositoryChange('tags');
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(harness.getHealthDetails.callCount, 3, 'tag changes invalidate rev-list --all details');

		harness.fireRepositoryChange('stash');
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(harness.getHealthDetails.callCount, 4, 'stash changes invalidate rev-list --all details');
	});

	test('a walk started before an invalidation must not cache its stale result', async () => {
		let resolveDetails!: (details: GitHealthDetails) => void;
		harness.getHealthDetails.returns(
			new Promise<GitHealthDetails>(resolve => {
				resolveDetails = resolve;
			}),
		);

		const pending = harness.service.getDetails(harness.repo.path);
		harness.fireRepositoryChange('heads');
		resolveDetails({ commitCount: 1, countObjects: undefined });
		await pending;

		assert.strictEqual(harness.getHealthDetails.callCount, 1);
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(
			harness.getHealthDetails.callCount,
			2,
			'the stale walk must not have been cached, so a second call re-fetches',
		);
	});

	test('a walk started before repository eviction must not populate a reopened repository cache', async () => {
		let resolveDetails!: (details: GitHealthDetails) => void;
		harness.getHealthDetails.returns(
			new Promise<GitHealthDetails>(resolve => {
				resolveDetails = resolve;
			}),
		);

		const pending = harness.service.getDetails(harness.repo.path);
		harness.fireRepositoriesChange([], [harness.repo]);
		resolveDetails({ commitCount: 1, countObjects: undefined });
		await pending;

		harness.fireRepositoriesChange([harness.repo], []);
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(
			harness.getHealthDetails.callCount,
			2,
			'a reopened repository must not inherit details from a walk started before it was closed',
		);
	});

	test('a walk started before disable must not repopulate the cache after re-enable', async () => {
		let resolveDetails!: (details: GitHealthDetails) => void;
		harness.getHealthDetails.returns(
			new Promise<GitHealthDetails>(resolve => {
				resolveDetails = resolve;
			}),
		);

		const pending = harness.service.getDetails(harness.repo.path);
		const service = harness.service as unknown as TestableGitHealthService;
		configurationGet.returns(false);
		service.onConfigurationChanged(undefined);
		resolveDetails({ commitCount: 1, countObjects: undefined });
		await pending;

		configurationGet.returns(true);
		service.onConfigurationChanged(undefined);
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(
			harness.getHealthDetails.callCount,
			2,
			're-enabling must not expose details cached by work that outlived the disabled cache epoch',
		);
	});

	test('does not fire duplicate change events for unchanged probes', async () => {
		const changed: string[] = [];
		const subscription = harness.service.onDidChange(path => changed.push(path));
		try {
			const service = harness.service as unknown as TestableGitHealthService;
			await service.probe(harness.repo);
			await service.probe(harness.repo);

			assert.deepStrictEqual(changed, [harness.repo.path]);
		} finally {
			subscription.dispose();
		}
	});

	test('uses Git native auto conditions for background maintenance tasks', async () => {
		harness.getHealthSnapshot.resolves({
			...makeSnapshot(),
			packCount: 10,
			packsOutsideMultiPackIndex: 10,
			looseRefs: { count: 256, exact: true },
		});
		harness.claimMaintenancePass.resolves(true);
		harness.runMaintenanceTask.resolves(true);

		const service = harness.service as unknown as TestableGitHealthService;
		const report = await service.probe(harness.repo);
		assert.ok(report != null);
		await service.runAutoPassIfDue(harness.repo, report);

		sinon.assert.callCount(harness.runMaintenanceTask, 2);
		assert.strictEqual(harness.runMaintenanceTask.firstCall.args[0], 'incremental-repack');
		assert.strictEqual(harness.runMaintenanceTask.firstCall.args[1]?.auto, true);
		assert.strictEqual(harness.runMaintenanceTask.secondCall.args[0], 'pack-refs');
		assert.strictEqual(
			harness.runMaintenanceTask.secondCall.args[1]?.auto,
			false,
			'Git Health keeps its own bounded ref threshold for older Git versions without a native auto condition',
		);
	});

	test('reprobes once after a completed commit-graph request and stops when the next request is gated', async () => {
		harness.request.onFirstCall().resolves(true);
		harness.request.onSecondCall().resolves(false);
		await harness.service.getDetails(harness.repo.path);

		const service = harness.service as unknown as TestableGitHealthService;
		await service.probe(harness.repo);
		await settleAsyncWork();

		assert.strictEqual(harness.getHealthSnapshot.callCount, 2, 'completion should trigger exactly one re-probe');
		assert.strictEqual(harness.request.callCount, 2, 'the re-probe should issue one gated follow-up request');
		await harness.service.getDetails(harness.repo.path);
		assert.strictEqual(
			harness.getHealthDetails.callCount,
			1,
			'a commit-graph cache rewrite must not repeat full-history details',
		);

		await settleAsyncWork();
		assert.strictEqual(harness.getHealthSnapshot.callCount, 2, 'a gated request must not create a probe loop');
		assert.strictEqual(harness.request.callCount, 2);
	});

	test('getBannerState reports worktree-slowness evidence and the suggested-lever count', async () => {
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		const state = await harness.service.getBannerState(harness.repo.path);
		assert.ok(state != null);
		assert.strictEqual(state.banner, true);
		assert.strictEqual(state.indicator, true);
		assert.strictEqual(state.reason, 'slowness');
		assert.strictEqual(state.maxDurationMs, 2500);
		assert.strictEqual(state.trackedFiles, undefined);
		assert.strictEqual(state.suggestedCount, 3);
	});

	test('dismissBanner suppresses the banner but leaves the indicator armed', async () => {
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		await harness.service.dismissBanner(harness.repo.path);

		const state = await harness.service.getBannerState(harness.repo.path);
		assert.ok(state != null);
		assert.strictEqual(state.banner, false);
		assert.strictEqual(state.indicator, true);
	});

	test('markHealthViewVisited quiets the indicator but leaves the banner up', async () => {
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		await harness.service.markHealthViewVisited(harness.repo.path);

		const state = await harness.service.getBannerState(harness.repo.path);
		assert.ok(state != null);
		assert.strictEqual(state.banner, true, 'only an explicit dismissal quiets the strip');
		assert.strictEqual(state.indicator, false);
	});

	test('dismiss plus visit suppresses both flags but keeps reporting the facts', async () => {
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		await harness.service.dismissBanner(harness.repo.path);
		await harness.service.markHealthViewVisited(harness.repo.path);

		const state = await harness.service.getBannerState(harness.repo.path);
		assert.ok(state != null, 'the suggestion count outlives the strip and the dot (toggle tooltip fact)');
		assert.strictEqual(state.banner, false);
		assert.strictEqual(state.indicator, false);
		assert.strictEqual(state.suggestedCount, 3);
	});

	test('markHealthViewVisited only fires a change event on an actual suppression change', async () => {
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');
		const changed: string[] = [];
		const subscription = harness.service.onDidChange(path => changed.push(path));
		try {
			await harness.service.markHealthViewVisited(harness.repo.path);
			await harness.service.markHealthViewVisited(harness.repo.path);
			assert.deepStrictEqual(
				changed,
				[harness.repo.path],
				'a repeat visit within the suppression window must not re-fire',
			);
		} finally {
			subscription.dispose();
		}
	});

	test('a 30-day-old dismissal expires and re-arms the banner', async () => {
		const staleAt = Date.now() - 31 * 24 * 60 * 60 * 1000;
		harness.getWorkspace.withArgs('gitHealth:banner:v1').returns({
			[harness.repo.path]: { dismissedAt: staleAt, visitedAt: staleAt },
		});
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		const state = await harness.service.getBannerState(harness.repo.path);
		assert.ok(state != null);
		assert.strictEqual(state.banner, true, 'an expired dismissal must not keep suppressing the banner');
		assert.strictEqual(state.indicator, true, 'an expired visit must not keep suppressing the indicator');
	});
});
