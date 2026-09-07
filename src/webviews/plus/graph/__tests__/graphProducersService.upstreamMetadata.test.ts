import * as assert from 'assert';
import * as sinon from 'sinon';
// Side-effect only: `context.js` below pulls in `system/-webview/command.js`, whose first load is
// re-entered through container.ts's dependency chain before its `registrableCommands` array exists —
// same ordering landmine `webviewController.test.ts` documents. Loading container.ts first avoids it.
import '../../../../container.js';
import { setContext } from '../../../../system/-webview/context.js';
import { GraphProducersService } from '../graphProducersService.js';
import type { GraphMissingRefsMetadata, GraphRefMetadata } from '../protocol.js';

// `getMissingRefsMetadata`'s 'upstream' branch is the one piece of this class's enrichment pipeline pure
// enough to exercise directly: given a resolved branch, does it write `null` (no upstream at all), real
// metadata (in sync), or real metadata WITH `missing: true` (upstream existed, gone on the remote) — and
// never collapse the last two into the same `null`, which was the bug. Same call-through-the-prototype
// approach as `graphWipService.test.ts`, for the same reason: a real instance needs a live `Container`.
//
// The fake `this` is built off the real prototype so the sibling private methods `enrichRefsMetadata`
// reaches (`isHostingIntegrationConnected`, `updateRefsMetadataForIntegrationChange`, …) resolve. Its
// type stays structural (not `GraphProducersService`) so the tests can read the private-named fields.
// `repository`, `_graphSession` and `container` are prototype getters, hence `defineProperty`.

type FakeBranch = {
	id: string;
	name: string;
	upstream?: { name: string; missing: boolean; state: { ahead: number; behind: number } };
};

type FakeThis = {
	_refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	_issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked';
	_hasGateLatchedEntries: boolean;
	_lastHostingIntegrationConnected: boolean | undefined;
	context: { fireRefsMetadataChanged: sinon.SinonStub; updateState: sinon.SinonStub };
};

function createFakeThis(branches: FakeBranch[], repoPath = '/repo'): FakeThis {
	const fakeThis = Object.create(GraphProducersService.prototype) as FakeThis;

	Object.defineProperty(fakeThis, 'repository', { configurable: true, value: { path: repoPath } });
	Object.defineProperty(fakeThis, '_graphSession', { configurable: true, value: { repoPath: repoPath } });
	Object.defineProperty(fakeThis, 'container', {
		configurable: true,
		value: {
			git: {
				getRepositoryService: () => ({
					branches: {
						getBranches: sinon.stub().resolves({ values: branches }),
						getBranch: sinon.stub().resolves(undefined),
					},
				}),
			},
		},
	});

	// 'not-connected' skips `checkIssueIntegrations` (a network round-trip); the gate suite drives the
	// hosting side of the check through the context instead.
	fakeThis._issueIntegrationConnectionState = 'not-connected';
	fakeThis._refsMetadata = undefined;
	fakeThis._hasGateLatchedEntries = false;
	fakeThis._lastHostingIntegrationConnected = undefined;
	fakeThis.context = { fireRefsMetadataChanged: sinon.stub(), updateState: sinon.stub() };

	return fakeThis;
}

// Targets `enrichRefsMetadata` (the resolution core `getMissingRefsMetadata` awaits) directly.
async function invoke(fakeThis: FakeThis, metadata: GraphMissingRefsMetadata): Promise<void> {
	const fn = (
		GraphProducersService.prototype as unknown as {
			enrichRefsMetadata: (metadata: GraphMissingRefsMetadata) => Promise<void>;
		}
	).enrichRefsMetadata;

	await fn.call(fakeThis, metadata);
}

suite('GraphProducersService.getMissingRefsMetadata — upstream metadata Test Suite', () => {
	test('a branch with no upstream writes null', async () => {
		const branch: FakeBranch = { id: 'b1', name: 'feature' };
		const fakeThis = createFakeThis([branch]);

		await invoke(fakeThis, { b1: ['upstream'] });

		assert.strictEqual(fakeThis._refsMetadata?.get('b1')?.upstream, null);
	});

	test('a gone upstream writes real metadata with missing set, zeroed ahead/behind, and no context', async () => {
		const branch: FakeBranch = {
			id: 'b2',
			name: 'feature',
			upstream: { name: 'origin/feature', missing: true, state: { ahead: 3, behind: 5 } },
		};
		const fakeThis = createFakeThis([branch]);

		await invoke(fakeThis, { b2: ['upstream'] });

		assert.deepStrictEqual(fakeThis._refsMetadata?.get('b2')?.upstream, {
			name: 'feature',
			owner: 'origin',
			ahead: 0,
			behind: 0,
			missing: true,
		});
	});

	test('an in-sync upstream is unaffected — still carries live ahead/behind and its context', async () => {
		const branch: FakeBranch = {
			id: 'b3',
			name: 'feature',
			upstream: { name: 'origin/feature', missing: false, state: { ahead: 2, behind: 1 } },
		};
		const fakeThis = createFakeThis([branch]);

		await invoke(fakeThis, { b3: ['upstream'] });

		const upstream = fakeThis._refsMetadata?.get('b3')?.upstream;
		assert.strictEqual(upstream?.name, 'feature');
		assert.strictEqual(upstream?.owner, 'origin');
		assert.strictEqual(upstream?.ahead, 2);
		assert.strictEqual(upstream?.behind, 1);
		assert.strictEqual(upstream?.missing, undefined, 'the live path never sets `missing`');
		assert.ok(upstream?.context, 'the live path still carries its push/pull context');
	});
});

suite('GraphProducersService.getMissingRefsMetadata — degraded branch enumeration Test Suite', () => {
	test('a one-branch enumeration that does not cover every requested id writes nothing for any id', async () => {
		const branch: FakeBranch = { id: 'b1', name: 'feature' };
		const fakeThis = createFakeThis([branch]);

		// `other-id` isn't `b1` — the only branch `getBranches` came back with — so the enumeration reads as
		// degraded (see the comment above the bail in `enrichRefsMetadata`), and BOTH ids must come back
		// untouched: an absent entry, not `null` and not an object, so the webview re-requests them.
		await invoke(fakeThis, { 'other-id': ['upstream'], b1: ['upstream'] });

		assert.strictEqual(fakeThis._refsMetadata, undefined, 'the map itself must never even get created');
	});

	test('a one-branch enumeration that covers every requested id still resolves normally', async () => {
		const branch: FakeBranch = { id: 'b1', name: 'feature' };
		const fakeThis = createFakeThis([branch]);

		// Every requested id (just `b1`) IS the one branch `getBranches` reported, so this is a genuine
		// one-branch repo, not a degraded enumeration — it must resolve rather than bail.
		await invoke(fakeThis, { b1: ['upstream'] });

		assert.strictEqual(fakeThis._refsMetadata?.get('b1')?.upstream, null);
	});
});

const hostingIntegrationsConnectedContextKey = 'gitlens:repos:withHostingIntegrationsConnected';

function invokeContextChanged(fakeThis: FakeThis, repoPath: string): void {
	(
		GraphProducersService.prototype as unknown as {
			onHostingIntegrationsConnectedContextChanged: (repoPath: string) => void;
		}
	).onHostingIntegrationsConnectedContextChanged.call(fakeThis, repoPath);
}

suite('GraphProducersService.getMissingRefsMetadata — integration gate Test Suite', () => {
	teardown(async () => {
		// The context is process-global module state — clear it so a value this suite publishes can't
		// leak into an unrelated test.
		await setContext(hostingIntegrationsConnectedContextKey, undefined);
	});

	test('closed gate writes provisional nulls and marks them latched', async () => {
		const branch: FakeBranch = { id: 'b1', name: 'feature' };
		const fakeThis = createFakeThis([branch]);

		await invoke(fakeThis, { b1: ['pullRequest', 'issue'] });

		assert.strictEqual(fakeThis._refsMetadata?.get('b1')?.pullRequest, null);
		assert.strictEqual(fakeThis._refsMetadata?.get('b1')?.issue, null);
		assert.strictEqual(fakeThis._hasGateLatchedEntries, true);
		assert.strictEqual(fakeThis._lastHostingIntegrationConnected, false);
	});

	test('a batch that finds the gate open re-arms latched entries and fires a reset', async () => {
		const branch: FakeBranch = {
			id: 'b1',
			name: 'feature',
			upstream: { name: 'origin/feature', missing: false, state: { ahead: 2, behind: 1 } },
		};
		const fakeThis = createFakeThis([branch]);
		// A previous closed-gate batch's outcome: PR/issue nulled and latched, upstream carrying a (now
		// stale) count from before this batch runs.
		fakeThis._refsMetadata = new Map([
			[
				'b1',
				{
					pullRequest: null,
					issue: null,
					upstream: { name: 'feature', owner: 'origin', ahead: 9, behind: 9 },
				},
			],
		]);
		fakeThis._hasGateLatchedEntries = true;

		await setContext(hostingIntegrationsConnectedContextKey, ['/repo']);

		// Ask only for 'upstream' — the pull-request resolver path (which needs a live integration) must
		// never be entered for this test to isolate the re-arm behavior.
		await invoke(fakeThis, { b1: ['upstream'] });

		assert.strictEqual(fakeThis.context.fireRefsMetadataChanged.callCount, 1);

		const entry = fakeThis._refsMetadata?.get('b1');
		assert.ok(entry);
		assert.strictEqual('pullRequest' in entry, false, 'the latched pullRequest null is re-armed (key gone)');
		assert.strictEqual('issue' in entry, false, 'the latched issue null is re-armed (key gone)');
		// The batch's OWN 'upstream' resolution merges on top of the reset with live data — proof the
		// mid-batch reset didn't corrupt or block it.
		assert.strictEqual(entry?.upstream?.ahead, 2);
		assert.strictEqual(entry?.upstream?.behind, 1);
		assert.strictEqual(fakeThis._hasGateLatchedEntries, false);
	});

	test('the context-flip handler compares against the batch-observed value', async () => {
		const branch: FakeBranch = { id: 'b1', name: 'feature' };
		const fakeThis = createFakeThis([branch]);
		// Simulates a baseline seeded (by `seedHostingIntegrationConnected`) AFTER the context already
		// listed the repo — the stale seed that let the original bug go undetected.
		fakeThis._lastHostingIntegrationConnected = true;

		// A closed-gate batch (no context published yet) latches a provisional null for 'pullRequest' and
		// records what it actually observed.
		await invoke(fakeThis, { b1: ['pullRequest'] });
		assert.strictEqual(fakeThis._lastHostingIntegrationConnected, false);

		await setContext(hostingIntegrationsConnectedContextKey, ['/repo']);
		invokeContextChanged(fakeThis, '/repo');

		assert.strictEqual(fakeThis.context.fireRefsMetadataChanged.callCount, 1);
		const entry = fakeThis._refsMetadata?.get('b1');
		assert.ok(entry);
		assert.strictEqual('pullRequest' in entry, false);
	});
});
