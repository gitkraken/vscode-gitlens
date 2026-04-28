import * as assert from 'assert';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitGraphRow, GitGraphRowHead, GitGraphRowRemoteHead, GraphContext } from '@gitlens/git/models/graph.js';
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
});
