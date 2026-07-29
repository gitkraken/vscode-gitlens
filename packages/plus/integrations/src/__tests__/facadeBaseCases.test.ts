import * as assert from 'node:assert/strict';
import { GitPullRequestMergeableState, GitPullRequestReviewState, GitPullRequestState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import {
	PullRequestMergeableState,
	PullRequestReviewDecision,
	PullRequestReviewState,
} from '@gitlens/git/models/pullRequest.js';
import type { PagedResult } from '@gitlens/utils/paging.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { IssueFilter, PullRequestFilter } from '../providerFilters.js';
import type {
	ProviderAzureProject,
	ProviderGitHubOrganization,
	ProviderGitLabGroup,
	ProviderHierarchyResult,
	ProviderIssue,
	ProviderOrganization,
	ProviderPullRequest,
	ProviderRepository,
} from '../providers/models.js';
import { PagingMode } from '../providers/models.js';
import type { FakeProvidersApiOverrides } from './fakeProvidersApi.js';
import { createFakeProvidersApi } from './fakeProvidersApi.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Base-case ("trunk") coverage for the IntegrationService ProviderBackend facade (#5438).
 *
 * Checked body-by-body (not just titles) against the rest of this package's facade tests before writing
 * this file, since several success paths already have *some* assertion elsewhere. What's actually missing
 * is narrower than "the trunk is untested": every sibling test found for these 14 cases either (a) stubs a
 * higher-level, already-shaped hook — `getMyIssuesForReposAsShapesResult`, `getIssuesForProjectWithTruncationResult`
 * — with a bare `{ id }` cast, which skips the raw-provider-apis → `toIssueShape`/`fromProviderPullRequest`
 * mapping this facade is supposed to guarantee, or (b) asserts one or two fields in service of a paging/
 * filter/warning mechanic, never the complete unified shape in one deepEqual. This file instead drives each
 * success path through its real raw-provider-apis hook and asserts the full shape at once — id through to
 * the last optional field, plus `warnings: []` and a falsy `fetchFailed` — so a regression in any single
 * field fails loudly here instead of only when some other test happens to incidentally notice it. It also
 * fills a few method×provider cells that had zero coverage at any layer: GitLab's `listOrgs` (groups→org
 * normalization), Trello's `listIssueTrackerIssuesPage`, and broadenIssues'/Jira's/Linear's issue-tracker
 * reads through their *real* per-provider mapping rather than a pre-shaped fixture.
 *
 * Two of these are also closed review findings worth pinning completely, even though a narrower assertion
 * of part of them already exists elsewhere:
 *  - #5533: `listRepos` must return the GitLens-owned `ProviderRepositoryShape` — not the raw
 *    `@gitkraken/provider-apis` `GitRepository` — asserted field-by-field, including the SDK's nullable
 *    fields collapsing to `undefined`. (No other `listRepos` test inspects `result.items` at all.)
 *  - #5549: `listPullRequestsPage` must carry the provider's description through as `PullRequestShape.body`.
 *    (`providerBackendSurface.test.ts` already pins `body` alone, twice; this file additionally pins it
 *    alongside every other PullRequestShape field — author, refs, reviewDecision, reviewRequests,
 *    assignees, mergeableState — none of which is asserted anywhere else through the facade.)
 */

const repos = [{ namespace: 'octocat', name: 'hello' }];

function primarySession(token: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: token,
		account: { id: 'me', label: 'me' },
		scopes: ['repo'],
		cloud: true,
		type: 'oauth',
		domain: 'github.com',
	};
}

// Both stubs route through the typed fake (see fakeProvidersApi.ts): the `overrides` parameter is
// key-checked against the REAL `ProvidersApi`, so a rename or signature change on the SDK wrapper is a
// compile error here instead of a fake that silently stops intercepting.
function stubApi(gh: GitHostIntegration, overrides: FakeProvidersApiOverrides): void {
	(gh as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(createFakeProvidersApi(overrides));
}

/** Same monkeypatch as {@link stubApi}, typed for the issue-tracker integrations (Jira/Linear/Trello). */
function stubIssuesApi(integration: IssuesIntegration, overrides: FakeProvidersApiOverrides): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(createFakeProvidersApi(overrides));
}

async function connectedGitHub(runtime: ReturnType<typeof createFakeRuntime>) {
	const manager = createIntegrationManager(runtime);
	const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
	(gh as unknown as { _session: ProviderAuthenticationSession })._session = primarySession('t');
	return { manager: manager, gh: gh };
}

/** A minimal but fully-typed `Account` fixture, shared by PR/issue author + assignee/reviewer fields. */
type ProviderAccountFixture = NonNullable<ProviderPullRequest['author']>;
function fakeAccount(
	id: string,
	name: string,
	extra?: { avatarUrl?: string | null; url?: string | null },
): ProviderAccountFixture {
	return {
		id: id,
		name: name,
		username: name,
		email: null,
		avatarUrl: extra?.avatarUrl ?? null,
		url: extra?.url ?? null,
	};
}

/** Mirrors the `providerPr` helper in providerBackendSurface.test.ts/sweepAndBroaden.test.ts. */
function providerPr(id: string, overrides?: Partial<ProviderPullRequest>): ProviderPullRequest {
	return {
		id: id,
		number: Number(id),
		title: `PR ${id}`,
		description: `Body of PR ${id}`,
		url: `https://example.com/pull/${id}`,
		state: GitPullRequestState.Open,
		isCrossRepository: false,
		isDraft: false,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		mergedDate: null,
		baseRef: null,
		headRef: null,
		commentCount: null,
		upvoteCount: null,
		commitCount: null,
		fileCount: null,
		additions: null,
		deletions: null,
		author: null,
		assignees: null,
		reviews: null,
		reviewDecision: null,
		repository: { id: `repo-${id}`, name: 'hello', owner: { login: 'octocat' }, remoteInfo: null },
		headRepository: null,
		headCommit: null,
		mergeableState: GitPullRequestMergeableState.Unknown,
		permissions: null,
		...overrides,
	};
}

/** Same shape of helper as `providerPr`, for the issue-tracker side of the raw provider-apis surface. */
function providerIssue(id: string, overrides?: Partial<ProviderIssue>): ProviderIssue {
	return {
		id: id,
		number: id,
		title: `Issue ${id}`,
		description: null,
		url: `https://example.com/issues/${id}`,
		type: null,
		state: null,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: null,
		assignees: [],
		repository: null,
		labels: [],
		commentCount: null,
		upvoteCount: null,
		...overrides,
	};
}

/**
 * Projects an `IssueShape` onto every field except `provider` (checked separately via `item.provider.id`,
 * mirroring the existing `listIssuesPage` test below). Shared by the `broadenIssues`/`listIssueTrackerIssuesPage`
 * base cases so each fails loudly on a regression in any single field, not just `.id`.
 */
function projectIssueShape(issue: IssueShape) {
	return {
		type: issue.type,
		id: issue.id,
		nodeId: issue.nodeId,
		title: issue.title,
		url: issue.url,
		state: issue.state,
		closed: issue.closed,
		createdDate: issue.createdDate,
		updatedDate: issue.updatedDate,
		closedDate: issue.closedDate,
		commentsCount: issue.commentsCount,
		thumbsUpCount: issue.thumbsUpCount,
		author: issue.author,
		assignees: issue.assignees,
		repository: issue.repository,
		labels: issue.labels,
		body: issue.body,
		project: issue.project,
		issueType: issue.issueType,
	};
}

suite('ProviderBackend facade — base-case trunk (#5438, #5533, #5549)', () => {
	test("listOrgs returns a healthy GitHub connection's orgs in the unified shape, with no warnings", async () => {
		// The closest existing GitHub touch is providerBackendSurface.test.ts's unscoped, multi-provider
		// fan-out test (~listOrgs/listProjects preserve provider attribution...), which only asserts
		// `orgs.items.some(item => ... item.name === 'octo')` — no url, no exact array, GitHub mixed in with
		// Jira/Azure in the same call. Every OTHER listOrgs test drives Linear/Jira/Bitbucket/BitbucketServer
		// warning paths, never a scoped, healthy, GitHub-only read. Pin that one directly: the complete unified
		// `ProviderOrganization` shape (including url) for an exact two-item array, not the raw SDK
		// `Organization`, plus explicit warnings: []/fetchFailed: undefined for a clean read.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			getGitHubOrgsForCurrentUser: () =>
				Promise.resolve({
					values: [
						{
							id: 'o1',
							username: 'octocat',
							name: 'Octocat Inc',
							email: null,
							avatarUrl: 'https://avatars.example/o1.png',
						},
						{
							id: 'o2',
							username: 'acme',
							name: null,
							email: null,
							avatarUrl: 'https://avatars.example/o2.png',
						},
					],
				} satisfies ProviderHierarchyResult<ProviderGitHubOrganization>),
		});

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitHub });

		assert.deepEqual(result.items, [
			{
				id: 'o1',
				providerId: GitCloudHostIntegrationId.GitHub,
				name: 'octocat',
				url: 'https://github.com/octocat',
			},
			{ id: 'o2', providerId: GitCloudHostIntegrationId.GitHub, name: 'acme', url: 'https://github.com/acme' },
		]);
		assert.deepEqual(result.warnings, [], 'a healthy read carries no warnings');
		assert.equal(result.fetchFailed, undefined, 'a successful read leaves fetchFailed unset, not just falsy');

		manager.dispose();
	});

	test('listOrgs normalizes GitLab groups (fullPath/webUrl) into the same unified shape as GitHub orgs', async () => {
		// Contrast case for the same gap: GitLab's raw org analogue ("groups") has a completely different SDK
		// shape (fullPath/webUrl instead of GitHub's username), so this also proves the unification is real
		// rather than the facade accidentally passing GitHub's fields through unchanged.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		stubApi(gl, {
			getGitlabGroupsForCurrentUser: () =>
				Promise.resolve({
					values: [
						{
							id: 'g1',
							path: 'platform',
							fullPath: 'northwind/platform',
							name: 'Platform',
							webUrl: 'https://gitlab.com/northwind/platform',
						},
					],
				} satisfies ProviderHierarchyResult<ProviderGitLabGroup>),
		});

		const result = await manager.listOrgs({ providerId: GitCloudHostIntegrationId.GitLab });

		assert.deepEqual(result.items, [
			{
				id: 'g1',
				providerId: GitCloudHostIntegrationId.GitLab,
				name: 'northwind/platform',
				url: 'https://gitlab.com/northwind/platform',
			},
		]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test("listRepos normalizes an org's repos to ProviderRepositoryShape, not the raw SDK GitRepository (#5533)", async () => {
		// #5533 closed the leak of the raw @gitkraken/provider-apis GitRepository through listRepos, but every
		// existing listRepos test only ever inspects page/cursor/hasMore — none inspects `result.items` at all
		// (one even builds its fixture as `{name, namespace} as unknown as ProviderRepository`, i.e. deliberately
		// NOT the real shape). Assert every ProviderRepositoryShape field for two repos: one with every optional
		// SDK field populated, and one where the SDK reports null for all of them — proving the facade collapses
		// the SDK's null convention to `undefined` instead of leaking it into ProviderRepositoryShape.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const sdkRepos: ProviderRepository[] = [
			{
				id: 'r1',
				namespace: 'octocat',
				name: 'hello-world',
				webUrl: 'https://github.com/octocat/hello-world',
				httpsUrl: 'https://github.com/octocat/hello-world.git',
				sshUrl: 'git@github.com:octocat/hello-world.git',
				defaultBranch: { name: 'main' },
				permissions: null,
			},
			{
				id: 'r2',
				namespace: 'octocat',
				name: 'bare-repo',
				// `project` is omitted (not nullable, unlike the fields below): only Azure DevOps repos carry
				// one, so every other host's SDK repo simply leaves the optional field unset.
				webUrl: null,
				httpsUrl: null,
				sshUrl: null,
				defaultBranch: null,
				permissions: null,
			},
		];
		stubApi(gh, {
			getReposForOrg: () =>
				Promise.resolve({
					values: sdkRepos,
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderRepository>),
		});

		const result = await manager.listRepos({ providerId: GitCloudHostIntegrationId.GitHub, org: 'octocat' });

		assert.deepEqual(result.items, [
			{
				id: 'r1',
				namespace: 'octocat',
				name: 'hello-world',
				project: undefined,
				url: 'https://github.com/octocat/hello-world',
				cloneUrlHttps: 'https://github.com/octocat/hello-world.git',
				cloneUrlSsh: 'git@github.com:octocat/hello-world.git',
				defaultBranch: 'main',
			},
			{
				id: 'r2',
				namespace: 'octocat',
				name: 'bare-repo',
				project: undefined,
				url: undefined,
				cloneUrlHttps: undefined,
				cloneUrlSsh: undefined,
				defaultBranch: undefined,
			},
		]);
		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 2);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test("listProjects returns a git host's (Azure DevOps) projects in the unified org shape", async () => {
		// Azure DevOps is the one git host with an org+project tier, so it is the only git-host exercise of
		// listProjects's "normal path" (as opposed to the issue-tracker project reads, which already have
		// direct coverage elsewhere in this suite). Mirrors the monkeypatch-the-Result-method pattern the
		// existing "listProjects discovers Azure DevOps projects" test uses, but additionally pins warnings/
		// fetchFailed and spans two orgs to prove the org label is carried per-project, not hard-coded.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		(
			azure as unknown as {
				getProjectsForOrgResult: (org?: string) => Promise<{ value: PagedResult<ProviderOrganization> }>;
			}
		).getProjectsForOrgResult = () =>
			Promise.resolve({
				value: {
					values: [
						{
							id: 'p1',
							providerId: GitCloudHostIntegrationId.AzureDevOps,
							name: 'Website',
							org: 'northwind',
							url: 'https://dev.azure.com/northwind/Website',
						},
						{
							id: 'p2',
							providerId: GitCloudHostIntegrationId.AzureDevOps,
							name: 'Mobile',
							org: 'contoso',
							url: 'https://dev.azure.com/contoso/Mobile',
						},
					],
				},
			});

		const result = await manager.listProjects({ providerId: GitCloudHostIntegrationId.AzureDevOps });

		assert.deepEqual(result.items, [
			{
				id: 'p1',
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				name: 'Website',
				org: 'northwind',
				url: 'https://dev.azure.com/northwind/Website',
			},
			{
				id: 'p2',
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				name: 'Mobile',
				org: 'contoso',
				url: 'https://dev.azure.com/contoso/Mobile',
			},
		]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('listPullRequestsPage returns a normal first page as the complete PullRequestShape, including body (#5549)', async () => {
		// listPullRequestsPage has 33 tests. Two of them already pin `.body` alone (both tagged #5549) and one
		// pins `id`+`number`+`authoredByMe` together — but none of the rest of PullRequestShape (author, refs,
		// assignees, reviewRequests, mergeableState, reviewDecision) is asserted anywhere, by any of the 33.
		// Project the result onto every PullRequestShape field (everything except `provider`, checked
		// separately) and compare in one shot so this test fails loudly if the facade ever drops a field,
		// instead of relying on scattered single-field checks to each happen to catch their own regression.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const reviewer = fakeAccount('rev-1', 'Trinity');
		const pr = providerPr('101', {
			title: 'Add dark mode toggle',
			description: 'Adds a dark mode toggle to the settings screen.\n\nCloses #42.',
			url: 'https://github.com/octocat/hello/pull/101',
			isDraft: true,
			createdDate: new Date('2026-01-01T00:00:00.000Z'),
			updatedDate: new Date('2026-01-02T00:00:00.000Z'),
			baseRef: { name: 'main', oid: 'base-sha' },
			headRef: { name: 'feature/dark-mode', oid: 'head-sha' },
			commentCount: 3,
			upvoteCount: 2,
			additions: 40,
			deletions: 10,
			author: fakeAccount('me', 'Keanu Reeves', {
				avatarUrl: 'https://avatars.example/keanu.png',
				url: 'https://github.com/keanu',
			}),
			assignees: [reviewer],
			reviews: [{ reviewer: reviewer, state: GitPullRequestReviewState.ReviewRequested }],
			reviewDecision: GitPullRequestReviewState.Approved,
			mergeableState: GitPullRequestMergeableState.Mergeable,
		});
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [pr],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});
		// Authorship resolution is a best-effort side read (see getCurrentAccountId); pin it instead of relying
		// on it incidentally failing closed, so `authoredByMe` is asserted deterministically below.
		(gh as unknown as { getCurrentAccount: () => Promise<{ id: string }> }).getCurrentAccount = () =>
			Promise.resolve({ id: 'me' });

		const result = await manager.listPullRequestsPage({
			providerId: GitCloudHostIntegrationId.GitHub,
			repos: repos,
		});

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			{
				type: item.type,
				id: item.id,
				nodeId: item.nodeId,
				title: item.title,
				url: item.url,
				state: item.state,
				closed: item.closed,
				createdDate: item.createdDate,
				updatedDate: item.updatedDate,
				closedDate: item.closedDate,
				mergedDate: item.mergedDate,
				commentsCount: item.commentsCount,
				thumbsUpCount: item.thumbsUpCount,
				author: item.author,
				body: item.body,
				isDraft: item.isDraft,
				additions: item.additions,
				deletions: item.deletions,
				mergeableState: item.mergeableState,
				reviewDecision: item.reviewDecision,
				reviewRequests: item.reviewRequests,
				assignees: item.assignees,
				refs: item.refs,
				project: item.project,
				number: item.number,
				authoredByMe: item.authoredByMe,
			},
			{
				type: 'pullrequest',
				id: '101',
				nodeId: '101', // falls back to id: the fixture has no graphQLId
				title: 'Add dark mode toggle',
				url: 'https://github.com/octocat/hello/pull/101',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-01-01T00:00:00.000Z'),
				updatedDate: new Date('2026-01-02T00:00:00.000Z'),
				closedDate: undefined,
				mergedDate: undefined,
				commentsCount: 3,
				thumbsUpCount: 2,
				author: {
					id: 'me',
					name: 'Keanu Reeves',
					avatarUrl: 'https://avatars.example/keanu.png',
					url: 'https://github.com/keanu',
				},
				// #5549: the provider's raw `description` must survive as PullRequestShape.body.
				body: 'Adds a dark mode toggle to the settings screen.\n\nCloses #42.',
				isDraft: true,
				additions: 40,
				deletions: 10,
				mergeableState: PullRequestMergeableState.Mergeable,
				reviewDecision: PullRequestReviewDecision.Approved,
				reviewRequests: [
					{
						isCodeOwner: false,
						reviewer: { id: 'rev-1', name: 'Trinity', avatarUrl: undefined, url: undefined },
						state: PullRequestReviewState.ReviewRequested,
					},
				],
				assignees: [{ id: 'rev-1', name: 'Trinity', avatarUrl: undefined, url: undefined }],
				refs: {
					base: {
						branch: 'main',
						sha: 'base-sha',
						repo: 'hello',
						owner: 'octocat',
						exists: true,
						url: '',
						cloneHttps: undefined,
						cloneSsh: undefined,
					},
					head: {
						branch: 'feature/dark-mode',
						sha: 'head-sha',
						repo: '',
						owner: '',
						exists: true,
						url: '',
						cloneHttps: undefined,
						cloneSsh: undefined,
						isFork: undefined,
					},
					isCrossRepository: false,
				},
				project: undefined,
				number: 101,
				authoredByMe: true,
			},
			'listPullRequestsPage maps every PullRequestShape field for a normal first page',
		);
		assert.equal(item.provider.id, GitCloudHostIntegrationId.GitHub);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('listIssuesPage returns a normal first page as the complete IssueShape', async () => {
		// Same gap as the PR test above, for issues: existing listIssuesPage tests only ever check `.id` on a
		// returned item. Project the result onto every IssueShape field (everything except `provider`, checked
		// separately) so a regression in any one of them fails this test, not just a future consumer.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const issue = providerIssue('42', {
			graphQLId: 'gid://issue/42',
			title: 'Dark mode toggle flickers on load',
			description: 'Steps to reproduce:\n1. Open settings\n2. Toggle dark mode\n\nSeen on 1.2.3.',
			url: 'https://github.com/octocat/hello/issues/42',
			createdDate: new Date('2026-01-01T00:00:00.000Z'),
			updatedDate: new Date('2026-01-03T00:00:00.000Z'),
			author: fakeAccount('me', 'Ivan', {
				avatarUrl: 'https://avatars.example/ivan.png',
				url: 'https://github.com/ivan',
			}),
			assignees: [fakeAccount('rev-1', 'Trinity')],
			repository: { id: 'repo-1', name: 'hello', owner: { login: 'octocat' } },
			labels: [{ id: 'l1', name: 'bug', color: 'd73a4a', description: null }],
			commentCount: 5,
			upvoteCount: 1,
		});
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: () =>
				Promise.resolve({
					values: [issue],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderIssue>),
		});

		const result = await manager.listIssuesPage({ providerId: GitCloudHostIntegrationId.GitHub, repos: repos });

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			{
				type: item.type,
				id: item.id,
				nodeId: item.nodeId,
				title: item.title,
				url: item.url,
				state: item.state,
				closed: item.closed,
				createdDate: item.createdDate,
				updatedDate: item.updatedDate,
				closedDate: item.closedDate,
				commentsCount: item.commentsCount,
				thumbsUpCount: item.thumbsUpCount,
				author: item.author,
				assignees: item.assignees,
				repository: item.repository,
				labels: item.labels,
				body: item.body,
				project: item.project,
				issueType: item.issueType,
			},
			{
				type: 'issue',
				id: '42', // IssueShape.id is the provider's display number, not its opaque node id
				nodeId: 'gid://issue/42',
				title: 'Dark mode toggle flickers on load',
				url: 'https://github.com/octocat/hello/issues/42',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-01-01T00:00:00.000Z'),
				updatedDate: new Date('2026-01-03T00:00:00.000Z'),
				closedDate: undefined,
				commentsCount: 5,
				thumbsUpCount: 1,
				author: {
					id: 'me',
					name: 'Ivan',
					avatarUrl: 'https://avatars.example/ivan.png',
					url: 'https://github.com/ivan',
				},
				// Unlike PullRequestShape's fromProviderAccount (which falls `url` back to ''), toIssueShape's own
				// inline author/assignee mapping falls `url` back to `undefined` — a small but real divergence
				// between the two normalizers worth pinning explicitly.
				assignees: [{ id: 'rev-1', name: 'Trinity', avatarUrl: undefined, url: undefined }],
				repository: { id: 'repo-1', owner: 'octocat', repo: 'hello' },
				labels: [{ color: 'd73a4a', name: 'bug' }],
				body: 'Steps to reproduce:\n1. Open settings\n2. Toggle dark mode\n\nSeen on 1.2.3.',
				// A repo-scoped git-host issue has no project tier. The mapper only builds `project` when the
				// provider issue carries a complete one (id + resourceId + namespace, see toIssueShape); anything
				// less stays `undefined` — it no longer coerces an empty-string placeholder.
				project: undefined,
				issueType: undefined,
			},
			'listIssuesPage maps every IssueShape field for a normal first page',
		);
		assert.equal(item.provider.id, GitCloudHostIntegrationId.GitHub);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('sweepPullRequests drains a healthy multi-repo read cleanly: every item, allPages true, no warnings', async () => {
		// The two existing "clean" sweep tests ("drains multiple pages and marks truncated at maxPages" and
		// "stops cleanly when the provider runs out of pages") are both about *paging* mechanics; neither
		// checks `warnings`, and only the maxPages one checks `fetchFailed`/`failedProviderIds`. Pin the full
		// success contract together — items, allPages, truncated, hasMore, fetchFailed, warnings,
		// failedProviderIds — for the simplest possible drain: one page, already complete.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: () =>
				Promise.resolve({
					values: [providerPr('1'), providerPr('2')],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>),
		});

		const result = await manager.sweepPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: [
				{ namespace: 'octocat', name: 'hello' },
				{ namespace: 'octocat', name: 'world' },
			],
		});

		assert.deepEqual(
			result.items.map(pr => pr.id),
			['1', '2'],
			'every item from the drained repos is returned',
		);
		assert.equal(result.page.allPages, true, 'a clean single-page drain is complete');
		assert.equal(result.page.truncated, undefined, 'success normalizes truncated to undefined, not false');
		assert.equal(result.hasMore, false, 'a sweep never advertises a cursor to resume');
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.failedProviderIds, []);

		manager.dispose();
	});

	test('sweepClosedPullRequests forces the closed+merged filter and drains cleanly', async () => {
		// sweepClosedPullRequests's own contract (distinct from sweepPullRequests) is that it hard-codes the
		// closed+merged state filter; assert that filter actually reaches the provider call, alongside the same
		// clean-drain success contract as the sweepPullRequests trunk test above.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		let capturedStates: unknown;
		stubApi(gh, {
			isRepoIdsInput: () => false,
			getProviderPullRequestsPagingMode: () => PagingMode.Repos,
			getPullRequestsForRepos: (_token: unknown, _repos: unknown, opts: { states?: unknown }) => {
				capturedStates = opts.states;
				return Promise.resolve({
					values: [
						providerPr('1', { state: GitPullRequestState.Closed }),
						providerPr('2', { state: GitPullRequestState.Merged }),
					],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderPullRequest>);
			},
		});

		const result = await manager.sweepClosedPullRequests({
			providerIds: [GitCloudHostIntegrationId.GitHub],
			repos: repos,
		});

		assert.deepEqual(
			capturedStates,
			[GitPullRequestState.Closed, GitPullRequestState.Merged],
			'sweepClosedPullRequests forces the native closed+merged state filter',
		);
		assert.deepEqual(
			result.items.map(pr => pr.state),
			['closed', 'merged'],
			'both native states normalize to PullRequestShape.state',
		);
		assert.equal(result.page.allPages, true);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(result.warnings, []);
		assert.deepEqual(result.failedProviderIds, []);

		manager.dispose();
	});

	test('broadenIssues fans out over multiple orgs and returns the aggregated issues in the unified IssueShape, with no warnings', async () => {
		// broadenIssues is exercised elsewhere (sweepAndBroaden.test.ts, providerBackendSurface.test.ts) almost
		// entirely for its cursor/pagination and per-org-failure mechanics; none of those drives a clean
		// multi-org fan-out to completion and inspects the result items beyond `.id`. Pin that a healthy
		// two-org fan-out over GitHub aggregates both orgs' issues in the same unified IssueShape listIssuesPage
		// returns (broadenIssues shares the same getMyIssuesForReposAsShapesResult → toIssueShape path, not a
		// broaden-specific shape), alongside correct broadenedProviderIds/fanOutCount and no warnings.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		const issueForOrg = (org: string): ProviderIssue =>
			providerIssue(`issue-${org}`, {
				number: `${org}-7`,
				title: `Investigate crash in ${org}/repo`,
				url: `https://github.com/${org}/repo/issues/7`,
				createdDate: new Date('2026-01-01T00:00:00.000Z'),
				updatedDate: new Date('2026-01-02T00:00:00.000Z'),
				author: fakeAccount('author-1', 'Ada Lovelace', {
					avatarUrl: 'https://avatars.example/ada.png',
					url: 'https://github.com/ada',
				}),
				assignees: [fakeAccount('me', 'Keanu Reeves')],
				repository: { id: `repo-${org}`, name: 'repo', owner: { login: org } },
				labels: [{ id: 'l1', name: 'bug', color: 'd73a4a', description: null }],
				commentCount: 2,
				upvoteCount: 1,
			});
		const expectedShapeForOrg = (org: string) => ({
			type: 'issue',
			id: `${org}-7`, // IssueShape.id is issue.number, not issue.id
			nodeId: `issue-${org}`, // falls back to id: the fixture has no graphQLId
			title: `Investigate crash in ${org}/repo`,
			url: `https://github.com/${org}/repo/issues/7`,
			state: 'opened',
			closed: false,
			createdDate: new Date('2026-01-01T00:00:00.000Z'),
			updatedDate: new Date('2026-01-02T00:00:00.000Z'),
			closedDate: undefined,
			commentsCount: 2,
			thumbsUpCount: 1,
			author: {
				id: 'author-1',
				name: 'Ada Lovelace',
				avatarUrl: 'https://avatars.example/ada.png',
				url: 'https://github.com/ada',
			},
			assignees: [{ id: 'me', name: 'Keanu Reeves', avatarUrl: undefined, url: undefined }],
			repository: { id: `repo-${org}`, owner: org, repo: 'repo' },
			labels: [{ color: 'd73a4a', name: 'bug' }],
			body: undefined,
			// broadenIssues reads repo-scoped git-host issues (same as listIssuesPage), so — unlike an issue
			// tracker's project-scoped read below — there's no project tier to populate: `undefined`, never a
			// placeholder (toIssueShape only builds `project` from a complete provider-side one).
			project: undefined,
			issueType: undefined,
		});

		stubApi(gh, {
			getReposForOrg: (_t: unknown, org: string) =>
				Promise.resolve({
					values: [{ id: `repo-${org}`, namespace: org, name: 'repo' }],
					paging: { more: false, cursor: '{}' },
				}),
			isRepoIdsInput: () => false,
			getProviderIssuesPagingMode: () => PagingMode.Repos,
			getIssuesForRepos: (_t: unknown, repos: { namespace: string }[]) =>
				Promise.resolve({
					values: repos.map(r => issueForOrg(r.namespace)),
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderIssue>),
		});

		const result = await manager.broadenIssues({
			orgs: [
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'octocat' },
				{ providerId: GitCloudHostIntegrationId.GitHub, name: 'acme' },
			],
		});

		assert.equal(result.items.length, 2, 'issues from both orgs are aggregated');
		assert.deepEqual(
			result.items.map(projectIssueShape),
			[expectedShapeForOrg('octocat'), expectedShapeForOrg('acme')],
			'broadenIssues maps every IssueShape field for each org, not just id',
		);
		assert.ok(
			result.items.every(item => item.provider.id === GitCloudHostIntegrationId.GitHub),
			'every item is attributed to the GitHub provider',
		);
		assert.deepEqual(
			result.broadenedProviderIds,
			[GitCloudHostIntegrationId.GitHub],
			'broadenedProviderIds lists distinct providers, not one entry per org',
		);
		assert.equal(result.fanOutCount, 2, 'fanOutCount reflects the number of orgs requested');

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 2);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test("resolveRepository resolves a github.com remote to the provider's canonical identity, with no warning", async () => {
		// resolveRepository.test.ts has ~30 tests for renames, 404s, host-mismatch, and GraphQL error
		// classification, plus one loop test confirming github.com/gitlab.com/bitbucket.org all reach
		// `status: 'resolved'` — but that loop's fixture is `{ id: 'r1' }` (no namespace/name), so it never
		// exercises the canonical-identity assembly, and no test in that file deepEquals the full `identity`
		// object or confirms a clean resolve carries no `resolution.warning`. Pin the complete identity for a
		// plain, unrenamed github.com resolve.
		const runtime = createFakeRuntime();
		const { manager, gh } = await connectedGitHub(runtime);

		stubApi(gh, {
			getRepo: () => Promise.resolve({ id: 'r1', namespace: 'octocat', name: 'hello' }),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://github.com/octocat/hello.git' });

		assert.equal(result.cliUnsupported, false);
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.warning, undefined, 'a clean resolve carries no warning');
		assert.deepEqual(
			result.resolution.identity,
			{
				providerId: GitCloudHostIntegrationId.GitHub,
				domain: 'github.com',
				owner: 'octocat',
				name: 'hello',
				project: undefined,
				remoteUrl: 'https://github.com/octocat/hello.git',
				renamed: false,
			},
			'the full canonical identity is returned for a clean, unrenamed resolve',
		);

		manager.dispose();
	});

	test("resolveRepository resolves a gitlab.com remote to the provider's canonical identity, with no warning", async () => {
		// Contrast case for the same gap: GitLab is a distinct provider id/matcher from GitHub, so this also
		// proves the identity assembly isn't accidentally GitHub-specific.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const gl = await manager.get(GitCloudHostIntegrationId.GitLab);
		(gl as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'gitlab.com',
		};

		stubApi(gl, {
			getRepo: () => Promise.resolve({ id: 'g1', namespace: 'northwind', name: 'platform' }),
		});

		const result = await manager.resolveRepository({ remoteUrl: 'https://gitlab.com/northwind/platform.git' });

		assert.equal(result.cliUnsupported, false);
		assert.equal(result.resolution.status, 'resolved');
		assert.equal(result.resolution.warning, undefined, 'a clean resolve carries no warning');
		assert.deepEqual(
			result.resolution.identity,
			{
				providerId: GitCloudHostIntegrationId.GitLab,
				domain: 'gitlab.com',
				owner: 'northwind',
				name: 'platform',
				project: undefined,
				remoteUrl: 'https://gitlab.com/northwind/platform.git',
				renamed: false,
			},
			'the full canonical identity is returned for a clean, unrenamed resolve',
		);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage returns a normal single-page read as the complete IssueShape for Jira', async () => {
		// listIssueTrackerIssuesPage has ~15 tests in providerBackendSurface.test.ts, all Jira/Linear, and every
		// one that inspects an item builds it as `{ id: 'i1' } as unknown as IssueShape` — none drives a real
		// provider-apis fixture through the actual per-provider mapping (toIssueShape, the same normalizer
		// listIssuesPage/broadenIssues use) to pin the complete shape this facade promises for an issue tracker.
		// Also unlike a repo-scoped git-host issue (see the broadenIssues/listIssuesPage cases above, whose
		// `project` is an empty placeholder), an issue tracker's `project` IS the read's own scope — pin that it
		// comes through populated, not defaulted away.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'atlassian.net',
		};

		let capturedAssigneeLogins: string[] | undefined;
		stubIssuesApi(jira, {
			getJiraResourcesForCurrentUser: () =>
				Promise.resolve([
					{
						id: 'org-1',
						name: 'Acme Inc',
						url: 'https://acme.atlassian.net',
						avatarUrl: 'https://avatars.example/acme.png',
					},
				]),
			getJiraProjectsForResources: () =>
				Promise.resolve({ values: [{ key: 'ENG', id: 'p1', name: 'Engineering', resourceId: 'org-1' }] }),
			getCurrentUserForResource: () =>
				Promise.resolve({
					id: 'u1',
					name: 'Jane Doe',
					username: 'jane',
					email: 'jane@example.com',
					avatarUrl: 'https://avatars.example/jane.png',
				}),
			getIssuesForProjectPaged: (
				_t: unknown,
				_projectName: string,
				_resourceId: string,
				opts?: { assigneeLogins?: string[] },
			) => {
				capturedAssigneeLogins = opts?.assigneeLogins;
				return Promise.resolve({
					data: [
						providerIssue('issue-100', {
							number: 'ENG-42',
							title: 'Investigate memory leak',
							description: 'Steps to reproduce:\n1. Open app\n2. Wait\n\nSeen in prod.',
							url: 'https://acme.atlassian.net/browse/ENG-42',
							createdDate: new Date('2026-01-01T00:00:00.000Z'),
							updatedDate: new Date('2026-01-02T00:00:00.000Z'),
							author: fakeAccount('author-1', 'Ada Lovelace', {
								avatarUrl: 'https://avatars.example/ada.png',
								url: 'https://acme.atlassian.net/people/ada',
							}),
							assignees: [
								fakeAccount('u1', 'Jane Doe', {
									avatarUrl: 'https://avatars.example/jane.png',
									url: 'https://acme.atlassian.net/people/jane',
								}),
							],
							labels: [{ id: 'l1', name: 'bug', color: 'd73a4a', description: null }],
							commentCount: 2,
							upvoteCount: 0,
							project: {
								namespace: 'Acme Inc',
								resourceId: 'org-1',
								name: 'Engineering',
								key: 'ENG',
								id: 'p1',
							},
						}),
					],
					hasMore: false,
					nextCursor: undefined,
				});
			},
		});

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			projectIssueShape(item),
			{
				type: 'issue',
				id: 'ENG-42',
				nodeId: 'issue-100', // no graphQLId on the fixture: falls back to id
				title: 'Investigate memory leak',
				url: 'https://acme.atlassian.net/browse/ENG-42',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-01-01T00:00:00.000Z'),
				updatedDate: new Date('2026-01-02T00:00:00.000Z'),
				closedDate: undefined,
				commentsCount: 2,
				thumbsUpCount: 0,
				author: {
					id: 'author-1',
					name: 'Ada Lovelace',
					avatarUrl: 'https://avatars.example/ada.png',
					url: 'https://acme.atlassian.net/people/ada',
				},
				assignees: [
					{
						id: 'u1',
						name: 'Jane Doe',
						avatarUrl: 'https://avatars.example/jane.png',
						url: 'https://acme.atlassian.net/people/jane',
					},
				],
				repository: undefined,
				labels: [{ color: 'd73a4a', name: 'bug' }],
				body: 'Steps to reproduce:\n1. Open app\n2. Wait\n\nSeen in prod.',
				project: { id: 'p1', name: 'Engineering', resourceId: 'org-1', resourceName: 'Acme Inc' },
				issueType: undefined,
			},
			'listIssueTrackerIssuesPage maps every IssueShape field for a normal Jira read',
		);
		assert.equal(item.provider.id, IssuesCloudHostIntegrationId.Jira);
		assert.deepEqual(
			capturedAssigneeLogins,
			['jane'],
			'the resolved current user threads through as the default assignee scope',
		);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage returns a normal single-page read as the complete IssueShape for Linear', async () => {
		// Linear resolves the viewer twice on this path — once by the facade (getAccountForResourceResult, to
		// scope the read) and again inside Linear's own getProviderIssuesForProjectWithTruncation (to filter
		// client-side by the stable viewer id, since an assignee's name and the facade's resolved
		// username/displayName can diverge — see linear.test.ts). This also doubles as a base-case check that
		// both resolutions agree end to end through the full facade, not just in per-provider isolation.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
		(linear as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'linear.app',
		};

		stubIssuesApi(linear, {
			getLinearOrganization: () =>
				Promise.resolve({ id: 'org-1', key: 'ACME', name: 'Acme Inc', url: 'https://linear.app/acme' }),
			getLinearTeamsForCurrentUser: () =>
				Promise.resolve([
					{ id: 'team-1', key: 'ENG', name: 'Engineering', iconUrl: 'https://avatars.example/team.png' },
				]),
			getLinearCurrentUser: () =>
				Promise.resolve({ id: 'u1', name: 'Jane Doe', email: 'jane@example.com', displayName: 'jane' }),
			getLinearIssues: () =>
				Promise.resolve({
					values: [
						providerIssue('issue-linear-1', {
							graphQLId: 'gid://linear/Issue/abc123',
							number: 'ENG-7',
							title: 'Crash on startup',
							description: 'Repro steps...\n\nAffects v2.',
							url: 'https://linear.app/acme/issue/ENG-7',
							createdDate: new Date('2026-02-01T00:00:00.000Z'),
							updatedDate: new Date('2026-02-02T00:00:00.000Z'),
							author: fakeAccount('author-2', 'Trinity', {
								avatarUrl: 'https://avatars.example/trinity.png',
								url: 'https://linear.app/people/trinity',
							}),
							// The assignee id must be the stable Linear user id (matched against the resolved
							// viewer's own id), not a name/displayName — see linear.test.ts.
							assignees: [
								fakeAccount('u1', 'Jane Doe', {
									avatarUrl: 'https://avatars.example/jane2.png',
									url: 'https://linear.app/people/jane',
								}),
							],
							labels: [{ id: 'l1', name: 'bug', color: '#ff0000', description: null }],
							commentCount: 4,
							upvoteCount: 3,
							project: {
								namespace: 'Acme Inc',
								resourceId: 'org-1',
								name: 'Engineering',
								key: 'ENG',
								id: 'team-1',
							},
						}),
					],
					paging: { more: false, cursor: '{}' },
				}),
		});

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Linear });

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			projectIssueShape(item),
			{
				type: 'issue',
				id: 'ENG-7',
				nodeId: 'gid://linear/Issue/abc123',
				title: 'Crash on startup',
				url: 'https://linear.app/acme/issue/ENG-7',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-02-01T00:00:00.000Z'),
				updatedDate: new Date('2026-02-02T00:00:00.000Z'),
				closedDate: undefined,
				commentsCount: 4,
				thumbsUpCount: 3,
				author: {
					id: 'author-2',
					name: 'Trinity',
					avatarUrl: 'https://avatars.example/trinity.png',
					url: 'https://linear.app/people/trinity',
				},
				assignees: [
					{
						id: 'u1',
						name: 'Jane Doe',
						avatarUrl: 'https://avatars.example/jane2.png',
						url: 'https://linear.app/people/jane',
					},
				],
				repository: undefined,
				labels: [{ color: '#ff0000', name: 'bug' }],
				body: 'Repro steps...\n\nAffects v2.',
				project: { id: 'team-1', name: 'Engineering', resourceId: 'org-1', resourceName: 'Acme Inc' },
				issueType: undefined,
			},
			'listIssueTrackerIssuesPage maps every IssueShape field for a normal Linear read',
		);
		assert.equal(item.provider.id, IssuesCloudHostIntegrationId.Linear);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage returns a normal single-page read as the complete IssueShape for Trello', async () => {
		// Trello has zero coverage of listIssueTrackerIssuesPage anywhere in the suite (every existing test for
		// this method is Jira or Linear), even though TrelloIntegration implements every hook the facade needs:
		// getProviderResourcesForUser/getProviderProjectsForResources/getProviderAccountForResource/
		// getProviderIssuesForProjectWithTruncation (see trello.ts). Trello's board is both the "resource" and
		// the "project" (no separate org tier), and its per-project read overwrites `project` onto whatever
		// toIssueShape produced with the board descriptor — pin that override survives the facade's aggregation.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'trello.com',
			appKey: 'app-key-1',
		};

		stubIssuesApi(trello, {
			getTrelloBoardsForCurrentUser: () => Promise.resolve([{ id: 'board-1', name: 'Engineering Board' }]),
			getTrelloCurrentUser: () =>
				Promise.resolve({
					id: 'u1',
					name: 'Jane Doe',
					username: 'jane',
					email: 'jane@example.com',
					avatarUrl: 'https://avatars.example/jane3.png',
				}),
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'list-1', name: 'In Progress' }]),
			getTrelloIssuesForBoard: () =>
				Promise.resolve({
					values: [
						providerIssue('card-1', {
							number: '42',
							title: 'Fix login button alignment',
							description: 'The button is misaligned on mobile.\n\nSeen on iOS.',
							url: 'https://trello.com/c/card-1',
							createdDate: new Date('2026-03-01T00:00:00.000Z'),
							updatedDate: new Date('2026-03-02T00:00:00.000Z'),
							// Trello cards carry no creator field; the SDK always maps `author: null` (see
							// trello.test.ts) — toIssueShape must still surface the card, with an empty author.
							author: null,
							assignees: [
								fakeAccount('u1', 'Jane Doe', {
									avatarUrl: 'https://avatars.example/jane3.png',
									url: 'https://trello.com/u1',
								}),
							],
							labels: [{ id: 'l1', name: 'ui', color: 'green', description: null }],
							commentCount: 1,
							upvoteCount: 0,
						}),
					],
					metadata: { completeness: 'complete' },
				}),
		});

		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Trello });

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			projectIssueShape(item),
			{
				type: 'issue',
				id: '42',
				nodeId: 'card-1', // no graphQLId on the fixture: falls back to id
				title: 'Fix login button alignment',
				url: 'https://trello.com/c/card-1',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-03-01T00:00:00.000Z'),
				updatedDate: new Date('2026-03-02T00:00:00.000Z'),
				closedDate: undefined,
				commentsCount: 1,
				thumbsUpCount: 0,
				author: { id: '', name: undefined, avatarUrl: undefined, url: undefined },
				assignees: [
					{
						id: 'u1',
						name: 'Jane Doe',
						avatarUrl: 'https://avatars.example/jane3.png',
						url: 'https://trello.com/u1',
					},
				],
				repository: undefined,
				labels: [{ color: 'green', name: 'ui' }],
				body: 'The button is misaligned on mobile.\n\nSeen on iOS.',
				// Trello's board is both the resource and the project; getProviderIssuesForProjectWithTruncation
				// overwrites `project` onto the board descriptor regardless of what the raw card carried.
				project: {
					id: 'board-1',
					name: 'Engineering Board',
					resourceId: 'board-1',
					resourceName: 'Engineering Board',
				},
				issueType: undefined,
			},
			'listIssueTrackerIssuesPage maps every IssueShape field for a normal Trello read',
		);
		assert.equal(item.provider.id, IssuesCloudHostIntegrationId.Trello);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});
});

/**
 * `getSupportedFilters` (added today alongside the rest of the filter-validation machinery, de8310e64 "expose
 * the supported filter table on the facade") lets a caller intersect its filter set against a provider BEFORE
 * issuing a read, since `listPullRequestsPage`/`listIssuesPage` (and the sweeps) validate `filters`
 * all-or-nothing: a set containing even one filter the provider can't express is refused whole — empty
 * `items`, a warning, `fetchFailed` — indistinguishable from a real failure.
 *
 * The accessor returns THREE arrays, not two: `issues` (the repo-scoped issue read's filters) and
 * `issuesAccountWide` (the account-wide read's — a different provider query, so a different, generally
 * narrower, surface) split apart by a follow-up commit already on `core` by the time this was written
 * (`listIssuesPage` account-wide filtering). An issue tracker (Jira/Linear/Trello) has neither read split that
 * way — it reports everything under `issues` and leaves `issuesAccountWide` empty.
 *
 * facadeSupportedFilters.test.ts (added alongside `getSupportedFilters` itself) already pins this exhaustively:
 * every provider against every member of both filter enums, via membership checks (`.includes`, and the read
 * core's own `providerSupportsPullRequestFilters`/`providerSupportsIssueFilters` guard) — plus a "returns
 * copies" test and a handful of per-provider contrasts. What none of its four tests do is deepEqual a
 * provider's COMPLETE advertised shape in one shot, the way every other method in this file is pinned: a
 * future edit that reordered or dropped-and-re-added a member would still satisfy every `.includes` check
 * there and slip through undetected, and none of its assertions ever mention `issuesAccountWide` at all. These
 * three cases close that gap for one representative of each shape the table takes, reached only through the
 * public facade (`createIntegrationManager`) — never by importing `providers/models.js`'s `providersMetadata`
 * directly.
 */
suite('IntegrationManager.getSupportedFilters — base-case trunk (de8310e64)', () => {
	test("reports GitHub's complete PR and issue filter sets", async () => {
		// GitHub supports every member of both enums, on both issue reads: the "nothing is missing" case, and
		// the one a caller is likeliest to assume every other provider matches (it doesn't — see below).
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.GitHub), {
			pullRequests: [
				PullRequestFilter.Author,
				PullRequestFilter.Assignee,
				PullRequestFilter.ReviewRequested,
				PullRequestFilter.Mention,
			],
			pullRequestsAccountWide: [
				PullRequestFilter.Author,
				PullRequestFilter.Assignee,
				PullRequestFilter.ReviewRequested,
				PullRequestFilter.Mention,
			],
			issues: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
			issuesAccountWide: [IssueFilter.Author, IssueFilter.Assignee, IssueFilter.Mention],
		});

		manager.dispose();
	});

	test("reports Bitbucket's narrower PR set (no Assignee/Mention) and no issue filters at all", async () => {
		// Contrast case: Bitbucket's reviewer filter is keyed by account id rather than username (see
		// providers/models.ts), so it never advertises Assignee, and it has no Mention filter either — a
		// strict subset of GitHub's PR set. Its issue tracker is separately deprecated in favor of dedicated
		// issue integrations (`supportsIssues` is false), so `providersMetadata` declares neither
		// `supportedIssueFilters` nor `supportedAccountWideIssueFilters` for it; the facade must collapse both
		// absences to `[]`, not `undefined`.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		assert.deepEqual(manager.getSupportedFilters(GitCloudHostIntegrationId.Bitbucket), {
			pullRequests: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
			pullRequestsAccountWide: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
			issues: [],
			issuesAccountWide: [],
		});

		manager.dispose();
	});

	test("reports Linear's issue-tracker-only, Assignee-only filter set", async () => {
		// Contrast case for the other axis: Linear is an issue tracker, so `pullRequests` is empty — not
		// merely narrowed, like Bitbucket's, but entirely absent — and it scopes "my issues" client-side by the
		// viewer's stable id, with no author/mention equivalent (see providers/models.ts). Being a tracker
		// rather than a git host, its one filterable read reports under `issues`; `issuesAccountWide` (the
		// git-host account-wide split) stays empty even though Linear itself is very much filterable — pinning
		// that gap matters because reading a tracker's capability off `issuesAccountWide` would silently
		// under-report it as unfilterable. None of facadeSupportedFilters.test.ts's four tests names Linear
		// outside its generic "every provider" loop, which only ever checks membership, never this shape whole.
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);

		assert.deepEqual(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Linear), {
			pullRequests: [],
			pullRequestsAccountWide: [],
			issues: [IssueFilter.Assignee],
			issuesAccountWide: [],
		});

		manager.dispose();
	});
});

/**
 * `listIssuesPage({ org, project })` (a9379a43b "add project-scoped issue reads for git hosts", added today)
 * lets a git host with a project tier (Azure DevOps) narrow its account-wide issue read to one org/project,
 * instead of fanning out over every project of every org and forcing the caller to filter client-side.
 *
 * Julian's own tests for this commit — the "listIssuesPage project scoping" suite appended to
 * providerBackendSurface.test.ts, and the new providers/__tests__/azureProjectScopedIssues.test.ts — already
 * pin the scoping mechanics thoroughly: org/project reach the account-wide core, a host with no project tier is
 * refused (warning + `fetchFailed`) rather than served an unscoped list, only the requested project is drained,
 * discovery is itself scoped by org before it runs, and a scope that matches nothing is a successful empty
 * page. But every fixture across both files is a bare `{ id: 'wi-1' }`/`{ id, title, url }` cast — none of them
 * drives a scoped read through the real raw-provider-apis hooks and asserts the complete mapped `IssueShape`,
 * the gap every other test in this file exists to close for its own method. This test fills that one gap: a
 * real org+project discovery followed by a real per-project drain (`getCurrentUser` → `getAzureResourcesForUser`
 * → `getAzureProjectsForResource` → `getIssuesForAzureProject`, exactly as production calls them), asserting the
 * complete `IssueShape` in one deepEqual — including that `project` comes from the DISCOVERED project
 * descriptor, not from anything the raw work item itself carries (unlike the repo-scoped/broadened issue cases
 * above, whose `project` defaults to an empty placeholder when there is no project tier to populate).
 */
suite('listIssuesPage project scoping — base-case trunk (a9379a43b)', () => {
	test('a project-scoped read on a git host with a project tier returns the complete IssueShape, with no warnings', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('t'),
			domain: 'dev.azure.com',
		};

		stubApi(azure, {
			getCurrentUser: () => Promise.resolve(fakeAccount('me', 'Keanu Reeves')),
			getAzureResourcesForUser: () => Promise.resolve([{ id: 'org-1', name: 'contoso' }]),
			getAzureProjectsForResource: () =>
				Promise.resolve({
					values: [{ id: 'proj-1', name: 'Website', namespace: 'contoso' }],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderAzureProject>),
			getIssuesForAzureProject: () =>
				Promise.resolve({
					values: [
						providerIssue('501', {
							title: 'Investigate flaky release pipeline',
							description: 'The release pipeline fails intermittently on step 4.\n\nSeen on build 812.',
							url: 'https://dev.azure.com/contoso/Website/_workitems/edit/501',
							type: 'Bug',
							createdDate: new Date('2026-01-01T00:00:00.000Z'),
							updatedDate: new Date('2026-01-02T00:00:00.000Z'),
							author: fakeAccount('author-1', 'Ada Lovelace', {
								avatarUrl: 'https://avatars.example/ada.png',
								url: 'https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/ada',
							}),
							assignees: [fakeAccount('me', 'Keanu Reeves')],
							labels: [{ id: 'l1', name: 'bug', color: 'd73a4a', description: null }],
							commentCount: 2,
							upvoteCount: 0,
						}),
					],
					paging: { more: false, cursor: '{}' },
				} satisfies PagedResult<ProviderIssue>),
		});

		const result = await manager.listIssuesPage({
			providerId: GitCloudHostIntegrationId.AzureDevOps,
			org: 'contoso',
			project: 'Website',
		});

		assert.equal(result.items.length, 1);
		const [item] = result.items;
		assert.deepEqual(
			projectIssueShape(item),
			{
				type: 'issue',
				// Azure has no separate opaque id/GraphQL id: the work item's `id` and `number` are the same
				// value, so id and nodeId coincide here (unlike Jira/Linear's node-id-vs-key split above).
				id: '501',
				nodeId: '501',
				title: 'Investigate flaky release pipeline',
				url: 'https://dev.azure.com/contoso/Website/_workitems/edit/501',
				state: 'opened',
				closed: false,
				createdDate: new Date('2026-01-01T00:00:00.000Z'),
				updatedDate: new Date('2026-01-02T00:00:00.000Z'),
				closedDate: undefined,
				commentsCount: 2,
				thumbsUpCount: 0,
				author: {
					id: 'author-1',
					name: 'Ada Lovelace',
					avatarUrl: 'https://avatars.example/ada.png',
					url: 'https://dev.azure.com/contoso/_apis/GraphProfile/MemberAvatars/ada',
				},
				assignees: [{ id: 'me', name: 'Keanu Reeves', avatarUrl: undefined, url: undefined }],
				// Azure work items are project-scoped, not repo-scoped: unlike a git host's repo-scoped issue
				// read, there is no repository to populate.
				repository: undefined,
				labels: [{ color: 'd73a4a', name: 'bug' }],
				body: 'The release pipeline fails intermittently on step 4.\n\nSeen on build 812.',
				// The project descriptor comes from what org+project DISCOVERY resolved (resourceId/resourceName
				// are the org's id/name) — the raw work item fixture above carries no `project` field at all.
				project: { id: 'proj-1', name: 'Website', resourceId: 'org-1', resourceName: 'contoso' },
				// Work item TYPE (Bug/Task/...) surviving as issueType is new coverage: every other fixture in
				// this file leaves it unset, so issueType has never been pinned as anything but undefined before.
				issueType: 'Bug',
			},
			'a project-scoped read maps every IssueShape field, not just id',
		);
		assert.equal(item.provider.id, GitCloudHostIntegrationId.AzureDevOps);

		assert.equal(result.page.currentPage, 1);
		assert.equal(result.page.itemsPerPage, 1);
		assert.equal(result.page.truncated, undefined);
		assert.equal(result.hasMore, false);
		assert.equal(result.cursor, undefined);
		assert.deepEqual(result.warnings, [], 'a supported, matched scope carries no warning');
		assert.equal(result.fetchFailed, undefined, 'a successful scoped read leaves fetchFailed unset');

		manager.dispose();
	});
});
