import * as assert from 'assert';
import type { GitGraphRowHead, GitGraphRowRemoteHead } from '@gitlens/git/models/graph.js';
import { createReference } from '@gitlens/git/utils/reference.utils.js';
import { serializeWebviewItemContext } from '../../../../../../system/webview.js';
import type {
	GraphBranchContextValue,
	GraphItemRefContext,
	GraphTagContextValue,
} from '../../../../../plus/graph/protocol.js';
import {
	buildBranchWebviewItem,
	buildRemoteBranchWebviewItem,
	buildTagWebviewItem,
	serializeBranchRefContext,
	serializeRemoteBranchRefContext,
	serializeTagRefContext,
} from '../refContext.utils.js';

function head(overrides?: Partial<GitGraphRowHead>): GitGraphRowHead {
	return { id: 'branch-id', name: 'main', isCurrentHead: false, ...overrides };
}

function remote(overrides?: Partial<GitGraphRowRemoteHead>): GitGraphRowRemoteHead {
	return { id: 'remote-id', name: 'main', owner: 'origin', ...overrides };
}

const upstream = { name: 'origin/main', id: 'upstream-id' };

// These strings ARE the contract — `when` clauses match them with `=~`, and the host's concatenation order
// in `src/git/graphRowProcessor.ts` is what every existing clause was written against. Asserting whole
// strings rather than `includes` is deliberate: it catches a reordering, which a substring check cannot.
suite('refContext.utils — branch webviewItem', () => {
	test('a plain local branch carries no flags', () => {
		assert.strictEqual(buildBranchWebviewItem(head()), 'gitlens:branch');
	});

	test('flags appear in the host order, not the order they were tested', () => {
		const item = buildBranchWebviewItem(
			head({
				isCurrentHead: true,
				upstream: { ...upstream, state: { ahead: 2, behind: 3 } },
				worktree: { id: 'wt', path: '/wt', isDefault: false },
				starred: true,
			}),
			{ pinnedRefId: 'branch-id' },
		);
		assert.strictEqual(item, 'gitlens:branch+current+tracking+worktree+starred+ahead+behind+pinned');
	});

	test('tracking is about having an upstream at all, not about being ahead or behind', () => {
		assert.strictEqual(buildBranchWebviewItem(head({ upstream: upstream })), 'gitlens:branch+tracking');
	});

	// The wire's `worktree.isDefault` replaces two host-side collections: a map with the main worktree
	// removed (`+worktree`) and a comparison against the main worktree's branch id (`+checkedout`).
	test('the default worktree is +checkedout; any other is +worktree', () => {
		assert.strictEqual(
			buildBranchWebviewItem(head({ worktree: { id: 'wt', path: '/repo', isDefault: true } })),
			'gitlens:branch+checkedout',
		);
		assert.strictEqual(
			buildBranchWebviewItem(head({ worktree: { id: 'wt', path: '/wt', isDefault: false } })),
			'gitlens:branch+worktree',
		);
	});

	test('zero ahead/behind counts claim neither flag', () => {
		assert.strictEqual(
			buildBranchWebviewItem(head({ upstream: { ...upstream, state: { ahead: 0, behind: 0 } } })),
			'gitlens:branch+tracking',
		);
	});

	// The GitHub provider ships no branch metadata, so `state` is absent rather than zeroed. That has to
	// read as "unknown" — claiming +ahead/+behind off missing data would put actions in a menu that cannot
	// perform them on a virtual repo.
	test('an uncomputed upstream state claims neither flag', () => {
		assert.strictEqual(buildBranchWebviewItem(head({ upstream: upstream })), 'gitlens:branch+tracking');
	});

	// The two flags this step exists to fix: both were baked in at row-build time, so starring or pinning
	// left the menu wrong until something else forced a walk.
	test('starred and pinned are read at build time from live state', () => {
		assert.strictEqual(buildBranchWebviewItem(head({ starred: true })), 'gitlens:branch+starred');
		assert.strictEqual(buildBranchWebviewItem(head(), { pinnedRefId: 'branch-id' }), 'gitlens:branch+pinned');
	});

	test('a pin on a different ref does not leak onto this one', () => {
		assert.strictEqual(buildBranchWebviewItem(head(), { pinnedRefId: 'other-id' }), 'gitlens:branch');
	});

	test('an id-less head can never match a pin', () => {
		assert.strictEqual(
			buildBranchWebviewItem(head({ id: undefined }), { pinnedRefId: 'branch-id' }),
			'gitlens:branch',
		);
	});
});

suite('refContext.utils — remote branch and tag webviewItem', () => {
	test('a plain remote branch', () => {
		assert.strictEqual(buildRemoteBranchWebviewItem(remote()), 'gitlens:branch+remote');
	});

	test('remote flags appear in the host order', () => {
		assert.strictEqual(
			buildRemoteBranchWebviewItem(remote({ starred: true }), { pinnedRefId: 'remote-id' }),
			'gitlens:branch+remote+starred+pinned',
		);
	});

	test('a remote never claims the local-only flags', () => {
		const item = buildRemoteBranchWebviewItem(remote({ starred: true }));
		assert.ok(!item.includes('+tracking') && !item.includes('+worktree') && !item.includes('+checkedout'));
	});

	test('tags carry no flags', () => {
		assert.strictEqual(buildTagWebviewItem(), 'gitlens:tag');
	});
});

// Byte-equality against the host. While both shapes are valid the webview's payload must be INDISTINGUISHABLE
// from `src/git/graphRowProcessor.ts`'s, or a `when` clause matches in one surface and not the other. The
// expectations below re-express the host's construction through the same `createReference` +
// `serializeWebviewItemContext` helpers, so what these actually pin is the part the webview hand-builds: the
// reconstructed `upstream` (including its key order), the worktree-path mapping, and the flag order.
const repoPath = '/repo';

suite('refContext.utils — serialized payload matches the host', () => {
	test('a tracked local branch in a secondary worktree', () => {
		// The live `GitTrackingUpstream` the host passes straight into `createReference`.
		const upstream = { name: 'origin/main', missing: false, state: { ahead: 2, behind: 1 } };
		const host = serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>({
			webviewItem: 'gitlens:branch+current+tracking+worktree+starred+ahead+behind+pinned',
			webviewItemValue: {
				type: 'branch',
				ref: createReference('main', repoPath, {
					id: 'branch-id',
					refType: 'branch',
					name: 'main',
					remote: false,
					upstream: upstream,
				}),
				worktreePath: '/wt',
			},
		});

		const built = serializeBranchRefContext(
			head({
				isCurrentHead: true,
				upstream: { name: 'origin/main', id: 'upstream-id', missing: false, state: { ahead: 2, behind: 1 } },
				worktree: { id: 'wt', path: '/wt', isDefault: false },
				starred: true,
			}),
			repoPath,
			{ pinnedRefId: 'branch-id' },
		);

		assert.strictEqual(built, host);
	});

	// The wire's upstream carries an extra `id` the reference must NOT include, and `state` must survive even
	// though `GitBranchReferenceOptions` doesn't declare it — the host passes the live object, so it ships.
	test('the reconstructed upstream drops the wire id and keeps state', () => {
		const parsed = JSON.parse(
			serializeBranchRefContext(
				head({
					upstream: { name: 'origin/main', id: 'upstream-id', missing: true, state: { ahead: 0, behind: 4 } },
				}),
				repoPath,
			)!,
		) as { webviewItemValue: { ref: { upstream: Record<string, unknown> } } };
		assert.deepStrictEqual(Object.keys(parsed.webviewItemValue.ref.upstream), ['name', 'missing', 'state']);
		assert.deepStrictEqual(parsed.webviewItemValue.ref.upstream, {
			name: 'origin/main',
			missing: true,
			state: { ahead: 0, behind: 4 },
		});
	});

	// The host's worktree map has the MAIN worktree removed, so an ordinary checkout carries no worktreePath.
	// Emitting one would make every checked-out branch look like a worktree checkout to the menus.
	test('the default worktree contributes +checkedout but no worktreePath', () => {
		const built = JSON.parse(
			serializeBranchRefContext(head({ worktree: { id: 'wt', path: '/repo', isDefault: true } }), repoPath)!,
		) as { webviewItem: string; webviewItemValue: Record<string, unknown> };
		assert.strictEqual(built.webviewItem, 'gitlens:branch+checkedout');
		assert.ok(!('worktreePath' in built.webviewItemValue), 'the default worktree must not be named');
	});

	test('a remote branch', () => {
		const host = serializeWebviewItemContext<GraphItemRefContext<GraphBranchContextValue>>({
			webviewItem: 'gitlens:branch+remote',
			webviewItemValue: {
				type: 'branch',
				ref: createReference('origin/main', repoPath, {
					id: 'remote-id',
					refType: 'branch',
					name: 'origin/main',
					remote: true,
					upstream: { name: 'origin', missing: false },
				}),
			},
		});
		assert.strictEqual(serializeRemoteBranchRefContext(remote(), repoPath), host);
	});

	test('a tag', () => {
		const host = serializeWebviewItemContext<GraphItemRefContext<GraphTagContextValue>>({
			webviewItem: 'gitlens:tag',
			webviewItemValue: {
				type: 'tag',
				ref: createReference('v1.0.0', repoPath, { id: 'tag-id', refType: 'tag', name: 'v1.0.0' }),
			},
		});
		assert.strictEqual(serializeTagRefContext({ id: 'tag-id', name: 'v1.0.0', annotated: true }, repoPath), host);
	});

	// A GitHub/virtual head is name-only. Those rows never had a ref context — the provider does not run the
	// row processor — so their pills have never had a right-click menu. Building one here would put the whole
	// local-branch menu (Delete, Rename, Switch to, Merge, Rebase, Reset, Create Worktree, Publish, Set
	// Upstream) on vscode.dev, against a provider that can serve none of it.
	test('a lean ref gets NO context, so a virtual repo gains no menu it cannot serve', () => {
		assert.strictEqual(serializeBranchRefContext({ name: 'main', isCurrentHead: true }, repoPath), undefined);
		assert.strictEqual(serializeRemoteBranchRefContext({ name: 'main', owner: 'origin' }, repoPath), undefined);
		assert.strictEqual(serializeTagRefContext({ name: 'v1', annotated: false }, repoPath), undefined);
	});

	test('an id-bearing ref still gets one', () => {
		assert.ok(serializeBranchRefContext(head(), repoPath) != null);
	});
});

// The provider-tier contract (see `GitGraphRowHead.id`): an id-less ref came from a provider that computes
// nothing beyond a name, so absent optional fields mean UNKNOWN rather than "no". Nothing may be reported as
// a capability on such a ref — the menu would offer actions the provider cannot perform.
suite('refContext.utils — a lean ref claims no capabilities', () => {
	test('a name-only head yields the bare item, whatever else is asked of it', () => {
		assert.strictEqual(
			buildBranchWebviewItem({ name: 'main', isCurrentHead: false }, { pinnedRefId: 'anything' }),
			'gitlens:branch',
		);
	});

	test('a name-only remote yields the bare item', () => {
		assert.strictEqual(
			buildRemoteBranchWebviewItem({ name: 'main', owner: 'origin' }, { pinnedRefId: 'anything' }),
			'gitlens:branch+remote',
		);
	});

	// `isCurrentHead` is the ONE capability a lean provider does compute, so it must still be honoured —
	// otherwise the contract would read as "lean means featureless", which would drop a real signal.
	test('but a computed current-head is still honoured', () => {
		assert.strictEqual(buildBranchWebviewItem({ name: 'main', isCurrentHead: true }), 'gitlens:branch+current');
	});
});
