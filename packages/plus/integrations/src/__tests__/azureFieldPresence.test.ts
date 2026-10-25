import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueProjection, IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequest, PullRequestProjection, PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeableState } from '@gitlens/git/models/pullRequest.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { FieldPresence, IssueFieldGroup, PullRequestFieldGroup } from '../fieldPresence.js';
import { getIssueFieldPresence, getPullRequestFieldPresence } from '../fieldPresence.js';
import { createIntegrationService } from '../integrationService.js';
import type { GitHostIntegration } from '../models/gitHostIntegration.js';
import { azureRestDiscoveryResponse } from '../providers/azure/__tests__/fixtures.js';
import type { FakeRuntime } from './fakeRuntime.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { assertIssuePresence, assertPullRequestPresence } from './fieldPresenceHelpers.js';
import { primarySession } from './sweepHelpers.js';

/**
 * Field presence must never call a group `fetched` that a row doesn't actually carry. So every Azure DevOps read runs
 * for real, on Azure DevOps Services and on Azure DevOps Server — the integration, GitLens' own client and
 * provider-apis' — against a server that answers each request at the HTTP level, every value a read selects
 * non-empty: a description, a reviewer who has voted and one still requested, a work item with an assignee, tags and
 * comments. A `fetched` group that comes back undefined or empty is then a table that claims more than the read
 * delivers. The same fixture also shows each known placeholder carrying a value the table refuses to call fetched.
 */

type Node = Record<string, unknown>;

const org = 'org';
const projectName = 'proj';
const projectId = 'b3a1c2d4-0000-4000-8000-000000000001';
const repoName = 'r';
const repoId = '9f1e2d3c-0000-4000-8000-000000000002';
const me = 'me';

/** The description of a pull request, past the 400 characters Azure keeps of it in a list. */
const fullDescription = `Pull request body. ${'x'.repeat(500)}`;
const listedDescriptionLength = 400;
const commit = 'a'.repeat(40);

const pullRequestIds = [1, 2, 3];
const workItemId = 7;

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status: status, headers: { 'content-type': 'application/json' } });
}

/** The token an `Authorization` header carries, whether as a bearer or as a basic credential's password. */
function credentialOf(authorization: string | null): string {
	if (authorization == null) return '';
	if (authorization.toLowerCase().startsWith('basic ')) {
		return Buffer.from(authorization.slice(6), 'base64')
			.toString()
			.replace(/^[^:]*:/, '');
	}

	return authorization.replace(/^bearer /i, '');
}

function identity(id: string, extra?: Node): Node {
	return {
		displayName: `User ${id}`,
		url: `https://spsprodcus5.vssps.visualstudio.com/A1/_apis/Identities/${id}`,
		_links: { avatar: { href: `https://dev.azure.com/${org}/_apis/GraphProfile/MemberAvatars/${id}` } },
		id: id,
		uniqueName: `${id}@example.com`,
		imageUrl: `https://dev.azure.com/${org}/_api/_common/identityImage?id=${id}`,
		descriptor: `aad.${id}`,
		...extra,
	};
}

function commitRef(sha: string): Node {
	return {
		commitId: sha,
		url: `https://dev.azure.com/${org}/${projectId}/_apis/git/repositories/${repoId}/commits/${sha}`,
	};
}

/** A pull request as Azure returns it: one reviewer who has approved and one still requested. */
function azurePullRequest(base: string, id: number, description: string): Node {
	const url = `${base}/${projectId}/_apis/git/repositories/${repoId}/pullRequests/${id}`;
	return {
		repository: {
			id: repoId,
			name: repoName,
			url: `${base}/${projectId}/_apis/git/repositories/${repoId}`,
			project: { id: projectId, name: projectName, state: 'wellFormed', visibility: 'private' },
		},
		pullRequestId: id,
		codeReviewId: id,
		status: 'active',
		createdBy: identity('author'),
		creationDate: `2026-01-02T03:04:0${id}.1234567Z`,
		title: `Fix crash ${id}`,
		description: description,
		sourceRefName: `refs/heads/feature-${id}`,
		targetRefName: 'refs/heads/main',
		mergeStatus: 'succeeded',
		isDraft: false,
		mergeId: `merge-${id}`,
		lastMergeSourceCommit: commitRef(`head-${id}`),
		lastMergeTargetCommit: commitRef(`base-${id}`),
		lastMergeCommit: commitRef(`merge-${id}`),
		reviewers: [
			identity('approver', { vote: 10, hasDeclined: false, isFlagged: false, isRequired: true }),
			identity('requested', { vote: 0, hasDeclined: false, isFlagged: false, isRequired: true }),
		],
		url: url,
		_links: { self: { href: url } },
		supportsIterations: true,
		artifactId: `vstfs:///Git/PullRequestId/${projectId}%2f${repoId}%2f${id}`,
	};
}

/**
 * What a test changes about the server: the work item's fields (an `undefined` one is left out, as Azure leaves out a
 * field without a value), the organization's field catalog, and a log of the routes asked for.
 */
interface ServerFixture {
	workItemFields?: Node;
	fieldCatalog?: () => Response;
	routes?: string[];
	/**
	 * The id the organization (Azure DevOps Server: collection) knows the account by, or a function of the request's
	 * token; the profile's when omitted.
	 */
	orgUserId?: string | ((token: string) => string);
	/** Called with each route below the organization before it is answered. */
	onRoute?: (route: string, token: string) => void;
	/** Leaves the organization's connection data unanswered, as a hung request would. */
	hangIdentity?: boolean;
	/** Fails the organization's (Azure DevOps Server: collection's) connection data with a server error, while true. */
	failIdentity?: boolean | (() => boolean);
}

function identityFails(fixture: ServerFixture): boolean {
	return typeof fixture.failIdentity === 'function' ? fixture.failIdentity() : fixture.failIdentity === true;
}

/** A work item with an assignee, tags, a description and comments. */
function azureWorkItem(base: string, id: number, overrides?: Node): Node {
	const fields: Node = {
		'System.AreaPath': projectName,
		'System.TeamProject': projectName,
		'System.IterationPath': projectName,
		'System.WorkItemType': 'Task',
		'System.State': 'Active',
		'System.CreatedDate': '2026-01-01T00:00:00.123Z',
		'System.CreatedBy': identity('author'),
		'System.AssignedTo': identity('assignee'),
		'System.ChangedDate': '2026-01-02T00:00:00.123Z',
		'System.CommentCount': 3,
		'System.Title': `Work item ${id}`,
		'System.Description': '<div>Work item body</div>',
		'System.Tags': 'bug; ui',
		...overrides,
	};
	return {
		id: id,
		rev: 3,
		fields: Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
		_links: { html: { href: `${base}/${projectName}/_workitems/edit/${id}` } },
		url: `${base}/${projectId}/_apis/wit/workItems/${id}`,
	};
}

/**
 * Answers the routes below one organization (Azure DevOps Server: collection) that both flavors share. `segments` is
 * the path below it, decoded and lower-cased: Azure serves these routes case-insensitively and the clients spell them
 * both ways. A list truncates each description, as Azure does; a read by id returns it whole.
 */
function answerCollection(
	base: string,
	segments: string[],
	url: URL,
	body: string | undefined,
	fixture: ServerFixture,
	token = '',
): Response {
	const [first, ...rest] = segments;
	const route = first === '_apis' ? segments.join('/') : `{project}/${rest.join('/')}`;
	fixture.onRoute?.(route, token);
	fixture.routes?.push(route);
	const pullRequests = pullRequestIds.map(id => azurePullRequest(base, id, fullDescription));
	const listed: Node[] = pullRequests.map(pr => ({
		...pr,
		description: String(pr.description).slice(0, listedDescriptionLength),
	}));

	switch (true) {
		case route === '_apis/connectiondata': {
			const id = typeof fixture.orgUserId === 'function' ? fixture.orgUserId(token) : (fixture.orgUserId ?? me);
			const user = { id: id, providerDisplayName: me, properties: { Account: { $value: `${me}@example.com` } } };
			return json({ authenticatedUser: user, authorizedUser: user });
		}
		case route === '_apis/projects':
			return json({ value: [{ id: projectId, name: projectName }] });
		case route === '{project}/_apis/git/repositories':
			return json({ value: [repository(base)] });
		case /^_apis\/git\/repositories\/[^/]+$/.test(route) ||
			/^\{project\}\/_apis\/git\/repositories\/[^/]+$/.test(route):
			return json(repository(base));
		case /^\{project\}\/_apis\/git\/repositories\/[^/]+\/pullrequests\/\d+$/.test(route):
		case /^\{project\}\/_apis\/git\/pullrequests\/\d+$/.test(route): {
			const id = Number(segments.at(-1));
			return json(pullRequests.find(pr => pr.pullRequestId === id));
		}
		case /^\{project\}\/_apis\/git\/repositories\/[^/]+\/pullrequestquery$/.test(route): {
			const rev = (JSON.parse(body!) as { queries: { items: string[] }[] }).queries[0].items[0];
			return json({ results: [{ [rev]: [pullRequests[0]] }] });
		}
		case /^\{project\}\/_apis\/git\/repositories\/[^/]+\/pullrequests$/.test(route):
		case route === '{project}/_apis/git/pullrequests': {
			const source = url.searchParams.get('searchCriteria.sourceRefName');
			const top = Number(url.searchParams.get('$top') ?? 100);
			const skip = Number(url.searchParams.get('$skip') ?? 0);
			return json({
				value: listed.filter(pr => source == null || pr.sourceRefName === source).slice(skip, skip + top),
			});
		}
		case route.endsWith('/_apis/wit/wiql') || route === '_apis/wit/wiql':
			return json({ workItems: [{ id: workItemId }] });
		case route.endsWith('/_apis/wit/workitemsbatch') || route === '_apis/wit/workitemsbatch': {
			const ids = (JSON.parse(body!) as { ids: number[] }).ids;
			return json({ value: ids.map(id => azureWorkItem(base, id, fixture.workItemFields)) });
		}
		case /^\{project\}\/_apis\/wit\/workitems\/\d+$/.test(route):
			return json(azureWorkItem(base, Number(segments.at(-1)), fixture.workItemFields));
		case route === '_apis/wit/fields':
			return fixture.fieldCatalog?.() ?? json({ count: 0, value: [] });
		case route === '{project}/_apis/wit/workitemtypes':
			return json({ value: [{ name: 'Task' }] });
		case /^\{project\}\/_apis\/wit\/workitemtypes\/[^/]+\/states$/.test(route):
			return json({ value: [{ name: 'Active', color: '', category: 'InProgress' }], count: 1 });
		default:
			return json({ message: `unhandled ${url.pathname}` }, 404);
	}
}

function repository(base: string): Node {
	return {
		id: repoId,
		name: repoName,
		project: { id: projectId, name: projectName },
		remoteUrl: `${base}/${projectName}/_git/${repoName}`,
		webUrl: `${base}/${projectName}/_git/${repoName}`,
		sshUrl: `git@ssh.dev.azure.com:v3/${org}/${projectName}/${repoName}`,
	};
}

/** The point reads go through the host's cache, which these tests don't keep. */
function bypassPointReadCache(runtime: FakeRuntime): void {
	runtime.cache.getPullRequest = (_id, _resource, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForBranch = (_branch, _repo, _integration, loader) => loader({} as never).value;
	runtime.cache.getPullRequestForSha = (_sha, _repo, _integration, loader) => loader({} as never).value;
}

type Manager = ReturnType<typeof createIntegrationService>;

interface Connected {
	manager: Manager;
	/** The integration the point reads go through. */
	azure: GitHostIntegration;
	providerId: GitCloudHostIntegrationId.AzureDevOps | GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	/** What the manager's reads select the connection by: a self-managed host is addressed by its connection. */
	target: { providerId: string; connectionId?: string; domain?: string };
}

/** Azure DevOps Services: the account's organizations come from the profile, and its projects from the organization. */
async function connectedServices(fixture: ServerFixture = {}): Promise<Connected> {
	const runtime = createFakeRuntime();
	bypassPointReadCache(runtime);
	const base = `https://dev.azure.com/${org}`;
	runtime.http.fetch = (input, init) => {
		const discovery = azureRestDiscoveryResponse(input);
		if (discovery != null) return Promise.resolve(discovery);

		const url = new URL(input.toString());
		if (url.hostname === 'app.vssps.visualstudio.com') {
			if (url.pathname.endsWith('/profile/profiles/me')) {
				return Promise.resolve(json({ id: me, displayName: me, emailAddress: `${me}@example.com` }));
			}
			if (url.pathname.endsWith('/accounts')) {
				return Promise.resolve(json({ value: [{ accountId: `${org}-id`, accountName: org }] }));
			}
			return Promise.resolve(json({ message: `unhandled ${url.href}` }, 404));
		}

		const segments = url.pathname
			.split('/')
			.filter(Boolean)
			.map(s => decodeURIComponent(s).toLowerCase());
		if (fixture.hangIdentity && segments.at(-1) === 'connectiondata') return new Promise<Response>(() => {});
		if (identityFails(fixture) && segments.at(-1) === 'connectiondata') {
			return Promise.resolve(json({ message: 'identity unavailable' }, 500));
		}

		assert.equal(url.hostname, 'dev.azure.com', url.href);
		assert.equal(segments[0], org, url.href);
		return Promise.resolve(
			answerCollection(
				base,
				segments.slice(1),
				url,
				typeof init?.body === 'string' ? init.body : undefined,
				fixture,
				credentialOf(new Headers(init?.headers).get('authorization')),
			),
		);
	};

	const manager = createIntegrationService(runtime);
	const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
	(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
		...primarySession('t'),
		domain: 'dev.azure.com',
	};
	return {
		manager: manager,
		azure: azure,
		providerId: GitCloudHostIntegrationId.AzureDevOps,
		target: { providerId: GitCloudHostIntegrationId.AzureDevOps },
	};
}

/**
 * Azure DevOps Server: one installation below `https://server.test/tfs`, whose one collection is `org`. Each
 * collection knows the account by an identity of its own, and only the server level lists the collections.
 */
async function connectedServer(fixture: ServerFixture = {}): Promise<Connected> {
	const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;
	const installation = 'https://server.test/tfs';
	const runtime = createFakeRuntime();
	bypassPointReadCache(runtime);
	const descriptor = {
		tokenId: 'connection',
		provider: toCloudIntegrationType[id],
		type: 'pat',
		domain: installation,
	};
	runtime.account.getAccount = async () => ({ id: me });
	runtime.account.fetchGkApi = async path => {
		if (path === 'v1/provider-tokens') return json({ data: [{ ...descriptor, secondaries: [] }] });

		return json({ data: { ...descriptor, accessToken: `${me}-token`, expiresIn: 3600, scopes: '' } });
	};
	runtime.http.fetch = (input, init) => {
		const discovery = azureRestDiscoveryResponse(input);
		if (discovery != null) return Promise.resolve(discovery);

		const url = new URL(input.toString());
		const segments = url.pathname
			.slice('/tfs'.length)
			.split('/')
			.filter(Boolean)
			.map(s => decodeURIComponent(s).toLowerCase());
		assert.ok(url.pathname.startsWith('/tfs/'), url.href);

		const atServer = segments[0] === '_apis';
		if (segments.at(-1) === 'connectiondata') {
			if (!atServer) {
				fixture.routes?.push('_apis/connectiondata');
				if (fixture.hangIdentity) return new Promise<Response>(() => {});
				if (identityFails(fixture)) return Promise.resolve(json({ message: 'identity unavailable' }, 500));
			}

			const id = atServer || typeof fixture.orgUserId === 'function' ? me : (fixture.orgUserId ?? me);
			const user = { id: id, providerDisplayName: me, properties: { Account: { $value: `${me}@example.com` } } };
			return Promise.resolve(
				json({
					authenticatedUser: user,
					authorizedUser: user,
					instanceId: atServer ? 'server-id' : `${org}-id`,
					webApplicationRelativeDirectory: atServer ? null : `${org}/`,
				}),
			);
		}
		if (atServer && segments.join('/') === '_apis/projectcollections') {
			return Promise.resolve(json({ value: [{ id: `${org}-id`, name: org, url: '' }] }));
		}
		if (segments[0] !== org) return Promise.resolve(json({ message: 'unknown collection' }, 404));

		return Promise.resolve(
			answerCollection(
				`${installation}/${org}`,
				segments.slice(1),
				url,
				typeof init?.body === 'string' ? init.body : undefined,
				fixture,
			),
		);
	};

	const manager = createIntegrationService(runtime);
	await manager.refreshConnections();
	const [connection] = manager.getConfigured(id);
	const azure = await manager.get(id, connection.domain);
	assert.ok(azure != null);
	return {
		manager: manager,
		azure: azure,
		providerId: id,
		target: { providerId: id, connectionId: connection.id, domain: connection.domain },
	};
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

const providerIds = [GitCloudHostIntegrationId.AzureDevOps, GitSelfManagedHostIntegrationId.AzureDevOpsServer] as const;
const exercisedPullRequestProjections = new Map<string, Set<PullRequestProjection>>(
	providerIds.map(id => [id, new Set()]),
);
const exercisedIssueProjections = new Map<string, Set<IssueProjection>>(providerIds.map(id => [id, new Set()]));

/** Asserts an Azure row's tag, and that its presence never claims a group the row doesn't carry. */
function assertPullRequestRow(
	providerId: string,
	pr: PullRequestShape | undefined,
	projection: PullRequestProjection,
): Readonly<Record<PullRequestFieldGroup, FieldPresence>> {
	const presence = assertPullRequestPresence(pr, projection, `${providerId} ${projection}`);
	exercisedPullRequestProjections.get(providerId)!.add(projection);
	return presence;
}

function assertIssueRow(
	providerId: string,
	issue: IssueShape | undefined,
	projection: IssueProjection,
): Readonly<Record<IssueFieldGroup, FieldPresence>> {
	const presence = assertIssuePresence(issue, projection, `${providerId} ${projection}`);
	exercisedIssueProjections.get(providerId)!.add(projection);
	return presence;
}

/**
 * What every row a list read returns carries beside its fetched groups: Azure cuts a listed description short, so the
 * row has a body that `description` refuses to call fetched; the reviewers fill `assignees`, which Azure has none of.
 */
function assertListedPullRequest(
	pr: PullRequestShape | undefined,
	presence: Readonly<Record<PullRequestFieldGroup, FieldPresence>>,
	label: string,
): void {
	const row = pr as PullRequest;
	assert.equal(row.body?.length, listedDescriptionLength, `${label}: the listed body is cut`);
	assert.equal(presence.description, 'not-requested', label);
	assert.equal(row.mergeableState, PullRequestMergeableState.Mergeable, label);
	assertReviewersAsAssignees(row, presence, label);
}

/** Azure DevOps has no assignees: both converters fill them with the reviewers, which `reviews` already holds. */
function assertReviewersAsAssignees(
	row: PullRequest,
	presence: Readonly<Record<PullRequestFieldGroup, FieldPresence>>,
	label: string,
): void {
	assert.equal(row.assignees?.length, 2, `${label}: the reviewers stand in for assignees`);
	assert.equal(presence.assignees, 'unavailable', label);
	assert.equal(presence.reactions, 'unavailable', label);
}

const repoResource = {
	key: `${org}/${projectName}/${repoName}`,
	owner: org,
	name: `${projectName}/_git/${repoName}`,
	project: projectName,
};
const projectResource = { key: `${org}/${projectName}`, owner: org, name: projectName };
const repos = [{ namespace: org, name: repoName, project: projectName }];

for (const [label, connect] of [
	['Azure DevOps Services', connectedServices],
	['Azure DevOps Server', connectedServer],
] as const) {
	suite(`Field presence: every ${label} read stamps its tag, and its table holds for the row it produces`, () => {
		test('point reads: by number, for a branch and for a commit', async () => {
			const { manager, azure, providerId } = await connect();

			const byNumber = await azure.getPullRequest(repoResource, '1', { throwOnError: true });
			const forBranch = await azure.getPullRequestForBranch(repoResource, 'feature-1', { throwOnError: true });
			const forCommit = await azure.getPullRequestForCommit(repoResource, commit, { throwOnError: true });

			for (const pr of [byNumber, forBranch, forCommit]) {
				const presence = assertPullRequestRow(providerId, pr, 'point');
				const row = pr as PullRequest;
				// GitLens' own converter leaves the body off the row.
				assert.equal(row.body, undefined);
				assert.equal(presence.description, 'not-requested');
				assertReviewersAsAssignees(row, presence, 'point');
				// Azure's access isn't read, so it is unset.
				assert.equal(row.repository.accessLevel, undefined);
				assert.equal(presence.access, 'not-requested');
			}

			manager.dispose();
		});

		test('the host\'s own searches: its "my pull requests" search and the free-text search', async () => {
			const { manager, azure, providerId } = await connect();

			const mine = await azure.searchMyPullRequests();
			const searched = await azure.searchPullRequests('crash');

			assert.equal(mine?.error, undefined);
			assert.equal(mine?.value?.length, pullRequestIds.length);
			for (const pr of mine?.value ?? []) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'search'), 'search');
			}
			assert.equal(searched?.length, pullRequestIds.length);
			for (const pr of searched ?? []) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'text-search'), 'text-search');
			}

			manager.dispose();
		});

		test('the account-wide list and sweeps', async () => {
			const { manager, providerId, target } = await connect();

			const listed = await manager.listPullRequestsPage({ ...target, providerId: providerId });
			const swept = await manager.sweepPullRequests({ ...target, providerIds: [providerId] });
			const sweptWithReviews = await manager.sweepPullRequests({
				...target,
				providerIds: [providerId],
				includeReviews: true,
			});

			assert.equal(listed.items.length, pullRequestIds.length);
			for (const pr of [...listed.items, ...swept.items]) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'account-summary'), 'account-summary');
			}
			// Azure has no projection switch: asking for the reviews changes nothing but the tag.
			assert.equal(sweptWithReviews.items.length, pullRequestIds.length);
			for (const pr of sweptWithReviews.items) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'account'), 'account');
			}

			manager.dispose();
		});

		test('the repository-scoped list, full and summary', async () => {
			const { manager, providerId, target } = await connect();

			const listed = await manager.listPullRequestsPage({ ...target, providerId: providerId, repos: repos });
			const summary = await manager.listPullRequestsPage({
				...target,
				providerId: providerId,
				repos: repos,
				summary: true,
			});

			assert.equal(listed.items.length, pullRequestIds.length);
			for (const pr of listed.items) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'repos'), 'repos');
			}
			assert.equal(summary.items.length, pullRequestIds.length);
			for (const pr of summary.items) {
				assertListedPullRequest(pr, assertPullRequestRow(providerId, pr, 'repos-summary'), 'repos-summary');
			}

			manager.dispose();
		});

		test('the batch and branch reads read each pull request whole', async () => {
			const { manager, providerId, target } = await connect();

			const batch = await manager.getPullRequestsBatch({
				...target,
				providerId: providerId,
				targets: [{ key: 'pr', owner: org, repo: repoName, number: 1, project: projectName }],
			});
			const branches = await manager.getPullRequestsForBranches({
				...target,
				providerId: providerId,
				targets: [{ key: 'branch', owner: org, repo: repoName, project: projectName, branch: 'feature-1' }],
			});

			assert.equal(branches.items[0]?.pullRequests.length, 1);
			for (const pr of [batch.items[0]?.pullRequest, branches.items[0]?.pullRequests[0]]) {
				const presence = assertPullRequestRow(providerId, pr, 'batch');
				// Read by id, so the whole description is there, unlike a listed row's.
				assert.equal((pr as PullRequest).body, fullDescription);
				assert.equal(presence.description, 'fetched');
				assert.equal((pr as PullRequest).mergeableState, PullRequestMergeableState.Mergeable);
				assertReviewersAsAssignees(pr as PullRequest, presence, 'batch');
			}

			manager.dispose();
		});

		test('issue reads: point, account-wide, repository-scoped and batch', async () => {
			const { manager, azure, providerId, target } = await connect();

			const point = await azure.getIssue(projectResource, String(workItemId));
			const account = await manager.listIssuesPage({ ...target, providerId: providerId });
			const scoped = await manager.listIssuesPage({ ...target, providerId: providerId, repos: repos });
			const batch = await manager.getIssuesBatch({
				...target,
				providerId: providerId,
				targets: [{ key: 'issue', owner: org, repo: '', number: workItemId, project: projectName }],
			});

			// GitLens' own converter drops the tags, and no work item has reactions.
			const pointPresence = assertIssueRow(providerId, point, 'point');
			assert.equal(point?.labels, undefined);
			assert.equal(pointPresence.labels, 'not-requested');
			assert.equal(point?.thumbsUpCount, undefined);
			assert.equal(pointPresence.reactions, 'unavailable');
			assert.equal(pointPresence.access, 'unavailable');

			assert.equal(account.items.length, 1);
			assertIssueRow(providerId, account.items[0], 'account');
			assert.equal(scoped.items.length, 1);
			assertIssueRow(providerId, scoped.items[0], 'repos');

			const batched = batch.items[0]?.issue;
			const batchPresence = assertIssueRow(providerId, batched, 'batch');
			// Work items have no reactions, so GitLens' own converter leaves the count unset.
			assert.equal(batched?.thumbsUpCount, undefined);
			assert.equal(batchPresence.reactions, 'unavailable');
			assert.equal(batched?.repository?.accessLevel, undefined);
			assert.equal(batchPresence.access, 'unavailable');

			manager.dispose();
		});
	});
}

suite('Field presence: the Azure DevOps Server filtered searches', () => {
	const { AzureDevOpsServer: providerId } = GitSelfManagedHostIntegrationId;

	test('a page converts with the projection its own read asked for, though a pagination shares one drain', async () => {
		const { manager, target } = await connectedServer();
		const scope = {
			...target,
			providerId: providerId,
			repos: repos,
			criteria: { states: ['all' as const] },
			itemsPerPage: 1,
		};

		// The first page asks for the full row and its continuation for the summary one, then the other way round.
		const full = await manager.searchPullRequestsPage(scope);
		assert.ok(full.cursor != null, 'a second page follows');
		const fullThenSummary = await manager.searchPullRequestsPage({ ...scope, cursor: full.cursor, summary: true });
		const summary = await manager.searchPullRequestsPage({ ...scope, summary: true });
		assert.ok(summary.cursor != null, 'a second page follows');
		const summaryThenFull = await manager.searchPullRequestsPage({ ...scope, cursor: summary.cursor });

		for (const [page, projection] of [
			[full, 'search'],
			[fullThenSummary, 'search-summary'],
			[summary, 'search-summary'],
			[summaryThenFull, 'search'],
		] as const) {
			assert.equal(page.items.length, 1);
			assertListedPullRequest(
				page.items[0],
				assertPullRequestRow(providerId, page.items[0], projection),
				projection,
			);
		}

		manager.dispose();
	});

	test('the work item search', async () => {
		const { manager, target } = await connectedServer();

		const searched = await manager.searchIssuesPage({ ...target, providerId: providerId, org: org });

		assert.equal(searched.items.length, 1);
		const presence = assertIssueRow(providerId, searched.items[0], 'search');
		// GitLens' own converter drops the tags.
		assert.equal(searched.items[0].labels, undefined);
		assert.equal(presence.labels, 'not-requested');

		manager.dispose();
	});
});

suite('Field presence: every Azure DevOps projection in the tables was exercised above', () => {
	for (const providerId of providerIds) {
		test(providerId, () => {
			const pullRequests = allPullRequestProjections.filter(
				projection =>
					getPullRequestFieldPresence({
						provider: { id: providerId },
						projection: projection,
					} as unknown as PullRequestShape) != null,
			);
			const issues = allIssueProjections.filter(
				projection =>
					getIssueFieldPresence({
						provider: { id: providerId },
						projection: projection,
					} as unknown as IssueShape) != null,
			);

			assert.deepEqual([...exercisedPullRequestProjections.get(providerId)!].sort(), [...pullRequests].sort());
			assert.deepEqual([...exercisedIssueProjections.get(providerId)!].sort(), [...issues].sort());
		});
	}
});

/** Every read that returns a work item: the point read, the account-wide and repository-scoped lists, the batch read
 * and, where the host has one (`searches`), the filtered search. Each must return the one row. */
async function readAllWorkItems(
	{ manager, azure, providerId, target }: Connected,
	searches: boolean,
): Promise<[string, IssueShape][]> {
	const point = await azure.getIssue(projectResource, String(workItemId));
	const account = await manager.listIssuesPage({ ...target, providerId: providerId });
	const scoped = await manager.listIssuesPage({ ...target, providerId: providerId, repos: repos });
	const batch = await manager.getIssuesBatch({
		...target,
		providerId: providerId,
		targets: [{ key: 'issue', owner: org, repo: '', number: workItemId, project: projectName }],
	});
	const searched = searches
		? await manager.searchIssuesPage({ ...target, providerId: providerId, org: org })
		: undefined;

	const rows: [string, IssueShape | undefined][] = [
		['point', point],
		['account', account.items[0]],
		['repos', scoped.items[0]],
		['batch', batch.items[0]?.issue],
		...(searched != null ? [['search', searched.items[0]] as [string, IssueShape | undefined]] : []),
	];
	for (const [read, row] of rows) {
		assert.ok(row != null, `${providerId} ${read}: a row`);
	}

	return rows as [string, IssueShape][];
}

/**
 * A work item's description is its first rich text field with content, whichever read produced the row: provider-apis'
 * list rows, and GitLens' own point, batch and search reads, apply the same rule.
 */
for (const [label, connect, searches] of [
	['Azure DevOps Services', connectedServices, false],
	['Azure DevOps Server', connectedServer, true],
] as const) {
	suite(`Work item description: every ${label} read`, () => {
		const catalog = {
			count: 4,
			value: [
				{ referenceName: 'System.Description', name: 'Description', type: 'html' },
				{ referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps', type: 'html' },
				{ referenceName: 'Custom.Details', name: 'Details', type: 'html' },
				{ referenceName: 'Custom.Notes', name: 'Notes', type: 'string' },
			],
		};

		test('keeps Description, even when another rich text field has content', async () => {
			const routes: string[] = [];
			const connected = await connect({
				workItemFields: { 'Microsoft.VSTS.TCM.ReproSteps': '<div>Steps</div>' },
				routes: routes,
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.body, '<div>Work item body</div>', read);
				assert.deepEqual(row.bodyField, { id: 'System.Description', name: 'Description' }, read);
			}
			assert.ok(!routes.includes('_apis/wit/fields'), 'the field catalog is not read');

			connected.manager.dispose();
		});

		test('reads a work item described only by Repro Steps, without the field catalog', async () => {
			const routes: string[] = [];
			const connected = await connect({
				workItemFields: {
					'System.Description': undefined,
					'Microsoft.VSTS.TCM.ReproSteps': '<div>Preconditions: signed in</div>',
				},
				routes: routes,
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.body, '<div>Preconditions: signed in</div>', read);
				assert.deepEqual(row.bodyField, { id: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps' }, read);
			}
			assert.ok(!routes.includes('_apis/wit/fields'), 'the field catalog is not read');

			connected.manager.dispose();
		});

		test('reads a custom html field from the field catalog, and reuses the catalog', async () => {
			const routes: string[] = [];
			const connected = await connect({
				workItemFields: {
					'System.Description': '<div></div>',
					'Custom.Notes': 'plain text, not rich text',
					'Custom.Details': '<p>Custom details</p>',
				},
				fieldCatalog: () => json(catalog),
				routes: routes,
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.body, '<p>Custom details</p>', read);
				assert.deepEqual(row.bodyField, { id: 'Custom.Details', name: 'Details' }, read);
			}
			const catalogReads = routes.filter(route => route === '_apis/wit/fields').length;
			assert.ok(catalogReads > 0, 'the field catalog is read');

			await readAllWorkItems(connected, searches);
			assert.equal(
				routes.filter(route => route === '_apis/wit/fields').length,
				catalogReads,
				'no read asks for the catalog again',
			);

			connected.manager.dispose();
		});

		for (const [failure, response] of [
			['refused', () => json({ message: 'denied' }, 403)],
			['failing', () => json({ message: 'down' }, 500)],
			['unavailable', () => json({ message: 'down' }, 503)],
			['malformed', () => json({ unexpected: true })],
		] as const) {
			test(`falls back to the built-in description fields when the field catalog read is ${failure}`, async () => {
				const connected = await connect({
					workItemFields: {
						'System.Description': undefined,
						'Custom.Details': '<p>Custom details</p>',
					},
					fieldCatalog: response,
				});

				for (const [read, row] of await readAllWorkItems(connected, searches)) {
					assert.equal(row.body, undefined, read);
					assert.equal(row.bodyField, undefined, read);
				}

				connected.manager.dispose();
			});
		}
	});
}

/**
 * A work item's people carry the id its organization (Azure DevOps Server: collection) knows the account by, which can
 * differ from the profile id (gitkraken/kepler#4291), so every read stamps the row with that identity as its `viewer`,
 * as pull requests already are (#6032).
 */
for (const [label, connect, searches] of [
	['Azure DevOps Services', connectedServices, false],
	['Azure DevOps Server', connectedServer, true],
] as const) {
	suite(`Work item viewer: every ${label} read`, () => {
		test("stamps the organization's identity, not the profile id, read once for every read", async () => {
			const routes: string[] = [];
			const connected = await connect({
				orgUserId: 'org-me',
				workItemFields: { 'System.AssignedTo': identity('org-me') },
				routes: routes,
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.deepEqual(row.viewer, { id: 'org-me' }, read);
				assert.equal(row.viewerUnresolved, undefined, read);
				assert.ok(
					row.assignees.some(a => a.id === row.viewer?.id),
					`${read}: the assignee is matched by the viewer`,
				);
			}
			assert.equal(
				routes.filter(r => r === '_apis/connectiondata').length,
				1,
				"the organization's identity is cached, not read again per read or per row",
			);

			connected.manager.dispose();
		});

		test('leaves a work item that names no one without a viewer', async () => {
			const routes: string[] = [];
			const connected = await connect({
				orgUserId: 'org-me',
				workItemFields: { 'System.CreatedBy': undefined, 'System.AssignedTo': undefined },
				routes: routes,
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.viewer, undefined, read);
				assert.equal(row.viewerUnresolved, undefined, `${read}: nothing on it needed an identity`);
			}
			assert.equal(
				routes.filter(r => r === '_apis/connectiondata').length,
				1,
				'only the batch read asks, alongside the work item and before it can tell whether anyone is named',
			);

			connected.manager.dispose();
		});

		test("marks a work item that names someone viewerUnresolved when the organization's identity can't be read (#6083)", async () => {
			const connected = await connect({ failIdentity: true });

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.viewer, undefined, read);
				assert.equal(row.viewerUnresolved, true, read);
			}

			connected.manager.dispose();
		});

		test('leaves a work item that names no one unmarked, even when the identity read fails', async () => {
			const connected = await connect({
				failIdentity: true,
				workItemFields: { 'System.CreatedBy': undefined, 'System.AssignedTo': undefined },
			});

			for (const [read, row] of await readAllWorkItems(connected, searches)) {
				assert.equal(row.viewer, undefined, read);
				assert.equal(row.viewerUnresolved, undefined, read);
			}

			connected.manager.dispose();
		});
	});
}

suite('Work item viewer: Azure DevOps Services edge cases', () => {
	test('a repository-scoped read stamps the identity of the connection that read the rows, even if it switched since', async () => {
		let azure: GitHostIntegration | undefined;
		let switched = false;
		const connected = await connectedServices({
			// Each credential's own identity in the organization.
			orgUserId: token => (token === 'token-b' ? 'org-b' : 'org-a'),
			workItemFields: { 'System.AssignedTo': identity('org-a') },
			onRoute: route => {
				// The connection switches while the rows are being read.
				if (!switched && azure != null && route.startsWith('{project}/_apis/wit/')) {
					switched = true;
					const holder = azure as unknown as { _session: ProviderAuthenticationSession };
					holder._session = { ...holder._session, accessToken: 'token-b' };
				}
			},
		});
		azure = connected.azure;
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('token-a'),
			domain: 'dev.azure.com',
		};

		const scoped = await connected.manager.listIssuesPage({
			...connected.target,
			providerId: connected.providerId,
			repos: repos,
		});

		assert.ok(switched, 'the connection switched mid-read');
		assert.equal(scoped.items.length, 1);
		assert.deepEqual(scoped.items[0].viewer, { id: 'org-a' }, 'never the identity of the connection switched to');

		connected.manager.dispose();
	});

	test('a hung identity read leaves the rows without a viewer rather than holding them up', async () => {
		const connected = await connectedServices({
			hangIdentity: true,
			workItemFields: { 'System.AssignedTo': identity('org-me') },
		});
		const azure = connected.azure as unknown as { organizationViewerTimeoutMs: number };
		azure.organizationViewerTimeoutMs = 20;

		for (const [read, row] of await readAllWorkItems(connected, false)) {
			assert.equal(row.viewer, undefined, read);
			assert.equal(row.viewerUnresolved, true, read);
		}

		// While that request is still pending, a later read doesn't wait on it again: with a deadline past the test's
		// own timeout, waiting would fail the test.
		azure.organizationViewerTimeoutMs = 10 * 60 * 1000;
		for (const [read, row] of await readAllWorkItems(connected, false)) {
			assert.equal(row.viewer, undefined, `${read}, again`);
			assert.equal(row.viewerUnresolved, true, `${read}, again`);
		}

		connected.manager.dispose();
	});

	test('a lookup a re-sync left behind, timing out after its replacement answered, never hides that answer', async () => {
		const connected = await connectedServices();
		const azure = connected.azure as unknown as {
			organizationViewerTimeoutMs: number;
			requestOrganizationUserId: () => Promise<string | undefined>;
			getOrganizationViewers: (
				session: ProviderAuthenticationSession,
			) => (organization: string) => Promise<{ id: string } | null>;
			invalidateDiscoveryCaches: () => void;
		};
		azure.organizationViewerTimeoutMs = 20;
		let requests = 0;
		azure.requestOrganizationUserId = () =>
			++requests === 1 ? new Promise<undefined>(() => {}) : Promise.resolve('org-me');
		const session = primarySession('token-a');

		const obsolete = azure.getOrganizationViewers(session)(org);
		azure.invalidateDiscoveryCaches();
		assert.deepEqual(await azure.getOrganizationViewers(session)(org), { id: 'org-me' }, 'the replacement');

		assert.equal(await obsolete, null, 'the obsolete lookup timed out');
		assert.deepEqual(
			await azure.getOrganizationViewers(session)(org),
			{ id: 'org-me' },
			'a later read still gets the replacement',
		);

		connected.manager.dispose();
	});
});

/**
 * Every pull request read a host maps "mine" from (the lists, sweeps, batch, branch and filtered search reads), each
 * row of which names its author and reviewers.
 */
async function readAllPullRequests(
	{ manager, providerId, target }: Connected,
	searches: boolean,
): Promise<[string, PullRequestShape][]> {
	const scoped = await manager.listPullRequestsPage({ ...target, providerId: providerId, repos: repos });
	const swept = await manager.sweepPullRequests({ ...target, providerIds: [providerId], repos: repos });
	const batch = await manager.getPullRequestsBatch({
		...target,
		providerId: providerId,
		targets: [{ key: 'pr', owner: org, repo: repoName, number: 1, project: projectName }],
	});
	const branches = await manager.getPullRequestsForBranches({
		...target,
		providerId: providerId,
		targets: [{ key: 'branch', owner: org, repo: repoName, project: projectName, branch: 'feature-1' }],
	});
	const searched = searches
		? await manager.searchPullRequestsPage({
				...target,
				providerId: providerId,
				repos: repos,
				criteria: { states: ['all'] },
			})
		: undefined;

	const rows: [string, PullRequestShape | undefined][] = [
		['repos', scoped.items[0]],
		['sweep', swept.items[0]],
		['batch', batch.items[0]?.pullRequest],
		['branch', branches.items[0]?.pullRequests[0]],
		...(searched != null ? [['search', searched.items[0]] as [string, PullRequestShape | undefined]] : []),
	];
	for (const [read, row] of rows) {
		assert.ok(row != null, `${providerId} ${read}: a row`);
	}

	return rows as [string, PullRequestShape][];
}

/**
 * A row whose organization's identity couldn't be read says so (#6083), rather than looking like one from a provider
 * with no per-row identity, which a host matches against the account: on Azure DevOps that account's id is exactly the
 * one that may not match, so a host would report a definite "not mine".
 */
for (const [label, connect, searches] of [
	['Azure DevOps Services', connectedServices, false],
	['Azure DevOps Server', connectedServer, true],
] as const) {
	suite(`Pull request viewer: every ${label} read`, () => {
		test("stamps the organization's identity and no marker when it can be read", async () => {
			const connected = await connect({ orgUserId: 'author' });

			for (const [read, row] of await readAllPullRequests(connected, searches)) {
				assert.deepEqual(row.viewer, { id: 'author' }, read);
				assert.equal(row.authoredByMe, true, read);
				assert.equal(row.viewerUnresolved, undefined, read);
			}

			connected.manager.dispose();
		});

		test("marks the rows viewerUnresolved, with no viewer or authorship, when it can't be read", async () => {
			const connected = await connect({ failIdentity: true });

			for (const [read, row] of await readAllPullRequests(connected, searches)) {
				assert.equal(row.viewer, undefined, read);
				assert.equal(row.authoredByMe, undefined, `${read}: unknown, not "not mine"`);
				assert.equal(row.viewerUnresolved, true, read);
			}

			connected.manager.dispose();
		});

		test('marks the rows viewerUnresolved when the identity read outlives its bound', async () => {
			const connected = await connect({ hangIdentity: true });
			(connected.azure as unknown as { organizationViewerTimeoutMs: number }).organizationViewerTimeoutMs = 20;

			for (const [read, row] of await readAllPullRequests(connected, false)) {
				assert.equal(row.viewer, undefined, read);
				assert.equal(row.authoredByMe, undefined, read);
				assert.equal(row.viewerUnresolved, true, read);
			}

			connected.manager.dispose();
		});
	});
}

suite('Pull request viewer: the Azure DevOps Server filtered search', () => {
	test("a continuation page resolves the collection's identity again rather than keeping its first page's answer", async () => {
		let failIdentity = true;
		const routes: string[] = [];
		const connected = await connectedServer({
			orgUserId: 'author',
			failIdentity: () => failIdentity,
			routes: routes,
		});
		const scope = {
			...connected.target,
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			repos: repos,
			criteria: { states: ['all' as const] },
			itemsPerPage: 1,
		};

		const first = await connected.manager.searchPullRequestsPage(scope);
		assert.equal(first.items[0]?.viewerUnresolved, true);
		assert.equal(first.items[0]?.viewer, undefined);
		assert.ok(first.cursor != null, 'a second page follows');

		failIdentity = false;
		const second = await connected.manager.searchPullRequestsPage({ ...scope, cursor: first.cursor });
		assert.deepEqual(second.items[0]?.viewer, { id: 'author' });
		assert.equal(second.items[0]?.authoredByMe, true);
		assert.equal(second.items[0]?.viewerUnresolved, undefined);

		connected.manager.dispose();
	});

	test("a count, which maps no row, doesn't read the identity", async () => {
		const routes: string[] = [];
		const connected = await connectedServer({ routes: routes });

		const count = await connected.manager.countPullRequests({
			...connected.target,
			providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
			scopes: [{ key: 'all', repos: repos, criteria: { states: ['all'] } }],
		});
		assert.equal(count.fetchFailed, undefined, JSON.stringify(count.warnings));
		assert.equal(routes.filter(r => r === '_apis/connectiondata').length, 0);

		connected.manager.dispose();
	});
});

suite('Pull request viewer: the etag of a row whose identity was unresolved', () => {
	test('never compares unchanged, so the row is read in full again rather than kept unresolved', async () => {
		let failIdentity = true;
		const connected = await connectedServices({ orgUserId: 'author', failIdentity: () => failIdentity });
		const { manager, providerId, target } = connected;
		const targets = [{ key: 'pr', owner: org, repo: repoName, number: 1, project: projectName }];

		const unresolved = await manager.getPullRequestsBatch({ ...target, providerId: providerId, targets: targets });
		const unresolvedRow = unresolved.items[0];
		assert.equal(unresolvedRow?.pullRequest?.viewerUnresolved, true);
		assert.ok(unresolvedRow?.etag != null);

		failIdentity = false;
		const again = await manager.getPullRequestsBatch({
			...target,
			providerId: providerId,
			targets: targets.map(t => ({ ...t, etag: unresolvedRow.etag })),
		});
		const resolvedRow = again.items[0];
		assert.notEqual(resolvedRow?.unchanged, true, 'not kept as it was');
		assert.deepEqual(resolvedRow?.pullRequest?.viewer, { id: 'author' });
		assert.equal(resolvedRow?.pullRequest?.viewerUnresolved, undefined);
		assert.ok(resolvedRow?.etag != null);

		const resolvedAgain = await manager.getPullRequestsBatch({
			...target,
			providerId: providerId,
			targets: targets.map(t => ({ ...t, etag: resolvedRow.etag })),
		});
		assert.equal(resolvedAgain.items[0]?.unchanged, true, 'a resolved row still compares unchanged');

		manager.dispose();
	});
});
