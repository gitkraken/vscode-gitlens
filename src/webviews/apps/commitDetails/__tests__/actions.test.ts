import * as assert from 'assert';
import type { IssueOrPullRequest } from '@gitlens/git/models/issueOrPullRequest.js';
import type { GitCommitSearchContext } from '@gitlens/git/models/search.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { defer } from '@gitlens/utils/promise.js';
import type { Autolink } from '../../../../autolinks/models/autolinks.js';
import type { CommitDetails } from '../../../commitDetails/protocol.js';
import { InMemoryStorage } from '../../shared/host/storage.js';
import { createResource } from '../../shared/state/resource.js';
import type { CommitDetailsResources, ResolvedServices } from '../actions.js';
import { CommitDetailsActions } from '../actions.js';
import type { ExplainState } from '../state.js';
import { createCommitDetailsState } from '../state.js';

suite('CommitDetailsActions', () => {
	test('should explicitly fetch the navigated commit and clear stale search context', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());

		const actions = new CommitDetailsActions(state, {} as any, {} as any);

		// Seed the shared history with two viewed commits (the second is current). Recording flows
		// through the controller's onChange into the navigationStack signal, mirroring real fetches.
		(actions as any)._nav.record({ sha: 'abc1234', repoPath: '/repo' });
		(actions as any)._nav.record({ sha: 'def5678', repoPath: '/repo' });

		state.searchContext.set({
			query: { query: 'test' },
			queryFilters: { files: false, refs: false },
			matchedFiles: [],
			hiddenFromGraph: true,
		} satisfies GitCommitSearchContext);

		const fetches: Array<{ repoPath: string; sha: string; force: boolean | undefined }> = [];
		(actions as any).fetchCommit = async (repoPath: string, sha: string, options?: { force?: boolean }) => {
			fetches.push({ repoPath: repoPath, sha: sha, force: options?.force });
		};

		await actions.navigateBack();

		// Back moves to the older entry and force-fetches it; forward becomes available.
		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc1234', force: true }]);
		assert.strictEqual(state.searchContext.get(), undefined);
		assert.strictEqual(state.navigationStack.get().position, 1);
		assert.strictEqual(state.navigationStack.get().canForward, true);
	});

	test('should force a refetch when reloading the current commit after visibility restore', async () => {
		const state = createCommitDetailsState(new InMemoryStorage());
		state.currentCommit.set({ repoPath: '/repo', sha: 'abc123' } as any);

		const actions = new CommitDetailsActions(state, {} as any, {} as any);
		const fetches: Array<{ repoPath: string; sha: string; force: boolean | undefined }> = [];
		(actions as any).fetchCommit = async (repoPath: string, sha: string, options?: { force?: boolean }) => {
			fetches.push({ repoPath: repoPath, sha: sha, force: options?.force });
		};

		await actions.refetchCurrentCommit();

		assert.deepStrictEqual(fetches, [{ repoPath: '/repo', sha: 'abc123', force: true }]);
	});
});

suite('CommitDetailsActions autolinks setting', () => {
	const basicMessage = 'basic formatted';
	const enrichedMessage = 'enriched formatted';
	const basicAutolinks = [{ id: '1' }] as unknown as Autolink[];
	const enrichedIssues = [{ id: '1', title: 'Issue 1' }] as unknown as IssueOrPullRequest[];

	function makeCommit(repoPath: string, sha: string): CommitDetails {
		return {
			repoPath: repoPath,
			sha: sha,
			message: `message for ${sha}`,
			author: { name: 'A', email: 'a@example.com', avatar: undefined },
			committer: { name: 'A', email: 'a@example.com', avatar: undefined },
			files: [],
		} as unknown as CommitDetails;
	}

	/** Values in the order `fetchPreferences` requests them from `config.getMany`. */
	function prefsConfig(autolinksEnabled: boolean, currentUserNameStyle: string = 'you'): unknown[] {
		return [true, currentUserNameStyle, undefined, undefined, undefined, false, autolinksEnabled, 'stage'];
	}

	function flush(): Promise<void> {
		return new Promise<void>(resolve => setTimeout(resolve, 0));
	}

	/** Real state, real `CommitDetailsActions`, real resources over fake fetchers, fake services. Each
	 *  handler is swappable per test so deferred promises can hold any leg open. */
	function createHarness() {
		const state = createCommitDetailsState(new InMemoryStorage());
		const calls = {
			configGet: 0,
			getMany: 0,
			commitFetches: [] as string[],
			basicAutolinks: [] as string[],
			enrichedAutolinks: [] as string[],
		};
		const handlers = {
			configGet: (): Promise<boolean> => Promise.resolve(false),
			getMany: (): Promise<unknown[]> => Promise.resolve(prefsConfig(false)),
			fetchCommit: (repoPath: string, sha: string): Promise<CommitDetails | undefined> =>
				Promise.resolve(makeCommit(repoPath, sha)),
		};

		const services = {
			config: {
				get: () => {
					calls.configGet++;
					return handlers.configGet();
				},
				getMany: () => {
					calls.getMany++;
					return handlers.getMany();
				},
				getManyCore: () => Promise.resolve([undefined, undefined, undefined, undefined]),
			},
			storage: { getWorkspace: () => Promise.resolve(undefined) },
			ai: { isEnabled: () => Promise.resolve(false) },
			autolinks: {
				getCommitAutolinks: (_repoPath: string, sha: string) => {
					calls.basicAutolinks.push(sha);
					return Promise.resolve({ autolinks: basicAutolinks, formattedMessage: basicMessage });
				},
				getEnrichedAutolinks: (_repoPath: string, sha: string) => {
					calls.enrichedAutolinks.push(sha);
					return Promise.resolve({ autolinkedIssues: enrichedIssues, formattedMessage: enrichedMessage });
				},
			},
			pullRequests: { getPullRequestForCommit: () => Promise.resolve(undefined) },
			repository: {
				getCommitSignature: () => Promise.resolve(undefined),
				getCommitAvatars: () => Promise.resolve(undefined),
				getReachableFromOtherWorktrees: () => Promise.resolve(false),
				hasRemotes: () => Promise.resolve(false),
			},
		} as unknown as ResolvedServices;

		const resources: CommitDetailsResources = {
			commit: createResource<CommitDetails | undefined, [string, string]>((_signal, repoPath, sha) => {
				calls.commitFetches.push(sha);
				return handlers.fetchCommit(repoPath, sha);
			}),
			reachability: createResource<GitCommitReachability | undefined>(async () => undefined),
			explain: createResource<ExplainState | undefined, [string | undefined]>(async () => undefined),
		};

		const actions = new CommitDetailsActions(state, services, resources);
		return { state: state, actions: actions, resources: resources, calls: calls, handlers: handlers };
	}

	test('autolinks the first commit when the setting resolves true after fetchCommit starts', async () => {
		const h = createHarness();
		const setting = defer<boolean>();
		h.handlers.configGet = () => setting.promise;

		const fetching = h.actions.fetchCommit('/repo', 'abc');
		await flush();
		// Gated on the setting — the commit isn't requested until it resolves.
		assert.deepStrictEqual(h.calls.commitFetches, []);

		setting.fulfill(true);
		await fetching;
		await flush();

		assert.strictEqual(h.state.capabilities.autolinksEnabled, true);
		assert.deepStrictEqual(h.calls.basicAutolinks, ['abc']);
		assert.deepStrictEqual(h.calls.enrichedAutolinks, ['abc']);
		assert.deepStrictEqual(h.state.autolinks.get(), basicAutolinks);
		assert.deepStrictEqual(h.state.autolinkedIssues.get(), enrichedIssues);
		assert.strictEqual(h.state.formattedMessage.get(), enrichedMessage);
	});

	test('skips autolinks for the first commit when the setting resolves false', async () => {
		const h = createHarness();
		const setting = defer<boolean>();
		h.handlers.configGet = () => setting.promise;

		const fetching = h.actions.fetchCommit('/repo', 'abc');
		await flush();
		setting.fulfill(false);
		await fetching;
		await flush();

		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
		assert.deepStrictEqual(h.calls.commitFetches, ['abc']);
		assert.deepStrictEqual(h.calls.basicAutolinks, []);
		assert.deepStrictEqual(h.calls.enrichedAutolinks, []);
		assert.strictEqual(h.state.formattedMessage.get(), undefined);
	});

	test('keeps preferences and their flag when they resolve after the setting load', async () => {
		const h = createHarness();
		const setting = defer<boolean>();
		const prefs = defer<unknown[]>();
		h.handlers.configGet = () => setting.promise;
		h.handlers.getMany = () => prefs.promise;

		const preferencesFetch = h.actions.fetchPreferences();
		const fetching = h.actions.fetchCommit('/repo', 'abc');
		await flush();

		setting.fulfill(true);
		await fetching;
		await flush();
		assert.strictEqual(h.state.capabilities.autolinksEnabled, true);

		prefs.fulfill(prefsConfig(false));
		await preferencesFetch;
		await flush();

		assert.notStrictEqual(h.state.preferences.get(), undefined);
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
	});

	test('does not let a later setting load override an already-applied preferences flag', async () => {
		const h = createHarness();
		const setting = defer<boolean>();
		h.handlers.configGet = () => setting.promise;
		h.handlers.getMany = () => Promise.resolve(prefsConfig(false));

		const fetching = h.actions.fetchCommit('/repo', 'abc');
		await h.actions.fetchPreferences();
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);

		setting.fulfill(true);
		await fetching;
		await flush();

		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
		assert.deepStrictEqual(h.calls.basicAutolinks, []);
		assert.deepStrictEqual(h.calls.enrichedAutolinks, []);
	});

	test('applies only the latest of overlapping preferences fetches', async () => {
		const h = createHarness();
		const slow = defer<unknown[]>();
		const results = [slow.promise, Promise.resolve(prefsConfig(false, 'name'))];
		h.handlers.getMany = () => results.shift()!;

		const first = h.actions.fetchPreferences();
		const second = h.actions.fetchPreferences();
		await second;
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
		assert.strictEqual(h.state.preferences.get()?.currentUserNameStyle, 'name');

		slow.fulfill(prefsConfig(true, 'you'));
		await first;
		await flush();

		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
		assert.strictEqual(h.state.preferences.get()?.currentUserNameStyle, 'name');
	});

	test('a commit fetch in flight picks up a false -> true flip without an extra fetch', async () => {
		const h = createHarness();
		await h.actions.fetchCommit('/repo', 'aaa');
		await flush();
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);

		const pending = defer<CommitDetails | undefined>();
		h.handlers.fetchCommit = () => pending.promise;
		const fetching = h.actions.fetchCommit('/repo', 'bbb');
		await flush();
		assert.strictEqual(h.resources.commit.loading.get(), true);

		h.handlers.getMany = () => Promise.resolve(prefsConfig(true));
		await h.actions.fetchPreferences();
		assert.strictEqual(h.state.capabilities.autolinksEnabled, true);

		pending.fulfill(makeCommit('/repo', 'bbb'));
		await fetching;
		await flush();

		assert.deepStrictEqual(h.calls.commitFetches, ['aaa', 'bbb']);
		assert.deepStrictEqual(h.calls.basicAutolinks, ['bbb']);
		assert.deepStrictEqual(h.calls.enrichedAutolinks, ['bbb']);
		assert.strictEqual(h.state.formattedMessage.get(), enrichedMessage);
	});

	test('refetches an idle shown commit once on a false -> true flip, and never otherwise', async () => {
		const h = createHarness();
		await h.actions.fetchCommit('/repo', 'abc');
		await flush();
		assert.deepStrictEqual(h.calls.commitFetches, ['abc']);
		assert.deepStrictEqual(h.calls.basicAutolinks, []);

		h.handlers.getMany = () => Promise.resolve(prefsConfig(true));
		await h.actions.fetchPreferences();
		await flush();

		assert.deepStrictEqual(h.calls.commitFetches, ['abc', 'abc']);
		assert.deepStrictEqual(h.calls.basicAutolinks, ['abc']);
		assert.deepStrictEqual(h.calls.enrichedAutolinks, ['abc']);

		// true -> true
		await h.actions.fetchPreferences();
		await flush();
		assert.deepStrictEqual(h.calls.commitFetches, ['abc', 'abc']);

		// true -> false
		h.handlers.getMany = () => Promise.resolve(prefsConfig(false));
		await h.actions.fetchPreferences();
		await flush();
		assert.deepStrictEqual(h.calls.commitFetches, ['abc', 'abc']);
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
	});

	test('retries the setting load after a failed attempt', async () => {
		const h = createHarness();
		h.handlers.configGet = () => Promise.reject(new Error('config unavailable'));

		await h.actions.fetchCommit('/repo', 'abc');
		await flush();
		assert.strictEqual(h.calls.configGet, 1);
		assert.strictEqual(h.state.capabilities.autolinksEnabled, false);
		// The failed load doesn't block the commit itself.
		assert.deepStrictEqual(h.calls.commitFetches, ['abc']);

		h.handlers.configGet = () => Promise.resolve(true);
		await h.actions.fetchCommit('/repo', 'def');
		await flush();

		assert.strictEqual(h.calls.configGet, 2);
		assert.strictEqual(h.state.capabilities.autolinksEnabled, true);
		assert.deepStrictEqual(h.calls.basicAutolinks, ['def']);
	});
});
