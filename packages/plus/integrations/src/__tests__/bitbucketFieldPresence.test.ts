import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeableState } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence, getPullRequestFieldPresence } from '../fieldPresence.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { assertIssuePresence, assertPullRequestPresence } from './fieldPresenceHelpers.js';
import { connectedBitbucket, connectedBitbucketServer } from './sweepHelpers.js';

/**
 * Field presence must never call a group `fetched` that a row doesn't actually carry. So every Bitbucket read runs for
 * real — the integration, GitLens' own client, provider-apis and every conversion — against a server that answers at
 * the HTTP level with fixtures whose every value is non-empty: a description, a comment count, one reviewer who has
 * reviewed and one still requested. A `fetched` group that comes back undefined or empty is then a table that claims
 * more than the read delivers, and each documented placeholder is pinned to the value the row really carries.
 */

type Presence<G extends string> = Readonly<Record<G, FieldPresence>>;
type Json = Record<string, unknown>;

const allPullRequestProjections: readonly PullRequestProjection[] = [
	'point',
	'search',
	'search-summary',
	'text-search',
	'account',
	'account-summary',
	'repos',
	'repos-summary',
	'batch',
];
const allIssueProjections: readonly IssueProjection[] = ['point', 'search', 'account', 'repos', 'project', 'batch'];

const exercisedPullRequests = new Map<string, Set<PullRequestProjection>>();
const exercisedIssues = new Map<string, Set<IssueProjection>>();

function exercised<T>(map: Map<string, Set<T>>, providerId: string): Set<T> {
	let projections = map.get(providerId);
	if (projections == null) {
		projections = new Set();
		map.set(providerId, projections);
	}
	return projections;
}

/** Asserts a row's tag, that its presence never claims a group the row doesn't carry, and records the tag. */
function assertPullRequestRow(
	providerId: string,
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
	label: string = projection,
): { row: PullRequest; presence: Presence<PullRequestFieldGroup> } {
	const presence = assertPullRequestPresence(pr, projection, `${providerId} ${label}`);
	assert.equal(pr!.provider.id, providerId, `${label}: the row's provider`);
	exercised(exercisedPullRequests, providerId).add(projection);
	return { row: pr as PullRequest, presence: presence };
}

function assertIssueRow(
	providerId: string,
	issue: IssueShape | undefined,
	projection: IssueProjection,
): { row: IssueShape; presence: Presence<IssueFieldGroup> } {
	const presence = assertIssuePresence(issue, projection, `${providerId} ${projection}`);
	assert.equal(issue!.provider.id, providerId, `${projection}: the row's provider`);
	exercised(exercisedIssues, providerId).add(projection);
	return { row: issue!, presence: presence };
}

function json(body: unknown, status: number = 200, headers?: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status: status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

/** The requests a suite's server saw, and the ones it had no answer for. */
interface Served {
	readonly urls: URL[];
	readonly unrouted: string[];
}

/**
 * Serves every request with `route` (a body, or a response), recording each URL. The point reads go through the host's
 * cache, which these tests don't keep.
 */
function serve(runtime: FakeRuntime, route: (url: URL, init: RequestInit | undefined) => unknown): Served {
	const served: Served = { urls: [], unrouted: [] };
	runtime.http.fetch = (input, init) => {
		const url = new URL(input.toString());
		served.urls.push(url);

		const answer = route(url, init);
		if (answer === undefined) {
			served.unrouted.push(`${init?.method ?? 'GET'} ${url.pathname}${url.search}`);
			return Promise.resolve(json({ error: { message: 'unrouted' } }, 404));
		}
		return Promise.resolve(answer instanceof Response ? answer : json(answer));
	};
	runtime.cache.getPullRequest = (_id, _resource, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => loader({} as never).value;
	return served;
}

const createdOn = '2026-01-01T00:00:00Z';
const updatedOn = '2026-01-02T00:00:00Z';
const sha = 'a'.repeat(40);

// ---------------------------------------------------------------------------------------------------------------------
// Bitbucket Cloud
// ---------------------------------------------------------------------------------------------------------------------

const cloudId = GitCloudHostIntegrationId.Bitbucket;
const cloudRepo = { key: 'o/r', owner: 'o', name: 'r' };
const cloudRepos = [{ namespace: 'o', name: 'r' }];

function cloudUser(name: string): Json {
	return {
		type: 'user',
		uuid: `{${name}}`,
		display_name: name,
		nickname: name,
		account_id: `acct-${name}`,
		links: {
			avatar: { href: `https://avatars.example/${name}` },
			html: { href: `https://bitbucket.org/${name}` },
		},
	};
}

function cloudRepository(): Json {
	return {
		type: 'repository',
		uuid: '{repo}',
		name: 'r',
		slug: 'r',
		full_name: 'o/r',
		workspace: { type: 'workspace', uuid: '{ws}', name: 'o', slug: 'o' },
		project: { type: 'project', uuid: '{project}', key: 'P', name: 'Project' },
		mainbranch: { name: 'main' },
		parent: null,
		links: {
			html: { href: 'https://bitbucket.org/o/r' },
			clone: [
				{ name: 'https', href: 'https://bitbucket.org/o/r.git' },
				{ name: 'ssh', href: 'git@bitbucket.org:o/r.git' },
			],
		},
	};
}

/**
 * A pull request as Bitbucket Cloud answers it: a description, a comment count, one reviewer who has approved and one
 * who is still requested. `participated_on: null` is what makes a participant a pending request.
 */
function cloudPullRequest(id: number): Json {
	return {
		type: 'pullrequest',
		id: id,
		title: `PR ${id}`,
		description: 'Body',
		state: 'OPEN',
		comment_count: 5,
		task_count: 0,
		merge_commit: null,
		close_source_branch: false,
		closed_by: null,
		reason: '',
		author: cloudUser('me'),
		created_on: createdOn,
		updated_on: updatedOn,
		links: { html: { href: `https://bitbucket.org/o/r/pull-requests/${id}` } },
		destination: { repository: cloudRepository(), branch: { name: 'main' }, commit: { hash: 'base' } },
		source: { repository: cloudRepository(), branch: { name: 'feature' }, commit: { hash: 'head' } },
		reviewers: [cloudUser('approver'), cloudUser('requested')],
		participants: [
			{
				type: 'participant',
				user: cloudUser('approver'),
				role: 'REVIEWER',
				approved: true,
				state: 'approved',
				participated_on: updatedOn,
			},
			{
				type: 'participant',
				user: cloudUser('requested'),
				role: 'REVIEWER',
				approved: false,
				state: null,
				participated_on: null,
			},
		],
	};
}

/** A legacy Bitbucket Cloud issue, with an assignee and votes. */
function cloudIssue(): Json {
	return {
		type: 'issue',
		id: 1,
		title: 'Issue 1',
		reporter: cloudUser('me'),
		assignee: cloudUser('assignee'),
		state: 'open',
		created_on: createdOn,
		updated_on: updatedOn,
		repository: cloudRepository(),
		votes: 3,
		content: { raw: 'Body', markup: 'markdown', html: '<p>Body</p>' },
		links: { html: { href: 'https://bitbucket.org/o/r/issues/1' } },
	};
}

function cloudPage(values: unknown[]): Json {
	return { values: values, page: 1, pagelen: 50, size: values.length };
}

/**
 * Answers Bitbucket Cloud's REST API. The repository's pull request list answers pull request 2 to the reviewer slice
 * (a `reviewers.uuid` clause), so a row from that read is told apart from the authored one.
 */
function serveCloud(runtime: FakeRuntime): Served {
	return serve(runtime, url => {
		const path = decodeURIComponent(url.pathname).replace(/^\/2\.0/, '');
		const query = url.searchParams.get('q') ?? '';

		if (path === '/user') return cloudUser('me');
		if (path === '/user/workspaces') return cloudPage([{ workspace: { uuid: '{ws}', slug: 'o' } }]);
		if (path === '/workspaces/o/pullrequests/{me}') return cloudPage([cloudPullRequest(1)]);
		if (path === '/repositories/o') return cloudPage([cloudRepository()]);
		if (path === '/repositories/o/r/pullrequests') {
			return cloudPage([cloudPullRequest(query.includes('reviewers.uuid') ? 2 : 1)]);
		}
		if (path === '/repositories/o/r/pullrequests/1') return cloudPullRequest(1);
		if (/^\/repositories\/o\/r\/commit\/[0-9a-f]+\/pullrequests$/.test(path)) {
			return { values: [cloudPullRequest(1)] };
		}
		if (path === '/repositories/o/r/issues/1') return cloudIssue();
		if (path === '/repositories/o/r/issues') return cloudPage([cloudIssue()]);
		return undefined;
	});
}

async function connectedCloud(): Promise<{
	manager: Awaited<ReturnType<typeof connectedBitbucket>>['manager'];
	bb: GitHostIntegration;
	served: Served;
	runtime: FakeRuntime;
}> {
	const runtime = createFakeRuntime();
	const served = serveCloud(runtime);
	const { manager, integration } = await connectedBitbucket(runtime);
	return { manager: manager, bb: integration, served: served, runtime: runtime };
}

/** What every Bitbucket Cloud row says no matter which read produced it. */
function assertCloudPlaceholders(
	row: PullRequest,
	presence: Presence<PullRequestFieldGroup>,
	mergeableState: PullRequestMergeableState | undefined,
): void {
	// Neither converter reads whether Bitbucket can merge: provider-apis' says a literal Mergeable, and GitLens' own
	// leaves it unset.
	assert.equal(row.mergeableState, mergeableState);
	assert.equal(presence.mergeable, 'not-requested');
	// Bitbucket's review decision is derived from the participants, which ignores the repository's own approval rules.
	assert.ok(row.reviewDecision != null, 'a decision is derived from the participants');
	assert.equal(presence.reviewDecision, 'not-requested');
	assert.equal(row.assignees, undefined);
	assert.equal(presence.assignees, 'unavailable');
}

/** GitLens' own converter, which drops `comment_count`. */
function assertCloudOwnRow(row: PullRequest, presence: Presence<PullRequestFieldGroup>): void {
	assertCloudPlaceholders(row, presence, undefined);
	assert.equal(row.commentsCount, undefined);
	assert.equal(presence.comments, 'not-requested');
}

/** provider-apis' converter, which reads `comment_count` and every participant. */
function assertCloudProviderApisRow(row: PullRequest, presence: Presence<PullRequestFieldGroup>): void {
	assertCloudPlaceholders(row, presence, PullRequestMergeableState.Mergeable);
	assert.equal(row.commentsCount, 5);
	assert.equal(presence.comments, 'fetched');
	assert.equal(row.latestReviews?.length, 1);
	assert.equal(row.reviewRequests?.length, 1);
}

suite('Field presence: every Bitbucket Cloud read stamps its tag, and its table holds for the row it produces', () => {
	test('point reads: by number, for a branch and for a commit', async () => {
		const { manager, bb, served } = await connectedCloud();

		const byNumber = await bb.getPullRequest(cloudRepo, '1', { throwOnError: true });
		const forBranch = await bb.getPullRequestForBranch(cloudRepo, 'feature', { throwOnError: true });
		const forCommit = await bb.getPullRequestForCommit(cloudRepo, sha, { throwOnError: true });

		for (const pr of [byNumber, forBranch, forCommit]) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'point');
			assertCloudOwnRow(row, presence);
			// The commit read isn't known to bring the participants, so none of the three claims them.
			assert.equal(presence.reviews, 'not-requested');
			assert.equal(presence.reviewRequests, 'not-requested');
			// The access isn't read, so `fromBitbucketRepository` leaves it unset.
			assert.equal(row.repository.accessLevel, undefined);
			assert.equal(presence.access, 'not-requested');
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});

	test("the host's own searches: 'my pull requests' (authored, and with the reviewer slice) and the free-text search", async () => {
		const { manager, bb, served, runtime } = await connectedCloud();

		const authored = await bb.searchMyPullRequests();
		assert.equal(authored?.error, undefined);
		assert.deepEqual(
			authored?.value?.map(pr => pr.id),
			['1'],
		);

		// The reviewer slice reads the open repositories, whichever of them this integration owns.
		runtime.repositories.getOpenRemotes = () =>
			Promise.resolve([{ provider: { owner: 'o', repoName: 'r' } } as unknown as GitRemote]);
		(
			bb as unknown as { authenticationService: { getByRemote: (remote: GitRemote) => Promise<unknown> } }
		).authenticationService.getByRemote = () => Promise.resolve(bb);
		const withReviewer = await bb.searchMyPullRequests(undefined, undefined, { includeReviewRequested: true });
		assert.equal(withReviewer?.error, undefined);
		assert.deepEqual(
			withReviewer?.value?.map(pr => pr.id),
			['1', '2'],
			'the reviewer read adds its own pull request',
		);
		assert.ok(
			served.urls.some(url => url.searchParams.get('q')?.includes('reviewers.uuid')),
			'the reviewer read ran',
		);

		for (const pr of [...(authored?.value ?? []), ...(withReviewer?.value ?? [])]) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'search');
			assertCloudProviderApisRow(row, presence);
		}

		const searched = await bb.searchPullRequests('crash', cloudRepo);
		assert.ok(searched?.length);
		for (const pr of searched) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'text-search');
			assertCloudProviderApisRow(row, presence);
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});

	test('the account-wide list and sweeps', async () => {
		const { manager, served } = await connectedCloud();

		const listed = await manager.listPullRequestsPage({ providerId: cloudId });
		const swept = await manager.sweepPullRequests({ providerIds: [cloudId] });
		// Opted in to the reviewer slice, whose rows carry the same tag as the authored ones.
		const withReviewer = await manager.sweepPullRequests({ providerIds: [cloudId], includeReviewRequested: true });
		const sweptWithReviews = await manager.sweepPullRequests({ providerIds: [cloudId], includeReviews: true });

		assert.deepEqual(
			withReviewer.items.map(pr => pr.id),
			['1', '2'],
		);
		for (const pr of [...listed.items, ...swept.items, ...withReviewer.items]) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'account-summary');
			assertCloudProviderApisRow(row, presence);
		}
		assert.ok(sweptWithReviews.items.length > 0);
		for (const pr of sweptWithReviews.items) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'account');
			assertCloudProviderApisRow(row, presence);
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});

	test('the repository-scoped list and sweep', async () => {
		const { manager, served } = await connectedCloud();

		const listed = await manager.listPullRequestsPage({ providerId: cloudId, repos: cloudRepos });
		const summary = await manager.listPullRequestsPage({ providerId: cloudId, repos: cloudRepos, summary: true });
		const swept = await manager.sweepPullRequests({ providerIds: [cloudId], repos: cloudRepos });

		assert.ok(listed.items.length > 0 && summary.items.length > 0 && swept.items.length > 0);
		for (const pr of [...listed.items, ...swept.items]) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'repos');
			assertCloudProviderApisRow(row, presence);
		}
		// Bitbucket has no lightweight projection: a summary row reads like the full one.
		for (const pr of summary.items) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'repos-summary');
			assertCloudProviderApisRow(row, presence);
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});

	test('the batch and branch reads, through GitLens’ own client', async () => {
		const { manager, served } = await connectedCloud();

		const batch = await manager.getPullRequestsBatch({
			providerId: cloudId,
			targets: [{ key: 'pr', owner: 'o', repo: 'r', number: 1 }],
		});
		const branches = await manager.getPullRequestsForBranches({
			providerId: cloudId,
			targets: [{ key: 'branch', owner: 'o', repo: 'r', branch: 'feature' }],
		});

		const rows = [batch.items[0]?.pullRequest, branches.items[0]?.pullRequests[0]];
		assert.equal(rows.length, 2);
		for (const pr of rows) {
			const { row, presence } = assertPullRequestRow(cloudId, pr, 'batch');
			assertCloudOwnRow(row, presence);
			// Both read the participants, unlike the commit read.
			assert.equal(presence.reviews, 'fetched');
			assert.equal(presence.reviewRequests, 'fetched');
			assert.equal(row.latestReviews?.length, 1);
			assert.equal(row.reviewRequests?.length, 1);
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});

	test("issue reads: the host's own point read and 'my issues'", async () => {
		const { manager, bb, served } = await connectedCloud();

		const point = await bb.getIssue(cloudRepo, '1');
		const mine = await bb.searchMyIssues(cloudRepo);

		assert.equal(mine?.length, 1);
		for (const [issue, projection] of [
			[point, 'point'],
			[mine?.[0], 'account'],
		] as const) {
			const { row, presence } = assertIssueRow(cloudId, issue, projection);
			// The repository's access isn't read, so it is unset.
			assert.equal(row.repository?.accessLevel, undefined);
			assert.equal(presence.access, 'not-requested');
			// The votes land in the upvote count, which isn't a reaction count.
			assert.equal(row.thumbsUpCount, 3);
			assert.equal(presence.reactions, 'unavailable');
			assert.equal(row.labels, undefined);
			assert.equal(presence.labels, 'unavailable');
			assert.equal(row.commentsCount, undefined);
			assert.equal(presence.comments, 'not-requested');
		}
		assert.deepEqual(served.unrouted, []);

		manager.dispose();
	});
});

// ---------------------------------------------------------------------------------------------------------------------
// Bitbucket Data Center
// ---------------------------------------------------------------------------------------------------------------------

const serverId = GitSelfManagedHostIntegrationId.BitbucketServer;
const serverRepo = { key: 'PRJ/repo', owner: 'PRJ', name: 'repo' };
const serverRepos = [{ namespace: 'PRJ', name: 'repo' }];

const serverUserIds: Record<string, number> = { me: 1, approver: 2, requested: 3 };

function serverUser(name: string): Json {
	return {
		id: serverUserIds[name],
		name: name,
		slug: name,
		displayName: name,
		emailAddress: `${name}@example.test`,
		active: true,
		type: 'NORMAL',
		links: { self: [{ href: `https://bbs.example.com/users/${name}` }] },
	};
}

function serverRepository(): Json {
	return {
		id: 1,
		slug: 'repo',
		name: 'repo',
		project: { key: 'PRJ' },
		archived: false,
		links: {
			self: [{ href: 'https://bbs.example.com/projects/PRJ/repos/repo/browse' }],
			clone: [
				{ name: 'http', href: 'https://bbs.example.com/scm/PRJ/repo.git' },
				{ name: 'ssh', href: 'ssh://git@bbs.example.com/PRJ/repo.git' },
			],
		},
	};
}

/**
 * A pull request as Bitbucket Data Center answers it: a description, a comment count, one reviewer who has approved
 * and one who hasn't.
 */
function serverPullRequest(id: number): Json {
	const participant = (name: string, status: 'APPROVED' | 'UNAPPROVED', role: string) => ({
		user: serverUser(name),
		role: role,
		status: status,
		approved: status === 'APPROVED',
	});
	return {
		id: id,
		version: 3,
		title: `Pull request ${id}`,
		description: 'Body',
		state: 'OPEN',
		open: true,
		closed: false,
		createdDate: 1_000,
		updatedDate: 2_000,
		closedDate: null,
		fromRef: {
			id: 'refs/heads/feature',
			displayId: 'feature',
			latestCommit: 'head',
			repository: serverRepository(),
		},
		toRef: { id: 'refs/heads/main', displayId: 'main', latestCommit: 'base', repository: serverRepository() },
		locked: false,
		author: participant('me', 'UNAPPROVED', 'AUTHOR'),
		reviewers: [
			participant('approver', 'APPROVED', 'REVIEWER'),
			participant('requested', 'UNAPPROVED', 'REVIEWER'),
		],
		participants: [participant('approver', 'APPROVED', 'PARTICIPANT')],
		properties: { commentCount: 5, openTaskCount: 0, resolvedTaskCount: 0 },
		links: { self: [{ href: `https://bbs.example.com/projects/PRJ/repos/repo/pull-requests/${id}` }] },
	};
}

/** A page the way Bitbucket Data Center pages: echoing the offset it was asked for, and never another page. */
function serverPage(url: URL, values: unknown[]): Json {
	return {
		values: values,
		size: values.length,
		limit: Number(url.searchParams.get('limit') ?? 25),
		start: Number(url.searchParams.get('start') ?? 0),
		isLastPage: true,
	};
}

function serveServer(runtime: FakeRuntime): Served {
	return serve(runtime, url => {
		const path = url.pathname.replace(/^.*\/rest\/api\/1\.0/, '');

		// Both of the SDK's current-user requests: the one that names the user, and the one that looks them up.
		if (path === '/users') {
			return json({ values: [serverUser('me')] }, 200, { 'x-auserid': '1', 'x-ausername': 'me' });
		}
		if (path === '/projects/PRJ/repos/repo/pull-requests/1') return serverPullRequest(1);
		if (path === '/projects/PRJ/repos/repo/pull-requests' || path === '/dashboard/pull-requests') {
			return serverPage(url, [serverPullRequest(1)]);
		}
		if (/^\/projects\/PRJ\/repos\/repo\/commits\/[0-9a-f]+\/pull-requests$/.test(path)) {
			return { values: [serverPullRequest(1)] };
		}
		return undefined;
	});
}

async function connectedServer(): Promise<{
	manager: Awaited<ReturnType<typeof connectedBitbucketServer>>['manager'];
	bbs: GitHostIntegration;
	served: Served;
}> {
	const runtime = createFakeRuntime();
	const served = serveServer(runtime);
	const { manager, integration } = await connectedBitbucketServer(runtime);
	return { manager: manager, bbs: integration, served: served };
}

/** What every Bitbucket Data Center row says no matter which read produced it. */
function assertServerRow(
	row: PullRequest,
	presence: Presence<PullRequestFieldGroup>,
	mergeableState: PullRequestMergeableState | undefined,
): void {
	// Neither converter reads whether the server can merge: provider-apis says a literal Mergeable, and GitLens' own
	// converter leaves it unset.
	assert.equal(row.mergeableState, mergeableState);
	assert.equal(presence.mergeable, 'not-requested');
	// Derived from the reviewers' states, which ignores the repository's own approval rules.
	assert.ok(row.reviewDecision != null, 'a decision is derived from the reviewers');
	assert.equal(presence.reviewDecision, 'not-requested');
	assert.equal(row.assignees, undefined);
	assert.equal(presence.assignees, 'unavailable');
	assert.equal(row.thumbsUpCount, undefined);
	assert.equal(presence.reactions, 'unavailable');
	assert.equal(row.commentsCount, 5);
	assert.equal(presence.comments, 'fetched');
	assert.equal(row.latestReviews?.length, 1);
	assert.equal(row.reviewRequests?.length, 1);
}

/** GitLens' own normalizer, which leaves the mergeability unset. */
function assertServerOwnRow(row: PullRequest, presence: Presence<PullRequestFieldGroup>): void {
	assertServerRow(row, presence, undefined);
}

/** provider-apis' normalizer, whose literal is "MERGEABLE". */
function assertServerProviderApisRow(row: PullRequest, presence: Presence<PullRequestFieldGroup>): void {
	assertServerRow(row, presence, PullRequestMergeableState.Mergeable);
}

suite(
	'Field presence: every Bitbucket Data Center read stamps its tag, and its table holds for the row it produces',
	() => {
		test('point reads: by number, for a branch and for a commit', async () => {
			const { manager, bbs, served } = await connectedServer();

			const byNumber = await bbs.getPullRequest(serverRepo, '1', { throwOnError: true });
			const forBranch = await bbs.getPullRequestForBranch(serverRepo, 'feature', { throwOnError: true });
			const forCommit = await bbs.getPullRequestForCommit(serverRepo, sha, { throwOnError: true });

			for (const pr of [byNumber, forBranch, forCommit]) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'point');
				assertServerOwnRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});

		test("the host's own searches: 'my pull requests' and the free-text search", async () => {
			const { manager, bbs, served } = await connectedServer();

			const mine = await bbs.searchMyPullRequests();
			const searched = await bbs.searchPullRequests('request', serverRepo);

			assert.equal(mine?.error, undefined);
			assert.ok(mine?.value?.length);
			for (const pr of mine.value) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'search');
				assertServerProviderApisRow(row, presence);
			}
			assert.ok(searched?.length);
			for (const pr of searched) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'text-search');
				assertServerProviderApisRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});

		test('the filtered search, full and summary', async () => {
			const { manager, served } = await connectedServer();

			const full = await manager.searchPullRequestsPage({ providerId: serverId, repos: serverRepos });
			const summary = await manager.searchPullRequestsPage({
				providerId: serverId,
				repos: serverRepos,
				summary: true,
			});

			assert.equal(full.fetchFailed, undefined, full.warnings[0]?.message);
			assert.equal(summary.fetchFailed, undefined, summary.warnings[0]?.message);
			assert.ok(full.items.length > 0 && summary.items.length > 0);
			// The module's own requests, mapped by GitLens' own normalizer.
			for (const pr of full.items) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'search');
				assertServerOwnRow(row, presence);
			}
			// Bitbucket Data Center has no lightweight projection: a summary row reads like the full one.
			for (const pr of summary.items) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'search-summary');
				assertServerOwnRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});

		test('the account-wide list and sweeps', async () => {
			const { manager, served } = await connectedServer();

			const listed = await manager.listPullRequestsPage({ providerId: serverId });
			const swept = await manager.sweepPullRequests({ providerIds: [serverId] });
			const sweptWithReviews = await manager.sweepPullRequests({ providerIds: [serverId], includeReviews: true });

			assert.ok(listed.items.length > 0 && swept.items.length > 0 && sweptWithReviews.items.length > 0);
			for (const pr of [...listed.items, ...swept.items]) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'account-summary');
				assertServerProviderApisRow(row, presence);
			}
			for (const pr of sweptWithReviews.items) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'account');
				assertServerProviderApisRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});

		test('the repository-scoped list and sweep', async () => {
			const { manager, served } = await connectedServer();

			const listed = await manager.listPullRequestsPage({ providerId: serverId, repos: serverRepos });
			const summary = await manager.listPullRequestsPage({
				providerId: serverId,
				repos: serverRepos,
				summary: true,
			});
			const swept = await manager.sweepPullRequests({ providerIds: [serverId], repos: serverRepos });

			assert.ok(listed.items.length > 0 && summary.items.length > 0 && swept.items.length > 0);
			for (const pr of [...listed.items, ...swept.items]) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'repos');
				assertServerProviderApisRow(row, presence);
			}
			for (const pr of summary.items) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'repos-summary');
				assertServerProviderApisRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});

		test('the batch and branch reads, through GitLens’ own client', async () => {
			const { manager, served } = await connectedServer();

			const batch = await manager.getPullRequestsBatch({
				providerId: serverId,
				targets: [{ key: 'pr', owner: 'PRJ', repo: 'repo', number: 1 }],
			});
			const branches = await manager.getPullRequestsForBranches({
				providerId: serverId,
				targets: [{ key: 'branch', owner: 'PRJ', repo: 'repo', branch: 'feature' }],
			});

			const rows = [batch.items[0]?.pullRequest, branches.items[0]?.pullRequests[0]];
			assert.equal(rows.length, 2);
			for (const pr of rows) {
				const { row, presence } = assertPullRequestRow(serverId, pr, 'batch');
				assertServerOwnRow(row, presence);
			}
			assert.deepEqual(served.unrouted, []);

			manager.dispose();
		});
	},
);

suite('Field presence: every Bitbucket projection with a table was exercised above', () => {
	test('for pull requests and issues, on both hosts', () => {
		for (const providerId of [cloudId, serverId]) {
			const tabledPullRequests = allPullRequestProjections.filter(
				projection =>
					getPullRequestFieldPresence({
						provider: { id: providerId },
						projection: projection,
					} as unknown as PullRequestShape) != null,
			);
			assert.deepEqual(
				[...(exercisedPullRequests.get(providerId) ?? [])].sort(),
				[...tabledPullRequests].sort(),
				`${providerId}: pull request projections`,
			);

			const tabledIssues = allIssueProjections.filter(
				projection =>
					getIssueFieldPresence({
						provider: { id: providerId },
						projection: projection,
					} as unknown as IssueShape) != null,
			);
			assert.deepEqual(
				[...(exercisedIssues.get(providerId) ?? [])].sort(),
				[...tabledIssues].sort(),
				`${providerId}: issue projections`,
			);
		}
	});
});
