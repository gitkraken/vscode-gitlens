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
		kind: 'commit',
		...overrides,
	};
}

function createHead(name: string, id: string, isCurrentHead = false): GitGraphRowHead {
	return { name: name, id: id, isCurrentHead: isCurrentHead };
}

function createRemoteHead(name: string, owner: string, id: string): GitGraphRowRemoteHead {
	return { name: name, owner: owner, id: id };
}

suite('GlGraphRowProcessor', () => {
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
			const row = createRow({ kind: 'stash' });
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
