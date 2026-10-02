import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suite, test } from 'mocha';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import { RepositoryAccessLevel } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { serializeIssue } from '@gitlens/git/utils/issue.utils.js';
import { serializePullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence, getPullRequestFieldPresence } from '../fieldPresence.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { PagingMode } from '../providers/models.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { assertIssuePresence, assertPullRequestPresence } from './fieldPresenceHelpers.js';
import type { GitHubPullRequestFixture } from './githubFixtures.js';
import { gitHubPullRequest } from './githubFixtures.js';
import { connectedGitHub, connectedGitLab, providerPr, stubApi } from './sweepHelpers.js';

/**
 * Field presence must never call a group `fetched` that a row doesn't actually carry. So every GitHub read runs for
 * real — the integration, its conversions and provider-apis' own normalizer — against a server that answers each
 * request with ONLY the fields that request selected, every one of them non-empty. A `fetched` group that comes back
 * undefined or empty is then a table that claims more than the read delivers.
 */

type Node = Record<string, unknown>;

/** Every pull request tag GitHub produces. */
const pullRequestProjections: readonly PullRequestProjection[] = [
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
/** Every issue tag GitHub produces: it has no tracker projects. */
const issueProjections: readonly IssueProjection[] = ['point', 'search', 'account', 'repos', 'batch'];

const createdAt = '2026-01-01T00:00:00Z';
const updatedAt = '2026-01-02T00:00:00Z';
const member = { login: 'octo', avatarUrl: 'https://avatars.example/octo', url: 'https://github.com/octo' };
const reviewer = {
	login: 'reviewer',
	avatarUrl: 'https://avatars.example/reviewer',
	url: 'https://github.com/reviewer',
};
const repository = {
	isFork: false,
	name: 'r',
	owner: { login: 'o' },
	sshUrl: 'git@github.com:o/r.git',
	url: 'https://github.com/o/r',
};

/**
 * Every field GitLens' own full and stack fragments select. `viewerPermission: READ` and `viewerCanUpdate: false` are
 * values a hardcoded or rebuilt viewer would lose, and the code-owner request is one a lossy conversion would flatten.
 */
function nativePullRequestNode(): GitHubPullRequestFixture {
	return gitHubPullRequest(
		1,
		{
			id: 'PR_1',
			body: 'Body',
			updatedAt: updatedAt,
			author: member,
			headRepository: repository,
			repository: { ...repository, viewerPermission: 'READ' },
			stack: { id: 'S_1', number: 7, size: 2, baseRefName: 'main' },
			stackEntry: { position: 1 },
			additions: 3,
			assignees: { nodes: [member] },
			changedFiles: 2,
			deletions: 1,
			latestReviews: { nodes: [{ id: 'R_1', author: reviewer, state: 'APPROVED', commit: { oid: 'head' } }] },
			reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: reviewer }] },
			commits: { totalCount: 4, nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
			totalCommentsCount: 5,
			viewerCanUpdate: false,
			headRepositoryOwner: { login: 'o' },
		},
		{ owner: 'o', name: 'r' },
	);
}

/** The fields only the full fragment selects, beyond the lite one. */
const fullOnlyPullRequestFields = [
	'additions',
	'assignees',
	'changedFiles',
	'checksUrl',
	'deletions',
	'mergeable',
	'mergedBy',
	'reviewDecision',
	'latestReviews',
	'viewerLatestReview',
	'reviewRequests',
	'commits',
	'totalCommentsCount',
	'viewerCanUpdate',
];

/** {@link nativePullRequestNode}, cut down to what `query` selected. */
function selectNativePullRequest(query: string): Node {
	const unselected = [
		...(query.includes('totalCommentsCount') ? [] : fullOnlyPullRequestFields),
		...(query.includes('stackEntry') ? [] : ['stack', 'stackEntry']),
	];
	return Object.fromEntries(Object.entries(nativePullRequestNode()).filter(([field]) => !unselected.includes(field)));
}

function sdkAccount(login: string): Node {
	return {
		__typename: 'User',
		id: `U_${login}`,
		databaseId: 1,
		name: login,
		login: login,
		avatarUrl: `https://avatars.example/${login}`,
		url: `https://github.com/${login}`,
	};
}

/**
 * Every field provider-apis' own pull request fragment selects. It carries a code-owner request and a dismissed
 * review, which its normalizer drops.
 */
function selectSdkPullRequest(query: string): Node {
	const node: Node = {
		id: 'PR_1',
		fullDatabaseId: '101',
		number: 1,
		title: 'PR 1',
		body: 'Body',
		state: 'OPEN',
		author: sdkAccount('octo'),
		commits: {
			totalCount: 4,
			nodes: [
				{
					commit: {
						statusCheckRollup: {
							contexts: {
								nodes: [
									{
										context: 'ci',
										createdAt: createdAt,
										description: '',
										state: 'SUCCESS',
										targetUrl: '',
									},
								],
							},
						},
					},
				},
			],
		},
		baseRef: { name: 'main', target: { oid: 'base' } },
		headRef: { name: 'feature', target: { oid: 'head' } },
		repository: { ...repository, id: 'R_1', databaseId: 1, viewerPermission: 'READ' },
		headRepository: { ...repository, id: 'R_1', databaseId: 1 },
		isDraft: false,
		url: 'https://github.com/o/r/pull/1',
		createdAt: createdAt,
		comments: { totalCount: 5 },
		reactions: { totalCount: 2 },
		updatedAt: updatedAt,
		closedAt: null,
		mergedAt: null,
		assignees: { nodes: [sdkAccount('octo')] },
		reviewRequests: { nodes: [{ asCodeOwner: true, requestedReviewer: sdkAccount('reviewer') }] },
		latestReviews: { nodes: [{ author: sdkAccount('reviewer'), state: 'DISMISSED' }] },
		additions: 3,
		deletions: 1,
		changedFiles: 2,
		mergeable: 'MERGEABLE',
		mergeStateStatus: 'CLEAN',
		milestone: null,
		labels: { nodes: [] },
		viewerCanMergeAsAdmin: false,
	};
	if (!/\bcommits\(/.test(query)) {
		delete node.commits;
	}
	return node;
}

/** Every field GitLens' own issue fragment selects, the body only when asked for. */
function selectNativeIssue(query: string): Node {
	const node: Node = {
		id: 'I_1',
		number: 1,
		title: 'Issue 1',
		url: 'https://github.com/o/r/issues/1',
		state: 'OPEN',
		closed: false,
		createdAt: createdAt,
		updatedAt: updatedAt,
		closedAt: null,
		author: member,
		assignees: { nodes: [member] },
		comments: { totalCount: 5 },
		labels: { nodes: [{ color: 'ff0000', name: 'bug' }] },
		reactions: { totalCount: 2 },
		repository: { name: 'r', owner: { login: 'o' }, viewerPermission: 'READ', url: 'https://github.com/o/r' },
		body: 'Body',
	};
	if (!/\bbody\b/.test(query)) {
		delete node.body;
	}
	return node;
}

/** Every field provider-apis' own issue fragment selects. */
function sdkIssue(): Node {
	return {
		id: 'I_1',
		fullDatabaseId: '201',
		title: 'Issue 1',
		author: sdkAccount('octo'),
		closedAt: null,
		createdAt: createdAt,
		number: 1,
		updatedAt: updatedAt,
		url: 'https://github.com/o/r/issues/1',
		reactions: { totalCount: 2 },
		repository: { databaseId: 1, id: 'R_1', name: 'r', owner: { login: 'o' } },
		comments: { totalCount: 5 },
		assignees: { nodes: [sdkAccount('octo')] },
		state: 'OPEN',
		milestone: null,
		labels: { nodes: [{ color: 'ff0000', description: '', id: 'L_1', name: 'bug' }] },
	};
}

function searchConnection(nodes: Node[]): Node {
	return { issueCount: nodes.length, pageInfo: { endCursor: null, hasNextPage: false }, nodes: nodes };
}

/** The data each operation answers with, built from what its query selected. */
function answer(operation: string, query: string, variables: Record<string, unknown>): Node {
	const keyed = (prefix: string, value: (name: string) => Node): Node =>
		Object.fromEntries(
			Object.keys(variables)
				.map(name => /^[kh](\d+)$/.exec(name)?.[1])
				.filter((i): i is string => i != null)
				.map(i => [`${prefix}${i}`, value(i)]),
		);
	const aliasesIncluded = (): string[] =>
		Object.keys(variables)
			.filter(name => name.startsWith('include') && variables[name] === true)
			.map(name => `${name.charAt(7).toLowerCase()}${name.slice(8)}`);

	switch (operation) {
		case 'rateLimit':
			return { rateLimit: { __typename: 'RateLimit' } };
		case 'SearchIssuesOrPullRequests':
			return {
				search: searchConnection([
					query.includes('... on PullRequest') ? selectSdkPullRequest(query) : sdkIssue(),
				]),
			};
		case 'getPullRequest':
			return { repository: { pullRequest: selectNativePullRequest(query) } };
		case 'getPullRequestForBranch':
			return { repository: { ref: { associatedPullRequests: { nodes: [selectNativePullRequest(query)] } } } };
		case 'getPullRequestForCommit':
			return { repository: { object: { associatedPullRequests: { nodes: [selectNativePullRequest(query)] } } } };
		case 'searchMyPullRequests':
			return { search: searchConnection([selectNativePullRequest(query)]) };
		case 'searchPullRequestsPage':
			return Object.fromEntries(
				aliasesIncluded().map(alias => [alias, searchConnection([selectNativePullRequest(query)])]),
			);
		case 'searchPullRequests':
			return Object.fromEntries(
				Object.keys(variables)
					.filter(name => name.endsWith('SearchQuery') || name === 'searchQuery')
					.map(name => [
						name === 'searchQuery' ? 'search' : name.slice(0, -'SearchQuery'.length),
						{ nodes: [selectNativePullRequest(query)] },
					]),
			);
		case 'getPullRequestsBatch':
			return keyed('p', () => ({ pullRequest: selectNativePullRequest(query) }));
		case 'getPullRequestsForBranches':
			return keyed('b', () => ({ pullRequests: { totalCount: 1, nodes: [selectNativePullRequest(query)] } }));
		case 'getIssue':
			return { repository: { issue: selectNativeIssue(query) } };
		case 'getIssuesBatch':
			return keyed('i', () => ({ issue: selectNativeIssue(query) }));
		case 'searchIssues':
			return Object.fromEntries(
				aliasesIncluded().map(alias => [alias, searchConnection([selectNativeIssue(query)])]),
			);
		default:
			throw new Error(`unexpected GraphQL operation '${operation}'`);
	}
}

/** Answers every GraphQL request, GitLens' own and provider-apis', and records each operation's name. */
function serveGitHub(runtime: FakeRuntime): string[] {
	const operations: string[] = [];
	runtime.http.fetch = (_input, init) => {
		const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
			query: string;
			variables?: Record<string, unknown>;
		};
		const operation =
			/^\s*query\s+(\w+)/.exec(body.query)?.[1] ?? (body.query.includes('rateLimit') ? 'rateLimit' : 'unknown');
		operations.push(operation);
		return Promise.resolve(
			new Response(JSON.stringify({ data: answer(operation, body.query, body.variables ?? {}) }), {
				status: 200,
				headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, read:user' },
			}),
		);
	};
	// The point reads go through the host's cache, which these tests don't keep.
	runtime.cache.getPullRequest = (_id, _resource, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => loader({} as never).value;
	return operations;
}

async function connected(): Promise<{
	manager: Awaited<ReturnType<typeof connectedGitHub>>['manager'];
	gh: GitHostIntegration;
	operations: string[];
}> {
	const runtime = createFakeRuntime();
	const operations = serveGitHub(runtime);
	const { manager, gh } = await connectedGitHub(runtime);
	// The account a read resolves `authoredByMe` with; unresolved, as a read is allowed to leave it.
	(gh as unknown as { getCurrentAccount: () => Promise<undefined> }).getCurrentAccount = () =>
		Promise.resolve(undefined);
	return { manager: manager, gh: gh, operations: operations };
}

const exercisedPullRequestProjections = new Set<PullRequestProjection>();
const exercisedIssueProjections = new Set<IssueProjection>();

/** Asserts a GitHub row's tag, and that its presence never claims a group the row doesn't carry. */
function assertPullRequestRow(
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
): Readonly<Record<PullRequestFieldGroup, FieldPresence>> {
	const presence = assertPullRequestPresence(pr, projection);
	exercisedPullRequestProjections.add(projection);
	return presence;
}

function assertIssueRow(
	issue: IssueShape | undefined,
	projection: IssueProjection,
): Readonly<Record<IssueFieldGroup, FieldPresence>> {
	const presence = assertIssuePresence(issue, projection);
	exercisedIssueProjections.add(projection);
	return presence;
}

const repo = { key: 'o/r', owner: 'o', name: 'r' };
const repos = [{ namespace: 'o', name: 'r' }];

suite('Field presence: every GitHub read stamps its tag, and its table holds for the row it produces', () => {
	test('point reads: by number, for a branch and for a commit', async () => {
		const { manager, gh } = await connected();

		const byNumber = await gh.getPullRequest(repo, '1', { throwOnError: true });
		const forBranch = await gh.getPullRequestForBranch(repo, 'feature', { throwOnError: true });
		const forCommit = await gh.getPullRequestForCommit(repo, 'a'.repeat(40), { throwOnError: true });

		for (const pr of [byNumber, forBranch, forCommit]) {
			const presence = assertPullRequestRow(pr, 'point');
			assert.equal(presence.stack, 'fetched');
			assert.equal(presence.mergeable, 'not-requested');
		}

		manager.dispose();
	});

	test('the filtered search, full and summary', async () => {
		const { manager } = await connected();

		const full = await manager.searchPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		const summary = await manager.searchPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			summary: true,
		});

		const presence = assertPullRequestRow(full.items[0], 'search');
		assert.equal(presence.access, 'fetched');
		assert.equal(full.items[0].repository?.accessLevel, RepositoryAccessLevel.Read);
		// Never selected, so never filled.
		assert.equal(full.items[0].thumbsUpCount, undefined);
		assert.equal(presence.reactions, 'not-requested');
		assertPullRequestRow(summary.items[0], 'search-summary');

		manager.dispose();
	});

	test('the host\'s own searches: its "my pull requests" search and the free-text search', async () => {
		const { manager, gh } = await connected();

		const mine = await gh.searchMyPullRequests(repo);
		const searched = await gh.searchPullRequests('crash', repo);

		assert.equal(mine?.error, undefined);
		assertPullRequestRow(mine?.value?.[0], 'search');
		assertPullRequestRow(searched?.[0], 'text-search');

		manager.dispose();
	});

	test("the account-wide list and sweeps, GitLens' own rows", async () => {
		const { manager } = await connected();

		const listed = await manager.listPullRequestsPage({ providerId: GitCloudHostIntegrationId.GitHub });
		const swept = await manager.sweepPullRequests({ providerIds: [GitCloudHostIntegrationId.GitHub] });
		const sweptWithReviews = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			includeReviews: true,
		});

		for (const pr of [listed.items[0], swept.items[0]]) {
			const presence = assertPullRequestRow(pr, 'account-summary');
			// Never selected, so it stays unset.
			assert.equal(pr.mergeableState, undefined);
			assert.equal(presence.mergeable, 'not-requested');
			// The lite fragment selects the stack, and the row keeps it.
			assert.equal((pr as PullRequest).stack?.number, 7);
			assert.equal(presence.stack, 'fetched');
		}
		assertFullRow(assertPullRequestRow(sweptWithReviews.items[0], 'account'), sweptWithReviews.items[0]);

		manager.dispose();
	});

	test('the repository-scoped list and sweep, through provider-apis', async () => {
		const { manager } = await connected();

		const listed = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});
		const summary = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
			summary: true,
		});
		const swept = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: repos,
		});

		for (const pr of [listed.items[0], swept.items[0]]) {
			const presence = assertPullRequestRow(pr, 'repos');
			// Not read, so unset, and the code-owner request and dismissed review are dropped.
			assert.equal(pr.repository?.accessLevel, undefined);
			assert.equal(presence.access, 'not-requested');
			assert.deepEqual(pr.reviewRequests, []);
			assert.equal(presence.reviewRequests, 'not-requested');
			assert.deepEqual(pr.latestReviews, []);
			assert.equal(presence.reviews, 'not-requested');
		}
		const presence = assertPullRequestRow(summary.items[0], 'repos-summary');
		assert.equal(presence.checks, 'not-requested');
		assert.equal(presence.commitCount, 'not-requested');

		manager.dispose();
	});

	test("the batch and branch reads, GitLens' own rows", async () => {
		const { manager } = await connected();

		const batch = await manager.getPullRequestsBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'pr', owner: 'o', repo: 'r', number: 1 }],
		});
		const branches = await manager.getPullRequestsForBranches({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'branch', owner: 'o', repo: 'r', branch: 'feature' }],
		});

		for (const pr of [batch.items[0]?.pullRequest, branches.items[0]?.pullRequests[0]]) {
			assertFullRow(assertPullRequestRow(pr, 'batch'), pr);
		}

		manager.dispose();
	});

	test('issue reads: point, account-wide, repository-scoped, search, broaden and batch', async () => {
		const { manager, gh } = await connected();

		const point = await gh.getIssue(repo, '1');
		const account = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub });
		const scoped = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos });
		const searched = await manager.searchIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos });
		const broadened = await manager.broadenIssues({
			orgs: [{ providerId: GitCloudHostIntegrationId.GitHub, name: 'o' }],
		});
		const batch = await manager.getIssuesBatch({
			providerId: GitCloudHostIntegrationId.GitHub,
			targets: [{ key: 'issue', owner: 'o', repo: 'r', number: 1 }],
		});

		assertIssueRow(point, 'point');
		assertIssueRow(account.items[0], 'account');
		const presence = assertIssueRow(scoped.items[0], 'repos');
		// provider-apis selects neither.
		assert.equal(scoped.items[0].body, undefined);
		assert.equal(presence.description, 'not-requested');
		assert.equal(scoped.items[0].repository?.accessLevel, undefined);
		assert.equal(presence.access, 'not-requested');
		assertIssueRow(searched.items[0], 'search');
		assertIssueRow(broadened.items[0], 'search');
		assertIssueRow(batch.items[0]?.issue, 'batch');

		manager.dispose();
	});

	test('every GitHub projection was exercised above', () => {
		assert.deepEqual([...exercisedPullRequestProjections].sort(), [...pullRequestProjections].sort());
		assert.deepEqual([...exercisedIssueProjections].sort(), [...issueProjections].sort());
	});
});

/**
 * What a lossy conversion would drop or invent, each visible on a fixture that selected it: `filesChanged`, `stack`,
 * the request's `isCodeOwner`, `viewerCanUpdate: false` and the READ access all survive, and the unselected reactions
 * stay unset.
 */
function assertFullRow(
	presence: Readonly<Record<PullRequestFieldGroup, FieldPresence>>,
	pr: PullRequestShape | undefined,
): void {
	const row = pr as PullRequest;
	assert.equal(row.filesChanged, 2);
	assert.equal(presence.diffStats, 'fetched');
	assert.deepEqual(row.stack, { id: 'S_1', number: 7, size: 2, position: 1, baseRef: 'main' });
	assert.equal(presence.stack, 'fetched');
	assert.equal(row.reviewRequests?.length, 1);
	assert.equal(row.reviewRequests?.[0]?.isCodeOwner, true);
	// A submitted review says nothing about code ownership.
	assert.equal(row.latestReviews?.[0]?.isCodeOwner, undefined);
	assert.equal(presence.reviewRequests, 'fetched');
	assert.equal(row.viewerCanUpdate, false);
	assert.equal(row.repository.accessLevel, RepositoryAccessLevel.Read);
	assert.equal(presence.access, 'fetched');
	assert.equal(row.thumbsUpCount, undefined);
	assert.equal(presence.reactions, 'not-requested');
}

function pullRequestRow(providerId: string, projection: string | undefined): PullRequestShape {
	return { provider: { id: providerId }, projection: projection } as unknown as PullRequestShape;
}

function issueRow(providerId: string, projection: string | undefined): IssueShape {
	return { provider: { id: providerId }, projection: projection } as unknown as IssueShape;
}

suite('Field presence lookup', () => {
	test('is undefined for an untagged row, an unknown provider, a tag its provider never produces and an unknown tag', () => {
		assert.equal(
			getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitHub, undefined)),
			undefined,
		);
		assert.equal(getPullRequestFieldPresence(pullRequestRow('nope', 'search')), undefined);
		// GitLab has no filtered search, so nothing it returns carries the summary tag.
		assert.equal(
			getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitLab, 'search-summary')),
			undefined,
		);
		assert.equal(
			getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitHub, 'toString')),
			undefined,
		);
		assert.equal(getIssueFieldPresence(issueRow(GitCloudHostIntegrationId.GitHub, undefined)), undefined);
		assert.equal(getIssueFieldPresence(issueRow(GitCloudHostIntegrationId.GitHub, 'project')), undefined);
		assert.equal(getIssueFieldPresence(issueRow(IssuesCloudHostIntegrationId.Trello, 'batch')), undefined);
		assert.equal(getIssueFieldPresence(issueRow(GitCloudHostIntegrationId.GitHub, 'constructor')), undefined);
	});

	test("a row tagged at the shared repository-scoped site reads its own provider's table", async () => {
		const { manager, gl } = await connectedGitLab(createFakeRuntime());
		stubApi(gl, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () => Promise.resolve({ values: [providerPr('gl-1')], paging: { more: false } }),
		});

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitLab,
			repos: [{ namespace: 'g', name: 'p' }],
		});

		assert.equal(result.items[0]?.projection, 'repos');
		assert.deepEqual(
			getPullRequestFieldPresence(result.items[0]),
			getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitLab, 'repos')),
		);
		assert.notDeepEqual(
			getPullRequestFieldPresence(result.items[0]),
			getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitHub, 'repos')),
		);

		manager.dispose();
	});

	test('GitHub Enterprise only ever demotes a github.com cell, and has no stacks', () => {
		for (const projection of pullRequestProjections) {
			const dotCom = getPullRequestFieldPresence(pullRequestRow(GitCloudHostIntegrationId.GitHub, projection));
			const enterprise = getPullRequestFieldPresence(
				pullRequestRow(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, projection),
			);
			assert.ok(dotCom != null && enterprise != null, projection);
			for (const [group, value] of Object.entries(enterprise) as [PullRequestFieldGroup, FieldPresence][]) {
				if (value === 'fetched') {
					assert.equal(dotCom[group], 'fetched', `${projection}.${group}`);
				}
			}
			assert.notEqual(enterprise.stack, 'fetched', projection);
			assert.equal(enterprise.stack, dotCom.stack === 'fetched' ? 'unavailable' : dotCom.stack, projection);
		}
		for (const projection of issueProjections) {
			assert.deepEqual(
				getIssueFieldPresence(issueRow(GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, projection)),
				getIssueFieldPresence(issueRow(GitCloudHostIntegrationId.GitHub, projection)),
				projection,
			);
		}
	});

	test('the serialized copies leave the tag out, so their presence is unknown', async () => {
		const { manager } = await connected();

		const pr = (
			await manager.searchPullRequestsPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos })
		).items[0] as PullRequest;
		const issue = (await manager.searchIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos }))
			.items[0];
		assert.equal(pr.projection, 'search');
		assert.equal(issue.projection, 'search');

		// The copies drop fields the tagged row's presence calls fetched, so a carried tag would overclaim.
		const serializedPr = serializePullRequest(pr);
		assert.equal(serializedPr.filesChanged, undefined);
		assert.equal(serializedPr.projection, undefined);
		assert.equal(getPullRequestFieldPresence(serializedPr), undefined);
		const serializedIssue = serializeIssue(issue);
		assert.equal(serializedIssue.repository?.accessLevel, undefined);
		assert.equal(serializedIssue.projection, undefined);
		assert.equal(getIssueFieldPresence(serializedIssue), undefined);

		manager.dispose();
	});
});

/**
 * The tables `packages/core/docs/integrations.md` publishes under each `<!-- field-presence: … -->` marker, by group,
 * then projection, then host. A cell is one value for every host of the table, or one per host joined by `/`, where
 * `—` is a host with no entry for that projection.
 */
function readDocTable(marker: string, hosts: number): Map<string, Map<string, (string | undefined)[]>> {
	// The runner bundles this suite to `out/__tests__`, the same depth as `src/__tests__`.
	const doc = readFileSync(join(__dirname, '../../../../core/docs/integrations.md'), 'utf8');
	const start = doc.indexOf(`<!-- field-presence: ${marker} -->`);
	assert.ok(start !== -1, `the docs carry the '${marker}' table`);

	const lines = doc
		.slice(start)
		.split('\n')
		.slice(1)
		.map(line => line.trim());
	const first = lines.findIndex(line => line.startsWith('|'));
	const rows: string[][] = [];
	for (const line of lines.slice(first)) {
		if (!line.startsWith('|')) break;

		rows.push(
			line
				.slice(1, -1)
				.split('|')
				.map(cell => cell.trim().replaceAll('`', '')),
		);
	}

	const [header, , ...body] = rows;
	const table = new Map<string, Map<string, (string | undefined)[]>>();
	for (const [group, ...cells] of body) {
		const byProjection = new Map<string, (string | undefined)[]>();
		cells.forEach((cell, i) => {
			const values = cell.split('/').map(value => value.trim());
			byProjection.set(
				header[i + 1],
				Array.from({ length: hosts }, (_, host) => {
					const value = values.length === 1 ? values[0] : values[host];
					return value === '—' ? undefined : value;
				}),
			);
		});
		table.set(group, byProjection);
	}
	return table;
}

/**
 * Asserts the published table is the code table, column for column: a projection is a column exactly when one of the
 * hosts has an entry for it, and every cell matches each host's entry.
 */
function assertDocMatches<P extends string, G extends string>(
	marker: string,
	hosts: readonly string[],
	projections: readonly P[],
	presenceFor: (providerId: string, projection: P) => Readonly<Record<G, FieldPresence>> | undefined,
): void {
	const doc = readDocTable(marker, hosts.length);
	const columns = projections.filter(p => hosts.some(host => presenceFor(host, p) != null));
	const groups = Object.keys(presenceFor(hosts[0], columns[0]) ?? presenceFor(hosts.at(-1)!, columns[0]) ?? {});
	assert.deepEqual([...doc.keys()].sort(), [...groups].sort(), `${marker}: the docs list every group`);
	assert.deepEqual(
		[...(doc.get(groups[0])?.keys() ?? [])],
		columns,
		`${marker}: the docs list every projection the hosts produce, in order`,
	);

	for (const projection of columns) {
		for (const group of groups as G[]) {
			assert.deepEqual(
				doc.get(group)?.get(projection),
				hosts.map(host => presenceFor(host, projection)?.[group]),
				`${marker}: ${group} on ${projection}`,
			);
		}
	}
}

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

const pullRequestTables: Record<string, readonly string[]> = {
	'pull-requests': [GitCloudHostIntegrationId.GitHub, GitSelfManagedHostIntegrationId.CloudGitHubEnterprise],
	'gitlab-pull-requests': [GitCloudHostIntegrationId.GitLab, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted],
	'azure-pull-requests': [GitCloudHostIntegrationId.AzureDevOps, GitSelfManagedHostIntegrationId.AzureDevOpsServer],
	'bitbucket-pull-requests': [GitCloudHostIntegrationId.Bitbucket, GitSelfManagedHostIntegrationId.BitbucketServer],
};

const issueTables: Record<string, readonly string[]> = {
	issues: [GitCloudHostIntegrationId.GitHub, GitSelfManagedHostIntegrationId.CloudGitHubEnterprise],
	'gitlab-issues': [GitCloudHostIntegrationId.GitLab, GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted],
	'azure-issues': [GitCloudHostIntegrationId.AzureDevOps, GitSelfManagedHostIntegrationId.AzureDevOpsServer],
	'bitbucket-issues': [GitCloudHostIntegrationId.Bitbucket],
	'jira-issues': [IssuesCloudHostIntegrationId.Jira, IssuesSelfManagedHostIntegrationId.JiraServer],
	'linear-issues': [IssuesCloudHostIntegrationId.Linear],
	'trello-issues': [IssuesCloudHostIntegrationId.Trello],
};

suite('Field presence docs', () => {
	for (const [marker, hosts] of Object.entries(pullRequestTables)) {
		test(`the published '${marker}' table is the code table`, () => {
			assertDocMatches(marker, hosts, allPullRequestProjections, (providerId, projection) =>
				getPullRequestFieldPresence(pullRequestRow(providerId, projection)),
			);
		});
	}

	for (const [marker, hosts] of Object.entries(issueTables)) {
		test(`the published '${marker}' table is the code table`, () => {
			assertDocMatches(marker, hosts, allIssueProjections, (providerId, projection) =>
				getIssueFieldPresence(issueRow(providerId, projection)),
			);
		});
	}

	test('every provider with a table is published', () => {
		const published = new Set([...Object.values(pullRequestTables), ...Object.values(issueTables)].flat());
		const tabled = [
			...Object.values(GitCloudHostIntegrationId),
			...Object.values(GitSelfManagedHostIntegrationId),
			...Object.values(IssuesCloudHostIntegrationId),
			...Object.values(IssuesSelfManagedHostIntegrationId),
		].filter(
			id =>
				allPullRequestProjections.some(p => getPullRequestFieldPresence(pullRequestRow(id, p)) != null) ||
				allIssueProjections.some(p => getIssueFieldPresence(issueRow(id, p)) != null),
		);
		for (const id of tabled) {
			assert.ok(published.has(id), `${id} has a published table`);
		}
	});
});
