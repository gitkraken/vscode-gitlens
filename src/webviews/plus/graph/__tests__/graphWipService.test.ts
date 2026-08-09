import * as assert from 'assert';
import * as sinon from 'sinon';
import { GraphWipService } from '../graphWipService.js';

// `probeSecondaryWipInBackground` reaches only `this.repository`, `this.getWipRows`, `this.host.notify`,
// `this._disposed`, its own probe fields, and the module-level `configuration` (for the overview bar's
// visibility gate — read off the workspace, not `this`), so we exercise it against a minimal fake `this`
// rather than constructing the service (which would need a real Container). That couples these tests to
// private field NAMES — a rename breaks them noisily, which is the intended trade.
//
// Under test: the probe fans a `git diff`/`ls-files` walk across EVERY worktree, and its only caller is the
// graph state build, which fires 2-3 times per logical change (the notify freshness gate defers rather than
// drops). One fan-out per burst, not one per build.

type ProbeFn = () => void;
type ProbeRun = { repoPath: string; startedAt: number; running: boolean } | undefined;

type FakeThis = {
	repository: { path: string } | undefined;
	getWipRows: sinon.SinonStub;
	host: { notify: sinon.SinonStub };
	_disposed: boolean;
	_wipProbeGeneration: number;
	_wipProbeCancellation: { cancel: () => void; dispose: () => void } | undefined;
	_wipProbeRun: ProbeRun;
};

function invoke(fakeThis: FakeThis): void {
	const fn = (GraphWipService.prototype as unknown as { probeSecondaryWipInBackground: ProbeFn })
		.probeSecondaryWipInBackground;
	fn.call(fakeThis);
}

/** Rows carrying a PEER, so the probe gets past its "nothing to report without a peer" guard and notifies. */
function rowsWithPeer(repoPath: string) {
	return { rows: { [`wip:${repoPath}`]: {}, 'wip:/other/worktree': {} }, state: {} };
}

function createFakeThis(repoPath = '/repo'): FakeThis {
	return {
		repository: { path: repoPath },
		getWipRows: sinon.stub().resolves(rowsWithPeer(repoPath)),
		host: { notify: sinon.stub().resolves(true) },
		_disposed: false,
		_wipProbeGeneration: 0,
		_wipProbeCancellation: undefined,
		_wipProbeRun: undefined,
	};
}

/** Lets the probe's async IIFE run to completion. */
function settle(): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, 0));
}

suite('GraphWipService.probeSecondaryWipInBackground Test Suite', () => {
	test('joins the fan-out already in flight instead of restarting it', async () => {
		const fakeThis = createFakeThis();
		let release!: (value: unknown) => void;
		fakeThis.getWipRows.returns(new Promise(resolve => (release = resolve)));

		invoke(fakeThis);
		invoke(fakeThis);
		invoke(fakeThis);

		assert.strictEqual(fakeThis.getWipRows.callCount, 1, 'a burst of builds must cost ONE fan-out');

		release(rowsWithPeer('/repo'));
		await settle();
		assert.strictEqual(fakeThis.host.notify.callCount, 1);
	});

	test('drops a repeat landing inside the cooldown window', async () => {
		const fakeThis = createFakeThis();
		invoke(fakeThis);
		await settle();
		assert.strictEqual(fakeThis.getWipRows.callCount, 1);

		// The burst's tail arrives just AFTER the first walk settles — the case an in-flight check alone misses.
		invoke(fakeThis);
		assert.strictEqual(fakeThis.getWipRows.callCount, 1, 'still inside the window, so no second fan-out');
	});

	test('probes again once the cooldown window has elapsed', async () => {
		const fakeThis = createFakeThis();
		invoke(fakeThis);
		await settle();

		// Seed the run as long-settled rather than faking the clock: nothing in this repo fakes
		// `performance.now()`, and patching it in the shared extension-host process is the riskier move.
		fakeThis._wipProbeRun!.startedAt -= 60_000;
		invoke(fakeThis);
		assert.strictEqual(fakeThis.getWipRows.callCount, 2, 'the window must not suppress forever');
	});

	test('a different repo bypasses the window and fences the outgoing run', async () => {
		const fakeThis = createFakeThis('/repo-a');
		let release!: (value: unknown) => void;
		fakeThis.getWipRows.returns(new Promise(resolve => (release = resolve)));
		invoke(fakeThis);
		assert.strictEqual(fakeThis.getWipRows.callCount, 1);

		fakeThis.repository = { path: '/repo-b' };
		fakeThis.getWipRows.returns(new Promise(() => {}));
		invoke(fakeThis);
		assert.strictEqual(fakeThis.getWipRows.callCount, 2, 'a swap must re-probe, not ride /repo-a`s window');

		// /repo-a's walk resolving after the swap must not publish over /repo-b.
		release(rowsWithPeer('/repo-a'));
		await settle();
		assert.strictEqual(fakeThis.host.notify.callCount, 0, 'a superseded repo must never publish');
	});

	test('a repo swap back re-probes rather than reusing the original window', async () => {
		const fakeThis = createFakeThis('/repo-a');
		invoke(fakeThis);
		await settle();

		fakeThis.repository = { path: '/repo-b' };
		invoke(fakeThis);
		await settle();

		fakeThis.repository = { path: '/repo-a' };
		invoke(fakeThis);
		assert.strictEqual(fakeThis.getWipRows.callCount, 3, 'A->B->A must re-probe A');
	});

	test('does nothing without a repository', () => {
		const fakeThis = createFakeThis();
		fakeThis.repository = undefined;

		invoke(fakeThis);

		assert.strictEqual(fakeThis.getWipRows.callCount, 0);
		assert.strictEqual(fakeThis._wipProbeRun, undefined);
	});
});

// Same minimal-fake approach for `runWipRefetch`, which reaches only its own maps, the host's
// ready/visible flags, and the fetch+notify pair.
type RefetchEntry = { repo: { path: string }; dirty: boolean; deferred?: boolean; inFlight?: Promise<void> };

type FakeRefetchThis = {
	_wipRefetches: Map<string, RefetchEntry>;
	_wipWatches: Map<string, unknown>;
	_disposed: boolean;
	host: { ready: boolean; visible: boolean; notify: sinon.SinonStub };
	getWipForRepoAndStats: sinon.SinonStub;
	onWipServedOutOfBand: sinon.SinonStub;
};

function runRefetch(fakeThis: FakeRefetchThis, sha: string): Promise<void> {
	const fn = (GraphWipService.prototype as unknown as { runWipRefetch: (sha: string) => Promise<void> })
		.runWipRefetch;
	return fn.call(fakeThis, sha);
}

function createFakeRefetchThis(sha = 'wip::/peer'): FakeRefetchThis {
	return {
		_wipRefetches: new Map([[sha, { repo: { path: '/peer' }, dirty: false }]]),
		_wipWatches: new Map([[sha, {}]]),
		_disposed: false,
		host: { ready: true, visible: true, notify: sinon.stub().resolves(true) },
		getWipForRepoAndStats: sinon.stub().resolves({ wip: { revision: 1 } }),
		onWipServedOutOfBand: sinon.stub(),
	};
}

suite('GraphWipService.runWipRefetch Test Suite', () => {
	const sha = 'wip::/peer';

	// A watcher tick landing inside a reveal/rebuild window used to be DELETED. Nothing re-reads a peer
	// worktree on its own, so that single dropped tick left the row showing pre-change values until the
	// user happened to touch that worktree again. `!ready` is a moment, not a verdict.
	test('defers rather than drops when the host is not ready', async () => {
		const fakeThis = createFakeRefetchThis();
		fakeThis.host.ready = false;

		await runRefetch(fakeThis, sha);

		assert.strictEqual(fakeThis.getWipForRepoAndStats.callCount, 0, 'no git work for a host still coming up');
		assert.strictEqual(fakeThis._wipRefetches.get(sha)?.deferred, true, 'the tick must survive for recovery');
	});

	test('defers rather than drops while the graph is hidden', async () => {
		const fakeThis = createFakeRefetchThis();
		fakeThis.host.visible = false;

		await runRefetch(fakeThis, sha);

		assert.strictEqual(fakeThis.getWipForRepoAndStats.callCount, 0);
		assert.strictEqual(fakeThis._wipRefetches.get(sha)?.deferred, true);
	});

	// A disposed watcher is a real verdict — that row is no longer tracked, so there is nothing to recover.
	test('drops when the watcher is gone', async () => {
		const fakeThis = createFakeRefetchThis();
		fakeThis._wipWatches.delete(sha);

		await runRefetch(fakeThis, sha);

		assert.strictEqual(fakeThis.getWipForRepoAndStats.callCount, 0);
		assert.strictEqual(fakeThis._wipRefetches.has(sha), false);
	});

	test('fetches and notifies when ready and visible', async () => {
		const fakeThis = createFakeRefetchThis();

		await runRefetch(fakeThis, sha);

		assert.strictEqual(fakeThis.getWipForRepoAndStats.callCount, 1);
		assert.strictEqual(fakeThis.host.notify.callCount, 1);
	});
});
