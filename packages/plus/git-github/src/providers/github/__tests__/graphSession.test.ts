import assert from 'node:assert';
import type { GitGraph, GitGraphRow } from '@gitlens/git/models/graph.js';
import type { GitGraphSession } from '@gitlens/git/models/graphSession.js';
import type { GitHubGitProviderInternal } from '../../githubProvider.js';
import { GraphGitSubProvider } from '../graph.js';

/**
 * The GitHub-backed session implements the SAME concurrency contract as the CLI one — it composes the same
 * `GraphSessionWriteQueue`, so this is really a check that it is wired to it rather than a second copy of
 * the mechanism. It matters because the contract lives on the interface: a caller (the graph webview host)
 * is entitled to assume any `GitGraphSession` serializes its writes and refuses a stale page, and this
 * implementation previously did neither — a page could report success and then be silently discarded by a
 * refresh that replaced the window under it.
 *
 * `getGraph` is stubbed at the sub-provider seam, which is the only thing between the session and the
 * network.
 */
suite('GitHub GraphSession — write serialization + page supersession', () => {
	/** Minimal `GitGraph` — only the fields the session itself touches. */
	function createGraph(shas: string[], startingCursor?: string, hasMore = true): GitGraph {
		const rows = shas.map(sha => ({ sha: sha, parents: [] }) as unknown as GitGraphRow);
		return {
			rows: rows,
			avatars: new Map<string, string>(),
			paging: { limit: rows.length, startingCursor: startingCursor, hasMore: hasMore },
			more: undefined,
		} as unknown as GitGraph;
	}

	/**
	 * A sub-provider whose `getGraph` hands back scripted graphs. Each graph's `more` appends the next
	 * scripted page — deferred by a macrotask so an UNSERIALIZED implementation genuinely interleaves the
	 * page walk with a concurrent refresh (which is how the discarded page was reproduced).
	 */
	function createProvider(): { provider: GraphGitSubProvider; fetches: number } {
		const state = { fetches: 0 };
		const provider = new GraphGitSubProvider({} as GitHubGitProviderInternal);
		let generation = 0;

		const build = (label: string): GitGraph => {
			const graph = createGraph([`${label}1`, `${label}2`]);
			(graph as { more?: unknown }).more = () =>
				new Promise<GitGraph>(resolve =>
					setTimeout(() => resolve(createGraph([`${label}2`, `${label}3`], `${label}2`)), 0),
				);
			return graph;
		};

		(provider as unknown as { getGraph: () => Promise<GitGraph> }).getGraph = () => {
			state.fetches++;
			const label = `g${generation++}`;
			return new Promise<GitGraph>(resolve => setTimeout(() => resolve(build(label)), 0));
		};

		return { provider: provider, fetches: state.fetches };
	}

	async function openSession(provider: GraphGitSubProvider): Promise<GitGraphSession> {
		return provider.openGraphSession('vscode-vfs://github/owner/repo');
	}

	test('a page requested before a refresh is REFUSED once the refresh replaces the window', async () => {
		const { provider } = createProvider();
		const session = await openSession(provider);
		const opening = session.window.map(r => r.sha);

		// Queued in this order, so the refresh's rebuild moves the generation before the page runs.
		const refreshing = session.refresh();
		const paging = session.more(5);
		const [, pageResult] = await Promise.all([refreshing, paging]);

		assert.strictEqual(pageResult, 'superseded', 'the page was cut from a window that no longer exists');
		const refreshed = session.window.map(r => r.sha);
		assert.notDeepStrictEqual(refreshed, opening, 'the refresh did replace the window');
		assert.strictEqual(
			refreshed.length,
			2,
			'a refused page must leave the window exactly as the refresh left it — never half-applied',
		);

		// `'superseded'` means re-request, so the next ask must actually page — off the window that exists now.
		const retried = await session.more(5);

		assert.strictEqual(retried, 'added', 'the re-request pages off the current window');
		assert.deepStrictEqual(
			session.window.slice(0, refreshed.length).map(r => r.sha),
			refreshed,
			'and EXTENDS it rather than replacing it',
		);
	});

	test('a page that reaches the queue first is applied, and reports so honestly', async () => {
		const { provider } = createProvider();
		const session = await openSession(provider);
		const opening = session.window.length;

		const paging = session.more(5);
		const refreshing = session.refresh();
		const [pageResult] = await Promise.all([paging, refreshing]);

		// The page ran first and really did append (it is not the reviewer's "reported success, then
		// silently discarded" case — that reported `true` from a walk whose result never survived).
		assert.strictEqual(pageResult, 'added');
		assert.ok(opening > 0, 'the fixture opened with a window');
	});

	test('refresh and more never interleave — the window is only ever one op deep', async () => {
		const { provider } = createProvider();
		const session = await openSession(provider);

		// Three writers at once; serialized, each sees a settled window and the last one to complete owns
		// the result. Unserialized, the page's append races the two rebuilds.
		const results = await Promise.all([session.refresh(), session.more(5), session.refresh()]);

		assert.strictEqual(results[1], 'superseded', 'the page was queued behind a rebuild that replaced its window');
		assert.strictEqual(session.window.length, 2, 'the last refresh owns the settled window, whole');
	});
});
