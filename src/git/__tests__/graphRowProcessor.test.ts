import * as assert from 'assert';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraphRow, GitGraphRowHead, GitGraphRowRemoteHead, GraphContext } from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { Container } from '../../container.js';
import { GlGraphRowProcessor } from '../graphRowProcessor.js';

function createMockContainer(): Container {
	return {
		context: { extensionUri: { fsPath: '/mock', path: '/mock', scheme: 'file' } },
	} as unknown as Container;
}

function createMockContext(overrides?: Partial<GraphContext>): GraphContext {
	return {
		repoPath: '/mock/repo',
		useAvatars: false,
		branches: new Map<string, GitBranch>(),
		remotes: new Map<string, GitRemote>(),
		worktreesByBranch: undefined,
		branchIdOfMainWorktree: undefined,
		stashes: undefined,
		reachableFromHEAD: new Set<string>(),
		rewriteableFromHEAD: new Set<string>(),
		tipShasWithChildren: new Set<string>(),
		reachableFromHeadUpstream: undefined,
		avatars: new Map<string, string>([['test@test.com', 'https://avatar']]),
		...overrides,
	};
}

function createRow(overrides?: Partial<GitGraphRow>): GitGraphRow {
	return {
		sha: 'abc123',
		parents: [],
		author: 'Test',
		email: 'test@test.com',
		date: Date.now(),
		message: 'test commit',
		type: 'commit-node',
		...overrides,
	};
}

function createHead(name: string, id: string, isCurrentHead = false): GitGraphRowHead {
	return { name: name, id: id, isCurrentHead: isCurrentHead };
}

function createRemoteHead(name: string, owner: string, id: string): GitGraphRowRemoteHead {
	return { name: name, owner: owner, id: id };
}

function getWebviewItem(context: string | object | undefined): string {
	if (context == null) return '';

	const parsed: { webviewItem?: string } =
		typeof context === 'string' ? (JSON.parse(context) as { webviewItem?: string }) : context;
	return parsed.webviewItem ?? '';
}

suite('GlGraphRowProcessor', () => {
	suite('+pinned flag on local branches', () => {
		test('adds +pinned when head.id matches pinnedRefId', () => {
			const pinnedId = '/mock/repo|heads/feature-a';
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => pinnedId,
			);

			const head = createHead('feature-a', pinnedId);
			const row = createRow({ heads: [head] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(head.context);
			assert.ok(item.includes('+pinned'), `expected +pinned in "${item}"`);
		});

		test('does not add +pinned when head.id does not match', () => {
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => '/mock/repo|heads/other-branch',
			);

			const head = createHead('feature-a', '/mock/repo|heads/feature-a');
			const row = createRow({ heads: [head] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(head.context);
			assert.ok(!item.includes('+pinned'), `unexpected +pinned in "${item}"`);
		});

		test('does not add +pinned when getPinnedRefId returns undefined', () => {
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => undefined,
			);

			const head = createHead('feature-a', '/mock/repo|heads/feature-a');
			const row = createRow({ heads: [head] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(head.context);
			assert.ok(!item.includes('+pinned'), `unexpected +pinned in "${item}"`);
		});

		test('only the matching head gets +pinned when multiple heads exist', () => {
			const pinnedId = '/mock/repo|heads/feature-b';
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => pinnedId,
			);

			const headA = createHead('feature-a', '/mock/repo|heads/feature-a');
			const headB = createHead('feature-b', pinnedId);
			const headC = createHead('main', '/mock/repo|heads/main', true);
			const row = createRow({ heads: [headA, headB, headC] });
			processor.processRow(row, createMockContext());

			assert.ok(!getWebviewItem(headA.context).includes('+pinned'), 'feature-a should not be pinned');
			assert.ok(getWebviewItem(headB.context).includes('+pinned'), 'feature-b should be pinned');
			assert.ok(!getWebviewItem(headC.context).includes('+pinned'), 'main should not be pinned');
		});
	});

	suite('+pinned flag on remote branches', () => {
		test('adds +pinned when remoteHead.id matches pinnedRefId', () => {
			const pinnedId = '/mock/repo|remotes/origin/feature-a';
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => pinnedId,
			);

			const remoteHead = createRemoteHead('feature-a', 'origin', pinnedId);
			const row = createRow({ remotes: [remoteHead] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(remoteHead.context);
			assert.ok(item.includes('+pinned'), `expected +pinned in "${item}"`);
			assert.ok(item.includes('+remote'), `expected +remote in "${item}"`);
		});

		test('does not add +pinned to non-matching remote heads', () => {
			const processor = new GlGraphRowProcessor(
				createMockContainer(),
				uri => uri,
				() => '/mock/repo|remotes/origin/other',
			);

			const remoteHead = createRemoteHead('feature-a', 'origin', '/mock/repo|remotes/origin/feature-a');
			const row = createRow({ remotes: [remoteHead] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(remoteHead.context);
			assert.ok(!item.includes('+pinned'), `unexpected +pinned in "${item}"`);
		});
	});

	suite('default getPinnedRefId', () => {
		test('uses default callback returning undefined when not provided', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const head = createHead('main', '/mock/repo|heads/main');
			const row = createRow({ heads: [head] });
			processor.processRow(row, createMockContext());

			const item = getWebviewItem(head.context);
			assert.ok(!item.includes('+pinned'), `unexpected +pinned in "${item}"`);
		});
	});

	// The host ships `+unpublished` as the `Unpublished` bit in `contexts.flags`; the webview turns
	// the bit into the `+unpublished` webview-item token (`buildRowCommitContext`). A commit is
	// unpublished when it's reachable from HEAD but NOT from HEAD's upstream tip
	// (`reachableFromHeadUpstream`); `undefined` upstream ⇒ HEAD has no upstream ⇒ never flagged.
	suite('Unpublished flag on commit rows', () => {
		test('sets the Unpublished bit when reachable from HEAD but not from its upstream', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			processor.processRow(
				row,
				createMockContext({
					reachableFromHEAD: new Set([row.sha]),
					reachableFromHeadUpstream: new Set<string>(), // upstream exists, doesn't contain this commit
				}),
			);

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.Unpublished) !== 0,
				`expected Unpublished bit set in flags ${flags}`,
			);
		});

		test('does not set the Unpublished bit when the commit is reachable from the upstream', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			processor.processRow(
				row,
				createMockContext({
					reachableFromHEAD: new Set([row.sha]),
					reachableFromHeadUpstream: new Set([row.sha]), // already on the upstream → pushed
				}),
			);

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.Unpublished) === 0,
				`unexpected Unpublished bit in flags ${flags}`,
			);
		});

		test('does not set the Unpublished bit when HEAD has no upstream', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			// reachableFromHeadUpstream undefined ⇒ no upstream to be ahead of ⇒ nothing flagged
			processor.processRow(row, createMockContext({ reachableFromHEAD: new Set([row.sha]) }));

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.Unpublished) === 0,
				`unexpected Unpublished bit in flags ${flags}`,
			);
		});

		test('does not set the Unpublished bit on stash rows', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			// stash rows go through the stash branch (which builds `contexts.row`, not `contexts.flags`)
			const row = createRow({ type: 'stash-node' });
			processor.processRow(
				row,
				createMockContext({
					reachableFromHEAD: new Set([row.sha]),
					reachableFromHeadUpstream: new Set<string>(),
				}),
			);

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.Unpublished) === 0,
				`unexpected Unpublished bit on stash flags ${flags}`,
			);
		});
	});

	// The host ships `+rewriteable` as the `RewriteableFromHead` bit in `contexts.flags`; the webview
	// turns the bit into the `+rewriteable` webview-item token (`buildRowCommitContext`) that gates the
	// history-rewriting commands (squash/drop/reword/modify). A commit is rewriteable when it's on the
	// first-parent chain from HEAD up to (excluding) the first merge — i.e. present in `rewriteableFromHEAD`.
	suite('RewriteableFromHead flag on commit rows', () => {
		test('sets the RewriteableFromHead bit when the commit is in rewriteableFromHEAD', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			processor.processRow(row, createMockContext({ rewriteableFromHEAD: new Set([row.sha]) }));

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.RewriteableFromHead) !== 0,
				`expected RewriteableFromHead bit set in flags ${flags}`,
			);
		});

		test('does not set the RewriteableFromHead bit when the commit is not in rewriteableFromHEAD', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			// Reachable from HEAD (e.g. an ancestor of a merge) but NOT on the first-parent rewriteable chain.
			const row = createRow();
			processor.processRow(row, createMockContext({ reachableFromHEAD: new Set([row.sha]) }));

			const flags = row.contexts?.flags ?? 0;
			assert.ok(
				(flags & GitGraphRowContextFlags.RewriteableFromHead) === 0,
				`unexpected RewriteableFromHead bit in flags ${flags}`,
			);
		});
	});
});
