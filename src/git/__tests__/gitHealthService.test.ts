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
};

type Harness = {
	readonly service: GitHealthService;
	readonly repo: GlRepository;
	readonly getHealthSnapshot: sinon.SinonStub<[], Promise<GitHealthSnapshot>>;
	readonly getHealthDetails: sinon.SinonStub<[AbortSignal?], Promise<GitHealthDetails>>;
	readonly request: sinon.SinonStub<[GitMaintenanceTask], Promise<boolean> | undefined>;
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
		packCount: 1,
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
	const maintenance = {
		getHealthSnapshot: getHealthSnapshot,
		getHealthDetails: getHealthDetails,
		getCapabilities: () => Promise.resolve(makeCapabilities()),
		request: request,
		claimMaintenancePass: () => Promise.resolve(false),
		runMaintenanceTask: () => Promise.resolve(false),
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

	test('records only local repository operations as passive slowness', async () => {
		for (const operation of ['fetch', 'push', 'pull', 'clone', 'commit']) {
			harness.service.recordSlowCommand(harness.repo.path, 2500, operation);
		}

		const service = harness.service as unknown as TestableGitHealthService;
		const before = await service.probe(harness.repo);
		assert.ok(before != null);
		assert.strictEqual(
			before.findings.some(f => f.reason === 'slowness'),
			false,
			'remote and interactive operations must not become repository-health evidence',
		);

		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');
		const after = await service.probe(harness.repo);
		assert.ok(after != null);
		assert.strictEqual(
			after.findings.some(f => f.reason === 'slowness'),
			true,
			'a slow local status operation should become repository-health evidence',
		);
	});

	test('hydrates only v2 slowness and deletes the retired v1 key once', async () => {
		const now = Date.now();
		harness.getWorkspace.withArgs('gitHealth:slowness:v2').returns({
			[harness.repo.path]: { count: 2, lastAt: now, maxDurationMs: 1200 },
		});
		harness.getWorkspace.withArgs('gitHealth:slowness').returns({
			[harness.repo.path]: { count: 100, lastAt: now, maxDurationMs: 10000 },
		});

		harness.service.recordSlowCommand(harness.repo.path, 2000, 'status');
		harness.service.recordSlowCommand(harness.repo.path, 2500, 'status');

		sinon.assert.calledOnceWithExactly(harness.getWorkspace, 'gitHealth:slowness:v2');
		sinon.assert.calledOnceWithExactly(harness.deleteWorkspace, 'gitHealth:slowness');

		// Dispose flushes the debounced write so the persisted value proves the retired v1 data was never merged.
		harness.service.dispose();
		await settleAsyncWork();
		sinon.assert.calledOnce(harness.storeWorkspace);
		const [key, stored] = harness.storeWorkspace.firstCall.args;
		assert.strictEqual(key, 'gitHealth:slowness:v2');
		const storedByRepo = stored as Record<string, { count: number; lastAt: number; maxDurationMs: number }>;
		assert.strictEqual(storedByRepo[harness.repo.path].count, 4);
		assert.ok(storedByRepo[harness.repo.path].lastAt >= now);
		assert.strictEqual(storedByRepo[harness.repo.path].maxDurationMs, 2500);
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
});
