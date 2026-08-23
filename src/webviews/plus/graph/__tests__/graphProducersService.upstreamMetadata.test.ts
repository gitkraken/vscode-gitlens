import * as assert from 'assert';
import * as sinon from 'sinon';
import { GraphProducersService } from '../graphProducersService.js';
import type { GraphMissingRefsMetadata, GraphRefMetadata } from '../protocol.js';

// `getMissingRefsMetadata`'s 'upstream' branch is the one piece of this class's enrichment pipeline pure
// enough to exercise directly: given a resolved branch, does it write `null` (no upstream at all), real
// metadata (in sync), or real metadata WITH `missing: true` (upstream existed, gone on the remote) — and
// never collapse the last two into the same `null`, which was the bug. Reached fields only:
// `_refsMetadata`, `_graphSession`, `repository`, `_issueIntegrationConnectionState`, and
// `container.git.getRepositoryService(...).branches`. Same fake-`this` + call-through-the-prototype
// approach as `graphWipService.test.ts`, for the same reason: a real instance needs a live `Container`.

type FakeBranch = {
	id: string;
	name: string;
	upstream?: { name: string; missing: boolean; state: { ahead: number; behind: number } };
};

type FakeThis = {
	_refsMetadata: Map<string, GraphRefMetadata | null> | null | undefined;
	_graphSession: { repoPath: string } | undefined;
	_issueIntegrationConnectionState: 'connected' | 'not-connected' | 'not-checked';
	repository: { path: string } | undefined;
	container: {
		git: {
			getRepositoryService: (repoPath: string) => {
				branches: { getBranches: sinon.SinonStub; getBranch: sinon.SinonStub };
			};
		};
	};
};

function createFakeThis(branches: FakeBranch[], repoPath = '/repo'): FakeThis {
	return {
		_refsMetadata: undefined,
		_graphSession: { repoPath: repoPath },
		// Skips `checkIssueIntegrations` (a network round-trip) entirely — irrelevant to the 'upstream'
		// type, which needs no hosting integration.
		_issueIntegrationConnectionState: 'not-connected',
		repository: { path: repoPath },
		container: {
			git: {
				getRepositoryService: () => ({
					branches: {
						getBranches: sinon.stub().resolves({ values: branches }),
						getBranch: sinon.stub().resolves(undefined),
					},
				}),
			},
		},
	};
}

// Targets `enrichRefsMetadata` (the resolution core `getMissingRefsMetadata` awaits) directly — the
// public entry point calls sibling private methods through `this`, which a fake `this` doesn't carry.
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
