import * as assert from 'node:assert';
// Imported for its side effect, FIRST and deliberately — see agentStatusService.test.ts: letting
// container initialize first breaks the decorator-registry import cycle.
import '../../container.js';
import * as sinon from 'sinon';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { Container } from '../../container.js';
import { GitOperationOriginTracker } from '../gitOperationOriginTracker.js';

type ChangeListener = (e: { changed(type: string): boolean; repository: { path: string } }) => void;
type RepositoriesListener = (e: { removed: { path: string }[] }) => void;

suite('GitOperationOriginTracker Test Suite', () => {
	const repoPath = '/repo';

	let sandbox: sinon.SinonSandbox;
	let clock: sinon.SinonFakeTimers;
	let tracker: GitOperationOriginTracker;
	let fireRepositoryChange: (path: string, rebase?: boolean) => Promise<void>;
	let fireRepositoriesChange: (removed: string[]) => void;
	/** The paused-operation status `getPausedOperationStatus` resolves for the next events */
	let pausedStatus: GitPausedOperationStatus | undefined;
	/** Overridable status resolution, for tests that need a deferred read */
	let getStatus: () => Promise<GitPausedOperationStatus | undefined>;
	let lastStatusOptions: { force?: boolean } | undefined;

	setup(() => {
		sandbox = sinon.createSandbox();
		// Only fake Date so the tracker's grace-period math is controllable while real timers
		// still flush the async event handlers
		clock = sandbox.useFakeTimers({ toFake: ['Date'] });

		getStatus = () => Promise.resolve(pausedStatus);
		lastStatusOptions = undefined;

		let changeListener: ChangeListener | undefined;
		let repositoriesListener: RepositoriesListener | undefined;

		const container = {
			git: {
				onDidChangeRepository: (listener: ChangeListener) => {
					changeListener = listener;
					return { dispose: () => {} };
				},
				onDidChangeRepositories: (listener: RepositoriesListener) => {
					repositoriesListener = listener;
					return { dispose: () => {} };
				},
				getRepositoryService: () => ({
					pausedOps: {
						getPausedOperationStatus: (options?: { force?: boolean }) => {
							lastStatusOptions = options;
							return getStatus();
						},
					},
				}),
			},
		} as unknown as Container;

		tracker = new GitOperationOriginTracker(container);

		fireRepositoryChange = async (path, rebase = true) => {
			changeListener?.({ changed: type => rebase && type === 'rebase', repository: { path: path } });
			// The handler is fire-and-forget (`void this.onRebaseChanged(...)`); let it settle
			await new Promise<void>(resolve => setImmediate(resolve));
		};
		fireRepositoriesChange = removed => repositoriesListener?.({ removed: removed.map(p => ({ path: p })) });
	});

	teardown(() => {
		tracker.dispose();
		sandbox.restore();
	});

	function rebaseStatus(): GitPausedOperationStatus {
		return { type: 'rebase' } as unknown as GitPausedOperationStatus;
	}

	test('is not GitLens-initiated until marked', () => {
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);

		tracker.markStarted(repoPath, 'rebase');
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);
	});

	test('normalizes paths to the repository key', () => {
		tracker.markStarted('C:\\repo\\', 'rebase');
		assert.strictEqual(tracker.isGitLensInitiated('C:/repo'), true);
	});

	test('adoption marks the repository as GitLens-initiated', () => {
		tracker.markAdopted(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);
	});

	test('clear removes the entry', () => {
		tracker.markStarted(repoPath, 'pull');
		tracker.clear(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('entry survives while the rebase is in progress and clears when it ends', async () => {
		tracker.markStarted(repoPath, 'rebase');

		pausedStatus = rebaseStatus();
		await fireRepositoryChange(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);

		pausedStatus = undefined;
		await fireRepositoryChange(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('a null status inside the grace period does not clear a not-yet-observed rebase', async () => {
		tracker.markStarted(repoPath, 'rebase');

		pausedStatus = undefined;
		await fireRepositoryChange(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);
	});

	test('a null status after the grace period clears an entry that never started a rebase', async () => {
		tracker.markStarted(repoPath, 'pull');
		clock.tick(3000);

		pausedStatus = undefined;
		await fireRepositoryChange(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('events for other repositories or without rebase changes are ignored', async () => {
		tracker.markStarted(repoPath, 'rebase');
		clock.tick(3000);

		pausedStatus = undefined;
		await fireRepositoryChange('/other');
		await fireRepositoryChange(repoPath, false);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);
	});

	test('operation ended without a rebase on disk clears immediately — no watcher event needed', async () => {
		// The fast-forward-pull case: no rebase ever starts, so no rebase watcher events fire
		tracker.markStarted(repoPath, 'pull');

		pausedStatus = undefined;
		await tracker.onOperationEnded(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
		assert.deepStrictEqual(lastStatusOptions, { force: true });
	});

	test('operation ended with a live rebase keeps the entry; the rebase ending later clears it', async () => {
		tracker.markStarted(repoPath, 'pull');

		pausedStatus = rebaseStatus();
		await tracker.onOperationEnded(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);

		// The ended check marked the rebase as observed, so a later null status clears without grace
		pausedStatus = undefined;
		await fireRepositoryChange(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('a pending ended check does not clobber a newer markStarted', async () => {
		tracker.markStarted(repoPath, 'pull');

		let resolveStatus!: (status: GitPausedOperationStatus | undefined) => void;
		getStatus = () => new Promise(resolve => (resolveStatus = resolve));
		const ended = tracker.onOperationEnded(repoPath);

		// A new operation starts while the ended check's status read is still in flight
		tracker.markStarted(repoPath, 'rebase');
		resolveStatus(undefined);
		await ended;

		assert.strictEqual(tracker.isGitLensInitiated(repoPath), true);
	});

	test('operation ended with no entry is a no-op', async () => {
		pausedStatus = undefined;
		await tracker.onOperationEnded(repoPath);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('closing the repository removes its entry', () => {
		tracker.markStarted(repoPath, 'rebase');
		fireRepositoriesChange([repoPath]);
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});

	test('dispose clears all entries', () => {
		tracker.markStarted(repoPath, 'rebase');
		tracker.dispose();
		assert.strictEqual(tracker.isGitLensInitiated(repoPath), false);
	});
});
