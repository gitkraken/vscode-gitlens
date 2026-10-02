import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence, getPullRequestFieldPresence } from '../fieldPresence.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { assertIssuePresence, assertPullRequestPresence } from './fieldPresenceHelpers.js';
import { connectedGitLab, primarySession } from './sweepHelpers.js';

/**
 * Field presence must never call a group `fetched` that a row doesn't actually carry. So every GitLab read runs for
 * real — GitLens' own GitLab client, the integration's conversions and provider-apis' own mapper — against a server
 * that answers each GraphQL request with ONLY the fields its query selected, every one of them non-empty. A `fetched`
 * group that comes back undefined or empty is then a table that claims more than the read delivers.
 *
 * GitLab.com and a self-managed GitLab run the same reads. Their tables differ only in `comments` on provider-apis
 * rows, which GitLab.com promises and a self-managed version may answer null for.
 */

type Node = Record<string, unknown>;

interface Host {
	readonly name: string;
	readonly origin: string;
	readonly providerId: GitCloudHostIntegrationId.GitLab | GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted;
	/** What the host's table says of `comments` on a row provider-apis' mapper produced. */
	readonly comments: FieldPresence;
	connect(runtime: FakeRuntime): Promise<{
		manager: ReturnType<typeof createIntegrationManager>;
		integration: GitHostIntegration;
	}>;
}

const selfManagedDomain = 'gitlab.example.com';

const hosts: readonly Host[] = [
	{
		name: 'GitLab',
		origin: 'https://gitlab.com',
		providerId: GitCloudHostIntegrationId.GitLab,
		comments: 'fetched',
		connect: async runtime => {
			const { manager, gl } = await connectedGitLab(runtime);
			return { manager: manager, integration: gl };
		},
	},
	{
		name: 'GitLab self-managed',
		origin: `https://${selfManagedDomain}`,
		providerId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
		comments: 'not-requested',
		connect: async runtime => {
			await runtime.storage.store('integrations:configured', {
				[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted]: [
					{
						id: 'gl-1',
						cloud: true,
						integrationId: GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
						domain: `https://${selfManagedDomain}`,
						scopes: 'api',
						primary: true,
					},
				],
			});
			const manager = createIntegrationManager(runtime);
			const integration = await manager.get(
				GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted,
				selfManagedDomain,
			);
			assert.ok(integration != null, 'the self-managed integration resolves');
			(integration as unknown as { _session: ProviderAuthenticationSession })._session = {
				...primarySession('t'),
				domain: selfManagedDomain,
			};
			return { manager: manager, integration: integration };
		},
	},
];

/** Every pull request tag GitLab produces: it has no filtered search, so no `search-summary`. */
const pullRequestProjections: readonly PullRequestProjection[] = [
	'point',
	'search',
	'text-search',
	'account',
	'account-summary',
	'repos',
	'repos-summary',
	'batch',
];
/** Every issue tag GitLab produces: it has no filtered search and no tracker projects. */
const issueProjections: readonly IssueProjection[] = ['point', 'account', 'repos', 'batch'];

/** Every tag the tables could hold, to find which of them a provider has an entry for. */
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

const createdAt = '2026-01-01T00:00:00Z';
const updatedAt = '2026-01-02T00:00:00Z';

function user(username: string, id: number): Node {
	return {
		id: `gid://gitlab/User/${id}`,
		name: username,
		username: username,
		publicEmail: `${username}@example.com`,
		avatarUrl: `https://gitlab.example.com/uploads/${username}.png`,
		webUrl: `https://gitlab.example.com/${username}`,
	};
}

const me = user('me', 1);

const project: Node = {
	id: 'gid://gitlab/Project/1',
	httpUrlToRepo: 'https://gitlab.example.com/g/p.git',
	fullPath: 'g/p',
	sshUrlToRepo: 'git@gitlab.example.com:g/p.git',
	webUrl: 'https://gitlab.example.com/g/p',
	archived: false,
};

const label: Node = { color: '#ff0000', description: 'A bug', id: 'gid://gitlab/ProjectLabel/1', title: 'bug' };

/**
 * Every field provider-apis' merge request fragment selects, and the ones GitLens' own reads do. `nullCounts` is a
 * merge request GitLab answers null for the counts its schema makes nullable, which provider-apis turns into 0.
 */
function mergeRequestNode(nullCounts = false): Node {
	return {
		id: 'gid://gitlab/MergeRequest/100',
		iid: '1',
		state: 'opened',
		author: me,
		diffRefs: { baseSha: 'base', headSha: 'head' },
		diffStatsSummary: nullCounts ? null : { additions: 3, deletions: 1, fileCount: 2 },
		commitCount: nullCounts ? null : 4,
		draft: false,
		userNotesCount: 5,
		upvotes: 2,
		title: 'MR 1',
		description: 'Body',
		webUrl: 'https://gitlab.example.com/g/p/-/merge_requests/1',
		createdAt: createdAt,
		updatedAt: updatedAt,
		mergedAt: null,
		targetBranch: 'main',
		sourceBranch: 'feature',
		assignees: { nodes: [me] },
		reviewers: {
			nodes: [
				{ ...user('reviewer', 2), mergeRequestInteraction: { approved: true, reviewState: 'APPROVED' } },
				{ ...user('requested', 3), mergeRequestInteraction: { approved: false, reviewState: 'UNREVIEWED' } },
			],
		},
		mergeStatusEnum: 'CAN_BE_MERGED',
		labels: { nodes: [label] },
		milestone: null,
		headPipeline: {
			stages: {
				nodes: [
					{
						name: 'test',
						jobs: {
							nodes: [
								{
									allowFailure: false,
									createdAt: createdAt,
									finishedAt: null,
									id: 'gid://gitlab/Ci::Build/1',
									name: 'ci',
									status: 'SUCCESS',
								},
							],
						},
					},
				],
			},
		},
		project: project,
		sourceProject: project,
	};
}

/** Every field provider-apis' issue fragment selects. */
function issueNode(): Node {
	return {
		author: me,
		assignees: { nodes: [me] },
		closedAt: null,
		createdAt: createdAt,
		description: 'Body',
		dueDate: null,
		id: 'gid://gitlab/Issue/200',
		iid: '1',
		labels: { nodes: [label] },
		state: 'opened',
		title: 'Issue 1',
		type: 'ISSUE',
		updatedAt: updatedAt,
		upvotes: 2,
		userNotesCount: 5,
		webUrl: 'https://gitlab.example.com/g/p/-/issues/1',
		milestone: null,
	};
}

/** A merge request as GitLab's REST API answers it, which GitLens' own commit and free-text reads start from. */
const restMergeRequest: Node = {
	id: 100,
	iid: 1,
	author: {
		id: 1,
		name: 'me',
		avatar_url: 'https://gitlab.example.com/uploads/me.png',
		web_url: 'https://gitlab.example.com/me',
	},
	title: 'MR 1',
	description: 'Body',
	state: 'opened',
	created_at: createdAt,
	updated_at: updatedAt,
	closed_at: null,
	merged_at: null,
	source_branch: 'feature',
	target_branch: 'main',
	web_url: 'https://gitlab.example.com/g/p/-/merge_requests/1',
};

/** An issue as GitLab's REST `GET /issues` answers it. */
const restIssue: Node = {
	id: 200,
	iid: 1,
	project_id: 1,
	author: {
		id: 1,
		name: 'me',
		username: 'me',
		avatar_url: 'https://gitlab.example.com/uploads/me.png',
		web_url: 'https://gitlab.example.com/me',
	},
	assignees: [
		{
			id: 1,
			name: 'me',
			username: 'me',
			avatar_url: 'https://gitlab.example.com/uploads/me.png',
			web_url: 'https://gitlab.example.com/me',
		},
	],
	user_notes_count: 5,
	closed_at: null,
	created_at: createdAt,
	description: 'Body',
	labels: ['bug'],
	updated_at: updatedAt,
	upvotes: 2,
	state: 'opened',
	title: 'Issue 1',
	web_url: 'https://gitlab.example.com/g/p/-/issues/1',
	references: { full: 'g/p#1' },
};

/** The fields a query selects, by name, nested: what {@link select} keeps of a full answer. */
type Selection = Map<string, Selection | undefined>;

/**
 * Reads the selection set of a GraphQL operation. Field arguments, variable definitions and aliases are skipped,
 * which is all the queries these reads send need.
 */
function parseSelection(query: string): Selection {
	const tokens = query.match(/[{}():]|[\w$]+/g) ?? [];
	let i = 0;

	const skipParens = (): void => {
		let depth = 0;
		do {
			if (tokens[i] === '(') {
				depth++;
			} else if (tokens[i] === ')') {
				depth--;
			}
			i++;
		} while (depth > 0);
	};

	const parseSet = (): Selection => {
		const selection: Selection = new Map();
		i++; // '{'
		while (tokens[i] !== '}') {
			const name = tokens[i++];
			if (tokens[i] === ':') {
				i++;
				i++;
			}
			if (tokens[i] === '(') {
				skipParens();
			}
			selection.set(name, tokens[i] === '{' ? parseSet() : undefined);
		}
		i++; // '}'
		return selection;
	};

	i = 2; // `query <name>`
	if (tokens[i] === '(') {
		skipParens();
	}
	return parseSet();
}

/** `value`, cut down to the fields `selection` names. */
function select(value: unknown, selection: Selection | undefined): unknown {
	if (selection == null || value == null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map(item => select(item, selection));

	return Object.fromEntries(
		Object.entries(value)
			.filter(([field]) => selection.has(field))
			.map(([field, child]) => [field, select(child, selection.get(field))]),
	);
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

function connection(nodes: Node[]): Node {
	return { pageInfo: { endCursor: null, hasNextPage: false }, nodes: nodes };
}

/** The data each GraphQL operation answers with, before its query cuts it down to what it selected. */
function answerGraphQL(operation: string, nullCounts: boolean): Node | undefined {
	const mr = mergeRequestNode(nullCounts);
	switch (operation) {
		case 'getCurrentUser':
			return { currentUser: me };
		case 'getProjectId':
			return { project: { id: project.id } };
		case 'getMergeRequest':
			return { project: { mergeRequest: mr } };
		case 'getMergeRequestForBranch':
			return { project: { mergeRequests: { nodes: [mr] } } };
		case 'getPullRequestForRepo':
			return { project: { ...project, mergeRequest: mr } };
		case 'getPullRequestsForRepo':
			return { project: { ...project, mergeRequests: connection([mr]) } };
		case 'getPullRequestsForUser':
			return {
				user: {
					authoredMergeRequests: connection([mr]),
					assignedMergeRequests: connection([mr]),
					reviewRequestedMergeRequests: connection([mr]),
				},
			};
		case 'getMergeRequestsForBranch':
			return {
				project: {
					mergeRequests: {
						count: 1,
						pageInfo: { hasNextPage: false },
						nodes: [
							{
								iid: '1',
								updatedAt: updatedAt,
								sourceBranch: 'feature',
								project: { id: project.id },
								sourceProject: { id: project.id, fullPath: project.fullPath },
							},
						],
					},
				},
			};
		case 'GetSingleIssue':
			return { project: { ...project, issue: issueNode() } };
		case 'GetIssuesFromProject':
			return { project: { ...project, issues: connection([issueNode()]) } };
	}
	return undefined;
}

/** Answers every GitLab request, GitLens' own and provider-apis', and records each GraphQL operation's name. */
function serveGitLab(runtime: FakeRuntime, origin: string, options?: { nullCounts?: boolean }): string[] {
	const operations: string[] = [];
	runtime.http.fetch = (input, init) => {
		const url = new URL(input.toString());
		// A read that left the host it was connected to fails, rather than being answered.
		if (url.origin !== origin) return Promise.reject(new Error(`unexpected host: ${url.href}`));

		if (url.pathname.endsWith('/graphql')) {
			const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
				query: string;
				variables?: Record<string, unknown>;
			};
			const operation = /query\s+(\w+)/.exec(body.query)?.[1] ?? 'unknown';
			operations.push(operation);

			if (operation === 'getMergeRequests') {
				// GitLens' own free-text search's detail read: one aliased merge request per search hit.
				const { diffRefs, project: mrProject, sourceProject } = mergeRequestNode();
				return Promise.resolve(
					json({
						data: Object.fromEntries(
							Object.keys(body.variables ?? {}).map((_, i) => [
								`mergeRequest_${i}`,
								{ diffRefs: diffRefs, project: mrProject, sourceProject: sourceProject },
							]),
						),
					}),
				);
			}

			const data = answerGraphQL(operation, options?.nullCounts ?? false);
			if (data == null) return Promise.reject(new Error(`unexpected GraphQL operation '${operation}'`));

			return Promise.resolve(json({ data: select(data, parseSelection(body.query)) }));
		}

		const path = url.pathname.replace(/^.*\/api\/v4\//, '');
		if (/^projects\/\d+\/repository\/commits\/\w+\/merge_requests$/.test(path)) {
			operations.push('commit merge requests');
			return Promise.resolve(json([restMergeRequest]));
		}
		if (path === 'search/' || path === 'search') {
			operations.push('search merge requests');
			return Promise.resolve(json([restMergeRequest]));
		}
		if (/^projects\/\d+$/.test(path)) {
			operations.push('project');
			return Promise.resolve(json({ id: 1, path_with_namespace: 'g/p', archived: false }));
		}
		if (path === 'issues') {
			operations.push('issues');
			return Promise.resolve(json([restIssue]));
		}
		return Promise.reject(new Error(`unexpected request: ${url.href}`));
	};
	// The point reads go through the host's cache, which these tests don't keep.
	runtime.cache.getPullRequest = (_id, _resource, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => loader({} as never).value;
	return operations;
}

const exercisedPullRequestProjections = new Map<string, Set<PullRequestProjection>>();
const exercisedIssueProjections = new Map<string, Set<IssueProjection>>();

function exercised<T>(map: Map<string, Set<T>>, providerId: string): Set<T> {
	let set = map.get(providerId);
	if (set == null) {
		set = new Set();
		map.set(providerId, set);
	}
	return set;
}

/** Asserts a row's tag, and that its presence never claims a group the row doesn't carry. */
function assertPullRequestRow(
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
): Readonly<Record<PullRequestFieldGroup, FieldPresence>> {
	const presence = assertPullRequestPresence(pr, projection);
	exercised(exercisedPullRequestProjections, pr!.provider.id).add(projection);
	return presence;
}

function assertIssueRow(
	issue: IssueShape | undefined,
	projection: IssueProjection,
): Readonly<Record<IssueFieldGroup, FieldPresence>> {
	const presence = assertIssuePresence(issue, projection);
	exercised(exercisedIssueProjections, issue!.provider.id).add(projection);
	return presence;
}

/** GitLens' own point reads and free-text search: they carry the merge request's identity and refs, and nothing else. */
function assertOwnRow(pr: PullRequestShape | undefined, projection: PullRequestProjection): PullRequest {
	const presence = assertPullRequestRow(pr, projection);
	const row = pr as PullRequest;

	for (const [group, value] of Object.entries(presence)) {
		assert.notEqual(value, 'fetched', `${projection}: '${group}' is not promised`);
	}
	// Selected (`description`) but never put on the row.
	assert.equal(row.body, undefined);
	assert.equal(presence.description, 'not-requested');
	assert.equal(presence.stack, 'unavailable');
	return row;
}

/**
 * provider-apis' mapper's rows. What the table names: a review decision derived from the reviewers, no viewer, and no
 * stack.
 */
function assertProviderApisRow(
	host: Host,
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
): PullRequest {
	const presence = assertPullRequestRow(pr, projection);
	const row = pr as PullRequest;

	assert.equal(presence.comments, host.comments, `${projection}: comments on ${host.name}`);
	// Set, from the reviewers, though the host has no review decision of its own to read.
	assert.ok(row.reviewDecision != null, `${projection}: the derived decision is set`);
	assert.equal(presence.reviewDecision, 'not-requested');
	// Selected nowhere, so unset: provider-apis sends no permissions either.
	assert.equal(row.repository.accessLevel, undefined);
	assert.equal(row.viewerCanUpdate, undefined);
	assert.equal(presence.access, 'not-requested');
	assert.equal(row.stack, undefined);
	assert.equal(presence.stack, 'unavailable');
	// The counts GitLab makes nullable, and the review decision, are never promised.
	assert.equal(presence.diffStats, 'not-requested');
	assert.equal(presence.commitCount, 'not-requested');
	assert.equal(presence.authoredByMe, 'not-requested');
	return row;
}

/** `repository.accessLevel` is never read for a GitLab issue. */
function assertIssueViewerNotRead(
	issue: IssueShape | undefined,
	presence: Readonly<Record<IssueFieldGroup, FieldPresence>>,
): void {
	assert.equal(issue?.repository?.accessLevel, undefined);
	assert.equal(presence.access, 'not-requested');
}

const repo = { key: 'g/p', owner: 'g', name: 'p' };
const repos = [{ namespace: 'g', name: 'p' }];

for (const host of hosts) {
	suite(`Field presence: every ${host.name} read stamps its tag, and its table holds for the row it produces`, () => {
		async function connected(options?: { nullCounts?: boolean }): Promise<{
			manager: ReturnType<typeof createIntegrationManager>;
			integration: GitHostIntegration;
			operations: string[];
		}> {
			const runtime = createFakeRuntime();
			const operations = serveGitLab(runtime, host.origin, options);
			return { ...(await host.connect(runtime)), operations: operations };
		}

		test('point reads: by number, for a branch and for a commit', async () => {
			const { manager, integration: gl, operations } = await connected();

			const byNumber = await gl.getPullRequest(repo, '1', { throwOnError: true });
			const forBranch = await gl.getPullRequestForBranch(repo, 'feature', { throwOnError: true });
			const forCommit = await gl.getPullRequestForCommit(repo, 'a'.repeat(40), { throwOnError: true });

			// The by-commit read is REST, and finds the project first.
			assert.ok(operations.includes('getProjectId'));
			assert.ok(operations.includes('commit merge requests'));
			assert.ok(operations.includes('getMergeRequestForBranch'));
			assert.ok(operations.includes('getMergeRequest'));

			const row = assertOwnRow(byNumber, 'point');
			// Selected by neither, so unset.
			assert.equal(row.mergeableState, undefined);
			assertOwnRow(forBranch, 'point');
			assertOwnRow(forCommit, 'point');

			manager.dispose();
		});

		test('the free-text search', async () => {
			const { manager, integration: gl, operations } = await connected();

			const searched = await gl.searchPullRequests('crash', repo);

			assert.ok(operations.includes('search merge requests'));
			assert.ok(operations.includes('getMergeRequests'));
			const row = assertOwnRow(searched?.[0], 'text-search');
			assert.equal(row.mergeableState, undefined);

			manager.dispose();
		});

		test('the host\'s own "my pull requests" search', async () => {
			const { manager, integration: gl } = await connected();

			const mine = await gl.searchMyPullRequests(repo);

			assert.equal(mine?.error, undefined);
			const row = assertProviderApisRow(host, mine?.value?.[0], 'search');
			// Unset: provider-apis sends no permissions, and the viewer isn't read.
			assert.equal(row.viewerCanUpdate, undefined);
			assert.equal(getPullRequestFieldPresence(row)?.access, 'not-requested');

			manager.dispose();
		});

		test('the account-wide list and sweeps', async () => {
			const { manager } = await connected();

			const listed = await manager.listPullRequestsPage({ providerId: host.providerId });
			const swept = await manager.sweepPullRequests({ providerIds: [host.providerId] });
			const sweptWithReviews = await manager.sweepPullRequests({
				providerIds: [host.providerId],
				includeReviews: true,
			});

			// provider-apis honors neither `summary` nor `includeReviews`, so the two projections read alike.
			assert.deepEqual(
				getPullRequestFieldPresence(sweptWithReviews.items[0]),
				getPullRequestFieldPresence(listed.items[0]),
			);
			for (const pr of [listed.items[0], swept.items[0]]) {
				const row = assertProviderApisRow(host, pr, 'account-summary');
				assert.equal(row.viewerCanUpdate, undefined);
			}
			assertProviderApisRow(host, sweptWithReviews.items[0], 'account');

			manager.dispose();
		});

		test('the repository-scoped list and sweep', async () => {
			const { manager } = await connected();

			const listed = await manager.listPullRequestsPage({ providerId: host.providerId, repos: repos });
			const summary = await manager.listPullRequestsPage({
				providerId: host.providerId,
				repos: repos,
				summary: true,
			});
			const swept = await manager.sweepPullRequests({ providerIds: [host.providerId], repos: repos });

			for (const pr of [listed.items[0], swept.items[0]]) {
				assertProviderApisRow(host, pr, 'repos');
			}
			assertProviderApisRow(host, summary.items[0], 'repos-summary');

			manager.dispose();
		});

		test('the batch and branch reads', async () => {
			const { manager } = await connected();

			const batch = await manager.getPullRequestsBatch({
				providerId: host.providerId,
				targets: [{ key: 'pr', owner: 'g', repo: 'p', number: 1 }],
			});
			const branches = await manager.getPullRequestsForBranches({
				providerId: host.providerId,
				targets: [{ key: 'branch', owner: 'g', repo: 'p', branch: 'feature' }],
			});

			for (const pr of [batch.items[0]?.pullRequest, branches.items[0]?.pullRequests[0]]) {
				assertProviderApisRow(host, pr, 'batch');
			}

			manager.dispose();
		});

		test('a merge request with null counts reads back as 0, and the table does not promise them', async () => {
			const { manager } = await connected({ nullCounts: true });

			const batch = await manager.getPullRequestsBatch({
				providerId: host.providerId,
				targets: [{ key: 'pr', owner: 'g', repo: 'p', number: 1 }],
			});
			const listed = await manager.listPullRequestsPage({ providerId: host.providerId, repos: repos });

			for (const [pr, projection] of [
				[batch.items[0]?.pullRequest, 'batch'],
				[listed.items[0], 'repos'],
			] as const) {
				const row = assertProviderApisRow(host, pr, projection);
				const presence = getPullRequestFieldPresence(row)!;
				// A null `diffStatsSummary` comes back as zeros, and a null `commitCount` as 0.
				assert.equal(row.additions, 0);
				assert.equal(row.deletions, 0);
				assert.equal(row.filesChanged, 0);
				assert.equal(presence.diffStats, 'not-requested');
				assert.equal(row.commitCount, 0);
				assert.equal(presence.commitCount, 'not-requested');
			}

			manager.dispose();
		});

		test('issue reads: point, account-wide, "my issues", repository-scoped and batch', async () => {
			const { manager, integration: gl } = await connected();

			const point = await gl.getIssue(repo, '1');
			const account = await manager.listIssuesPage({ providerId: host.providerId });
			const mine = await gl.searchMyIssues(repo);
			const scoped = await manager.listIssuesPage({ providerId: host.providerId, repos: repos });
			const batch = await manager.getIssuesBatch({
				providerId: host.providerId,
				targets: [{ key: 'issue', owner: 'g', repo: 'p', number: 1 }],
			});

			// GraphQL, whose comment count is nullable.
			for (const [issue, projection] of [
				[point, 'point'],
				[scoped.items[0], 'repos'],
				[batch.items[0]?.issue, 'batch'],
			] as const) {
				const presence = assertIssueRow(issue, projection);
				assert.equal(presence.comments, host.comments, `${projection}: comments on ${host.name}`);
				assertIssueViewerNotRead(issue, presence);
			}
			// The account-wide REST read's comment count is always a number.
			for (const issue of [account.items[0], mine?.[0]]) {
				const presence = assertIssueRow(issue, 'account');
				assert.equal(presence.comments, 'fetched');
				assertIssueViewerNotRead(issue, presence);
			}

			manager.dispose();
		});
	});
}

suite('Field presence: every GitLab projection was exercised above', () => {
	for (const host of hosts) {
		test(`${host.name}'s pull request and issue tables are the reads driven`, () => {
			const pullRequestsTabled = allPullRequestProjections.filter(
				projection =>
					getPullRequestFieldPresence({
						provider: { id: host.providerId },
						projection: projection,
					} as unknown as PullRequestShape) != null,
			);
			const issuesTabled = allIssueProjections.filter(
				projection =>
					getIssueFieldPresence({
						provider: { id: host.providerId },
						projection: projection,
					} as unknown as IssueShape) != null,
			);

			// Both hosts have the entries this suite lists for GitLab, and nothing else.
			assert.deepEqual([...pullRequestsTabled].sort(), [...pullRequestProjections].sort());
			assert.deepEqual([...issuesTabled].sort(), [...issueProjections].sort());
			assert.deepEqual(
				[...(exercisedPullRequestProjections.get(host.providerId) ?? [])].sort(),
				[...pullRequestsTabled].sort(),
			);
			assert.deepEqual(
				[...(exercisedIssueProjections.get(host.providerId) ?? [])].sort(),
				[...issuesTabled].sort(),
			);
		});
	}
});
