import * as assert from 'assert';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type {
	GitGraphRow,
	GitGraphRowHead,
	GitGraphRowRemoteHead,
	GitGraphRowTag,
	GraphContext,
} from '@gitlens/git/models/graph.js';
import { GitGraphRowContextFlags } from '@gitlens/git/models/graph.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import type { Container } from '../../container.js';
import {
	serializeBranchRefContext,
	serializeRemoteBranchRefContext,
	serializeTagRefContext,
} from '../../webviews/apps/plus/graph/utils/refContext.utils.js';
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
		type: 'commit',
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
			const row = createRow({ type: 'stash' });
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

	// `Unpulled` is the exact mirror of `Unpublished` over the same two reachability sets: on HEAD's
	// upstream tip but NOT on HEAD (i.e. `HEAD..@{u}`). It drives the graph's read-only unpulled indicator
	// and — unlike `Unpublished` — has no webview-item token.
	suite('Unpulled flag on commit rows', () => {
		test('sets the Unpulled bit when reachable from the upstream but not from HEAD', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			processor.processRow(
				row,
				createMockContext({
					reachableFromHEAD: new Set<string>(), // HEAD hasn't reached this commit yet
					reachableFromHeadUpstream: new Set([row.sha]),
				}),
			);

			const flags = row.contexts?.flags ?? 0;
			assert.ok((flags & GitGraphRowContextFlags.Unpulled) !== 0, `expected Unpulled bit set in flags ${flags}`);
		});

		test('does not set the Unpulled bit when the commit is reachable from HEAD', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			processor.processRow(
				row,
				createMockContext({
					reachableFromHEAD: new Set([row.sha]),
					reachableFromHeadUpstream: new Set([row.sha]), // on both → already pulled
				}),
			);

			const flags = row.contexts?.flags ?? 0;
			assert.ok((flags & GitGraphRowContextFlags.Unpulled) === 0, `unexpected Unpulled bit in flags ${flags}`);
		});

		test('does not set the Unpulled bit when HEAD has no upstream', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			const row = createRow();
			// reachableFromHeadUpstream undefined ⇒ no upstream to be behind ⇒ nothing flagged, even though
			// the commit is off HEAD (e.g. it sits on some unrelated local branch).
			processor.processRow(row, createMockContext({ reachableFromHEAD: new Set<string>() }));

			const flags = row.contexts?.flags ?? 0;
			assert.ok((flags & GitGraphRowContextFlags.Unpulled) === 0, `unexpected Unpulled bit in flags ${flags}`);
		});

		test('never sets Unpublished and Unpulled together', () => {
			const processor = new GlGraphRowProcessor(createMockContainer(), uri => uri);

			// Every combination of the two membership sets — the pair is mutually exclusive by construction,
			// so no input may produce both bits (the shared indicator slot in the row-action strip relies on it).
			for (const onHead of [false, true]) {
				for (const onUpstream of [false, true]) {
					const row = createRow();
					processor.processRow(
						row,
						createMockContext({
							reachableFromHEAD: onHead ? new Set([row.sha]) : new Set<string>(),
							reachableFromHeadUpstream: onUpstream ? new Set([row.sha]) : new Set<string>(),
						}),
					);

					const flags = row.contexts?.flags ?? 0;
					assert.ok(
						(flags & GitGraphRowContextFlags.Unpublished) === 0 ||
							(flags & GitGraphRowContextFlags.Unpulled) === 0,
						`both bits set for onHead=${onHead} onUpstream=${onUpstream} (flags ${flags})`,
					);
				}
			}
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

// The webview builds these same payloads from the wire's structured ref fields
// (`webviews/apps/plus/graph/utils/refContext.utils.ts`) so the host can stop serializing them. While BOTH
// shapes are live, a difference would mean a `when` clause matching on a ref pill but not on the same ref
// elsewhere — so this drives the real processor and compares its output byte-for-byte, rather than
// re-expressing what the host is believed to do.
//
// The row and the context must be populated the way the CLI provider populates them: `head.starred` /
// `head.upstream` on the wire mirror the same `GitBranch` the host looks up in `context.branches`. That
// correspondence IS the contract this pins.
suite('GlGraphRowProcessor — webview rebuilds identical ref contexts', () => {
	const repoPath = '/mock/repo';

	function hostContext(value: string | object | undefined): string {
		return typeof value === 'string' ? value : JSON.stringify(value);
	}

	function branchWith(upstream?: GitBranch['upstream'], starred = false): GitBranch {
		return { upstream: upstream, starred: starred } as unknown as GitBranch;
	}

	test('a plain local branch', () => {
		const head = createHead('feature-a', `${repoPath}|heads/feature-a`);
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => undefined,
		);
		processor.processRow(createRow({ heads: [head] }), createMockContext());

		assert.strictEqual(serializeBranchRefContext(head, repoPath), hostContext(head.context));
	});

	test('a current, tracked, starred, ahead/behind, pinned branch', () => {
		const id = `${repoPath}|heads/main`;
		const upstream = { name: 'origin/main', missing: false, state: { ahead: 2, behind: 1 } };
		// The wire fields the CLI derives from that same branch.
		const head: GitGraphRowHead = {
			...createHead('main', id, true),
			upstream: {
				name: upstream.name,
				id: `${repoPath}|remotes/origin/main`,
				missing: false,
				state: upstream.state,
			},
			starred: true,
		};
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => id,
		);
		processor.processRow(
			createRow({ heads: [head] }),
			createMockContext({ branches: new Map([['main', branchWith(upstream, true)]]) }),
		);

		assert.strictEqual(serializeBranchRefContext(head, repoPath, { pinnedRefId: id }), hostContext(head.context));
	});

	test('a branch checked out in a secondary worktree', () => {
		const id = `${repoPath}|heads/feature-a`;
		const head: GitGraphRowHead = {
			...createHead('feature-a', id),
			worktree: { id: `${repoPath}|worktrees/wt`, path: '/wt', isDefault: false },
		};
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => undefined,
		);
		processor.processRow(
			createRow({ heads: [head] }),
			// The host's map deliberately excludes the main worktree; the wire's `isDefault: false` mirrors it.
			createMockContext({ worktreesByBranch: new Map([[id, { path: '/wt' }]]) as never }),
		);

		assert.strictEqual(serializeBranchRefContext(head, repoPath), hostContext(head.context));
	});

	test('a branch checked out in the default worktree', () => {
		const id = `${repoPath}|heads/main`;
		const head: GitGraphRowHead = {
			...createHead('main', id),
			worktree: { id: `${repoPath}|worktrees/main`, path: repoPath, isDefault: true },
		};
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => undefined,
		);
		processor.processRow(createRow({ heads: [head] }), createMockContext({ branchIdOfMainWorktree: id }));

		assert.strictEqual(serializeBranchRefContext(head, repoPath), hostContext(head.context));
	});

	test('a remote branch, starred and pinned', () => {
		const id = `${repoPath}|remotes/origin/main`;
		const remoteHead = { ...createRemoteHead('main', 'origin', id), starred: true };
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => id,
		);
		processor.processRow(
			createRow({ remotes: [remoteHead] }),
			createMockContext({ branches: new Map([['origin/main', branchWith(undefined, true)]]) }),
		);

		assert.strictEqual(
			serializeRemoteBranchRefContext(remoteHead, repoPath, { pinnedRefId: id }),
			hostContext(remoteHead.context),
		);
	});

	test('a tag', () => {
		const tag: GitGraphRowTag = { id: `${repoPath}|tags/v1.0.0`, name: 'v1.0.0', annotated: true };
		const processor = new GlGraphRowProcessor(
			createMockContainer(),
			uri => uri,
			() => undefined,
		);
		processor.processRow(createRow({ tags: [tag] }), createMockContext());

		assert.strictEqual(serializeTagRefContext(tag, repoPath), hostContext(tag.context));
	});
});
