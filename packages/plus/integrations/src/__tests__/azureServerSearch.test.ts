import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { toCloudIntegrationType } from '../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import type { IntegrationManager } from '../index.js';
import { createIntegrationManager } from '../index.js';
import { createIntegrationService } from '../integrationService.js';
import type { PullRequestSearchCriteria } from '../providerFilters.js';
import { PullRequestFilter } from '../providerFilters.js';
import { createFakeRuntime } from './fakeRuntime.js';

const id = GitSelfManagedHostIntegrationId.AzureDevOpsServer;

interface FakeWorkItem {
	id: number;
	project: string;
	title: string;
	createdBy?: string;
	assignedTo?: string;
}

interface FakePullRequest {
	id: number;
	project: string;
	repository: string;
	title: string;
	created: string;
	closed?: string;
	status?: 'active' | 'completed' | 'abandoned';
	creator?: string;
	reviewers?: string[];
	isDraft?: boolean;
}

interface FakeCollection {
	name: string;
	projects: string[];
	workItems: FakeWorkItem[];
	pullRequests: FakePullRequest[];
	/** The category its process maps every work item state to; `InProgress` when omitted. */
	stateCategory?: string;
}

interface Request {
	url: URL;
	method: string;
	token: string;
	body: string | undefined;
}

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status: status, headers: { 'content-type': 'application/json' } });
}

function user(name: string) {
	return { id: name, displayName: name, uniqueName: `${name}@example.com`, imageUrl: '', url: '' };
}

/**
 * An Azure DevOps Server installation below `installation`, answering the REST routes the search reads. Collections
 * are matched case-sensitively on purpose, so a request that re-spelled a name would fail visibly.
 */
function createServer(options: {
	/** The server root: requests below any other path are refused. */
	installation: string;
	/** The address the connection is configured with, when it differs from the root (e.g. it names a collection). */
	connectionUrl?: string;
	collections: FakeCollection[];
	accounts?: { tokenId: string; token: string; baseUrl: string; secondary?: boolean }[];
	failWiqlFor?: RegExp;
	failProjectFor?: string;
	/** Refuses the first work item page read, as a transient outage would. */
	failFirstWiql?: boolean;
	/** Pads every collection-wide WIQL answer to this many matches, to exercise the result ceiling. */
	wiqlMatches?: number;
	/** Refuses a WIQL match set past 20,000 even when `$top` bounds it, as a stricter server might. */
	wiqlLimitIgnoresTop?: boolean;
	/** Reports a collection's relative directory below the installation's own virtual directory (e.g. `tfs/`). */
	relativeDirectoryPrefix?: string;
}) {
	const runtime = createFakeRuntime();
	const requests: Request[] = [];
	let failedWiql = false;
	const accounts = options.accounts ?? [
		{ tokenId: 'connection', token: 'me-token', baseUrl: options.connectionUrl ?? options.installation },
	];
	const [primary, ...secondaries] = accounts;
	const descriptor = (a: (typeof accounts)[number]) => ({
		tokenId: a.tokenId,
		provider: toCloudIntegrationType[id],
		type: 'pat',
		domain: a.baseUrl,
	});
	runtime.account.getAccount = async () => ({ id: 'me' });
	runtime.account.fetchGkApi = async path => {
		if (path === 'v1/provider-tokens') {
			return json({ data: [{ ...descriptor(primary), secondaries: secondaries.map(descriptor) }] });
		}

		const account = accounts.find(a => path.endsWith(`/${a.tokenId}`)) ?? primary;
		return json({
			data: { ...descriptor(account), accessToken: account.token, expiresIn: 3600, scopes: '' },
		});
	};

	runtime.http.fetch = async (input, init) => {
		const url = new URL(input);
		const authorization = new Headers(init?.headers).get('authorization') ?? '';
		const basic = authorization.toLowerCase().startsWith('basic ');
		const token = basic
			? Buffer.from(authorization.slice(6), 'base64')
					.toString()
					.replace(/^[^:]*:/, '')
			: authorization;
		const body = typeof init?.body === 'string' ? init.body : undefined;
		requests.push({ url: url, method: init?.method ?? 'GET', token: token, body: body });
		// As measured against Azure DevOps Server 2020: a PAT is only accepted as a Basic credential.
		if (!basic) return json({ message: 'TF400813: not authorized' }, 401);

		const me = token.replace(/-token$/, '');

		const installationPath = new URL(options.installation).pathname.replace(/\/$/, '');
		if (!url.pathname.startsWith(`${installationPath}/`)) return json({ message: 'wrong installation' }, 404);

		const segments = url.pathname
			.slice(installationPath.length + 1)
			.split('/')
			.map(decodeURIComponent);
		// Server-level routes, which Azure also answers below a collection. Like Azure DevOps Server, the same person
		// has one identity id at the server level and another in each collection, and only the collection's matches
		// the creator/reviewer filters — the id stored on pull requests and work items there.
		const serverRoute = (segments[0] === '_apis' ? segments : segments.slice(1)).join('/');
		if (serverRoute.toLowerCase() === '_apis/connectiondata') {
			const atServer = segments[0] === '_apis';
			const id = atServer ? `server-${me}` : me;
			return json({
				authenticatedUser: { id: id, providerDisplayName: me, properties: { Account: { $value: me } } },
				authorizedUser: { id: id, providerDisplayName: me, properties: { Account: { $value: me } } },
				// Below a collection the data describes it: its id, and its path segment as the relative directory.
				instanceId: atServer ? 'server-id' : `${segments[0]}-id`,
				webApplicationRelativeDirectory: atServer
					? null
					: `${options.relativeDirectoryPrefix ?? ''}${encodeURIComponent(segments[0])}/`,
			});
		}
		// Only the server level lists the collections: Azure DevOps Server answers the route below a collection with
		// a 404 page, as measured against Azure DevOps Server 2020.
		if (serverRoute === '_apis/projectCollections') {
			if (segments[0] !== '_apis') return json({ message: 'Page not found.' }, 404);

			return json({ value: options.collections.map(c => ({ id: `${c.name}-id`, name: c.name, url: '' })) });
		}

		const collection = options.collections.find(c => c.name === segments[0]);
		if (collection == null) return json({ message: 'unknown collection' }, 404);

		const route = segments.slice(1).join('/');
		if (route === '_apis/projects') {
			if (options.failProjectFor === collection.name) return json({ message: 'boom' }, 500);

			return json({ value: collection.projects.map(p => ({ id: `${p}-id`, name: p })) });
		}
		if (route === '_apis/wit/wiql') {
			const query = (JSON.parse(body!) as { query: string }).query;
			if (options.failWiqlFor?.test(query)) return json({ message: 'TF51005: bad field' }, 400);
			if (options.failFirstWiql && !failedWiql) {
				failedWiql = true;
				return json({ message: 'boom' }, 500);
			}

			assert.equal(url.searchParams.get('timePrecision'), 'true', 'dates are sent as instants');

			const top = Number(url.searchParams.get('$top') ?? Infinity);
			if (options.wiqlMatches != null) {
				// Azure documents 20,000 as its query result limit; this fake refuses past it unless `$top` bounds
				// the answer (Azure DevOps Server 2020 honors `$top` there).
				if (options.wiqlMatches > 20000 && (options.wiqlLimitIgnoresTop || top > 20000 + 1)) {
					return json({ message: 'VS402337' }, 400);
				}

				const ids = Array.from({ length: Math.min(options.wiqlMatches, top) }, (_, i) => 100000 - i);
				return json({ workItems: ids.map(i => ({ id: i })) });
			}

			const matched = collection.workItems
				.filter(w => matchesWiql(w, query, me))
				.sort((a, b) => b.id - a.id)
				.slice(0, top);
			return json({ workItems: matched.map(w => ({ id: w.id })) });
		}
		if (route === '_apis/wit/workitemsbatch') {
			const ids = (JSON.parse(body!) as { ids: number[] }).ids;
			return json({
				value: ids.map(i => {
					const w = collection.workItems.find(x => x.id === i) ?? {
						id: i,
						project: collection.projects[0],
						title: `Padded ${i}`,
					};
					return {
						id: w.id,
						rev: 1,
						url: '',
						_links: {
							html: { href: `${options.installation}/${collection.name}/_workitems/edit/${w.id}` },
						},
						fields: {
							'System.TeamProject': w.project,
							'System.WorkItemType': 'Task',
							'System.State': 'Active',
							'System.Title': w.title,
							'System.CreatedDate': '2026-01-01T00:00:00Z',
							'System.ChangedDate': '2026-01-02T00:00:00Z',
							'System.CreatedBy': user(w.createdBy ?? 'someone'),
							...(w.assignedTo != null ? { 'System.AssignedTo': user(w.assignedTo) } : {}),
						},
					};
				}),
			});
		}
		if (/^[^/]+\/_apis\/wit\/workItemTypes\/[^/]+\/states$/.test(route)) {
			return json({
				value: [{ name: 'Active', color: '', category: collection.stateCategory ?? 'InProgress' }],
				count: 1,
			});
		}

		const repositories = /^([^/]+)\/_apis\/git\/repositories$/i.exec(route);
		if (repositories != null) {
			const [, project] = repositories;
			const names = [
				...new Set(collection.pullRequests.filter(p => p.project === project).map(p => p.repository)),
			];
			return json({
				value: names.map(name => ({
					id: `${project}-${name}-id`,
					name: name,
					project: { id: `${project}-id`, name: project },
					remoteUrl: `${options.installation}/${collection.name}/${project}/_git/${name}`,
					webUrl: `${options.installation}/${collection.name}/${project}/_git/${name}`,
				})),
			});
		}

		const pulls = /^([^/]+)\/_apis\/git\/(?:repositories\/([^/]+)\/)?pullRequests$/i.exec(route);
		if (pulls != null) {
			const [, project, repository] = pulls;
			const status = url.searchParams.get('searchCriteria.status') ?? 'active';
			const creator = url.searchParams.get('searchCriteria.creatorId');
			const reviewer = url.searchParams.get('searchCriteria.reviewerId');
			const top = Number(url.searchParams.get('$top') ?? 100);
			const skip = Number(url.searchParams.get('$skip') ?? 0);
			const matched = collection.pullRequests.filter(
				p =>
					p.project === project &&
					(repository == null || p.repository === repository) &&
					(status === 'all' || (p.status ?? 'active') === status) &&
					(creator == null || (p.creator ?? 'someone') === creator) &&
					(reviewer == null || (p.reviewers ?? []).includes(reviewer)),
			);
			return json({
				value: matched
					.slice(skip, skip + top)
					.map(p => toAzurePullRequest(options.installation, collection, p)),
			});
		}

		return json({ message: `unhandled ${route}` }, 404);
	};

	return { runtime: runtime, requests: requests, createManager: () => createIntegrationManager(runtime) };
}

/** Evaluates the handful of WIQL clauses the search emits against a fake work item. */
function matchesWiql(w: FakeWorkItem, query: string, me: string): boolean {
	const projects = /\[System\.TeamProject\] IN \(([^)]*)\)/.exec(query)?.[1];
	if (projects != null) {
		const names = Array.from(projects.matchAll(/'((?:[^']|'')*)'/g), m => m[1].replace(/''/g, "'"));
		if (!names.includes(w.project)) return false;
	}

	const relationships = /AND \((\[System\.(?:CreatedBy|AssignedTo)\][^)]*)\)/.exec(query)?.[1];
	if (relationships != null) {
		const matches = relationships.split(' OR ').some(clause => {
			if (clause === '[System.CreatedBy] = @Me') return w.createdBy === me;
			if (clause === '[System.AssignedTo] = @Me') return w.assignedTo === me;
			if (clause === "[System.AssignedTo] <> ''") return w.assignedTo != null;
			if (clause === "[System.AssignedTo] = ''") return w.assignedTo == null;
			throw new Error(`unexpected clause ${clause}`);
		});
		if (!matches) return false;
	}

	const text = /\[System\.Title\] Contains '((?:[^']|'')*)'/.exec(query)?.[1];
	return text == null || w.title.includes(text.replace(/''/g, "'"));
}

function toAzurePullRequest(installation: string, collection: FakeCollection, p: FakePullRequest) {
	const repositoryId = `${p.project}-${p.repository}-id`;
	return {
		pullRequestId: p.id,
		codeReviewId: p.id,
		status: p.status ?? 'active',
		title: p.title,
		description: '',
		isDraft: p.isDraft ?? false,
		creationDate: p.created,
		closedDate: p.closed,
		createdBy: user(p.creator ?? 'someone'),
		reviewers: (p.reviewers ?? []).map(r => ({ ...user(r), vote: 0 })),
		sourceRefName: 'refs/heads/feature',
		targetRefName: 'refs/heads/main',
		mergeStatus: 'succeeded',
		lastMergeSourceCommit: { commitId: 'a' },
		lastMergeTargetCommit: { commitId: 'b' },
		repository: {
			id: repositoryId,
			name: p.repository,
			project: { id: `${p.project}-id`, name: p.project },
		},
		url: `${installation}/${collection.name}/${p.project}-id/_apis/git/repositories/${repositoryId}/pullRequests/${p.id}`,
	};
}

/** A provider-shaped pull request, as the SDK hands it back, for tests that stub the SDK read itself. */
function fakeProviderPullRequest(n: number) {
	return {
		id: String(n),
		number: n,
		title: `PR ${n}`,
		description: null,
		url: `https://server.test/tfs/Default%20Collection/Web/_git/site/pullrequest/${n}`,
		state: 'OPEN',
		isDraft: false,
		isCrossRepository: false,
		createdDate: new Date('2026-01-01T00:00:00Z'),
		updatedDate: new Date('2026-01-01T00:00:00Z'),
		closedDate: null,
		mergedDate: null,
		author: null,
		assignees: [],
		reviews: [],
		repository: { id: 'Web-site-id', name: 'site', project: 'Web', owner: { login: 'Default Collection' } },
		headRepository: null,
		baseRef: null,
		headRef: null,
		commentCount: null,
		upvoteCount: null,
	};
}

async function withManager(
	server: ReturnType<typeof createServer>,
	fn: (
		manager: IntegrationManager,
		target: { providerId: typeof id; connectionId: string; domain: string | undefined },
	) => Promise<void>,
): Promise<void> {
	const manager = server.createManager();
	try {
		await manager.refreshConnections();
		const [connection] = manager.getConfigured(id);
		await fn(manager, { providerId: id, connectionId: connection.id, domain: connection.domain });
	} finally {
		manager.dispose();
	}
}

const collection: FakeCollection = {
	name: 'Default Collection',
	projects: ['Payments & Billing', 'Web'],
	workItems: [
		{ id: 1, project: 'Payments & Billing', title: 'Mine', createdBy: 'me', assignedTo: 'me' },
		{ id: 2, project: 'Payments & Billing', title: 'Assigned', assignedTo: 'me' },
		{ id: 3, project: 'Web', title: 'Authored', createdBy: 'me', assignedTo: 'someone' },
		{ id: 4, project: 'Web', title: 'Other' },
		{ id: 5, project: 'Web', title: 'Unassigned bug' },
	],
	pullRequests: [
		{ id: 1, project: 'Web', repository: 'site', title: 'Old', created: '2026-01-01T00:00:00Z', creator: 'me' },
		{
			id: 2,
			project: 'Web',
			repository: 'site',
			title: 'Draft fix',
			created: '2026-01-03T00:00:00Z',
			reviewers: ['me'],
			isDraft: true,
		},
		{
			id: 3,
			project: 'Web',
			repository: 'api',
			title: 'Both',
			created: '2026-01-02T00:00:00Z',
			creator: 'me',
			reviewers: ['me'],
		},
		{
			id: 1,
			project: 'Payments & Billing',
			repository: 'ledger',
			title: 'Same number',
			created: '2026-01-04T00:00:00Z',
			creator: 'me',
		},
		{
			id: 5,
			project: 'Web',
			repository: 'site',
			title: 'Merged',
			created: '2025-12-01T00:00:00Z',
			closed: '2026-01-05T00:00:00Z',
			status: 'completed',
			creator: 'me',
		},
	],
};

suite('Azure DevOps Server filtered search', () => {
	suite('addressing', () => {
		for (const [connectionUrl, relativeDirectoryPrefix] of [
			['https://server.test/tfs', undefined],
			['https://server.test/tfs/Default%20Collection', undefined],
			// A server that reports the collection below its own virtual directory.
			['https://server.test/tfs/Default%20Collection', 'tfs/'],
		] as const) {
			test(`discovers the collection and reads below it once, addressed at ${connectionUrl}${relativeDirectoryPrefix != null ? ` (directory '${relativeDirectoryPrefix}…')` : ''}`, async () => {
				const server = createServer({
					installation: 'https://server.test/tfs',
					connectionUrl: connectionUrl,
					collections: [collection],
					relativeDirectoryPrefix: relativeDirectoryPrefix,
				});
				await withManager(server, async (manager, target) => {
					const orgs = await manager.listOrgs({ ...target });
					assert.ok(!orgs.fetchFailed, JSON.stringify(orgs.warnings));
					assert.deepEqual(
						orgs.items.map(o => o.name),
						['Default Collection'],
					);

					const repos = await manager.listRepos({ ...target, org: 'Default Collection', project: 'Web' });
					assert.ok(!repos.fetchFailed, JSON.stringify(repos.warnings));
					assert.deepEqual(repos.items.map(r => r.name).sort(), ['api', 'site']);

					const allRepos = await manager.listRepos({ ...target, org: 'Default Collection' });
					assert.ok(!allRepos.fetchFailed, JSON.stringify(allRepos.warnings));
					assert.deepEqual(allRepos.items.map(r => r.name).sort(), ['api', 'ledger', 'site']);

					const search = await manager.searchIssuesPage({ ...target, org: 'Default Collection' });
					assert.ok(!search.fetchFailed, JSON.stringify(search.warnings));
					assert.equal(search.items.length, collection.workItems.length);

					// Issue reads go through the SDK's per-project routes, which this fake doesn't serve: only where
					// they are sent matters here.
					await manager.listIssuesPage({ ...target });

					const paths = server.requests.map(r => decodeURIComponent(r.url.pathname));
					assert.ok(
						paths.some(p => p === '/tfs/Default Collection/Web/_apis/wit/wiql'),
						paths.join('\n'),
					);
					assert.ok(
						!paths.some(p => p.includes('/Default Collection/Default Collection/')),
						paths.join('\n'),
					);
				});
			});
		}
	});

	suite('page size', () => {
		test('reads a page size that is not a finite number as the default, on both searches', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const issues = await manager.searchIssuesPage({
					...target,
					org: 'Default Collection',
					itemsPerPage: Number.NaN,
				});
				assert.ok(!issues.fetchFailed, JSON.stringify(issues.warnings));
				assert.equal(issues.items.length, collection.workItems.length);
				assert.equal(issues.hasMore, false);

				const pulls = await manager.searchPullRequestsPage({
					...target,
					org: 'Default Collection',
					criteria: { states: ['all'] },
					itemsPerPage: Number.NaN,
				});
				assert.ok(!pulls.fetchFailed, JSON.stringify(pulls.warnings));
				assert.equal(pulls.items.length, collection.pullRequests.length);
				assert.equal(pulls.hasMore, false);
			});
		});
	});

	suite('criteria', () => {
		test('refuses a malformed date before reading anything, and only for its own count scope', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const repos = [{ namespace: 'Default Collection', name: 'site', project: 'Web' }];
				const bad = { updatedAfter: '2026-01-05T00:00:00Z' };

				const issues = await manager.countIssues({
					...target,
					scopes: [
						{ key: 'good', org: 'Default Collection' },
						{ key: 'bad', org: 'Default Collection', criteria: bad },
					],
				});
				assert.deepEqual(
					issues.items.map(i => i.key),
					['good'],
				);
				assert.match(issues.warnings[0].message, /count scope 'bad'.*invalid updatedAfter/);

				const pulls = await manager.countPullRequests({
					...target,
					scopes: [
						{ key: 'good', repos: repos, criteria: { states: ['all'] } },
						{ key: 'bad', repos: repos, criteria: { states: ['all'], ...bad } },
					],
				});
				assert.deepEqual(
					pulls.items.map(i => [i.key, i.count]),
					[['good', 3]],
				);
				assert.match(pulls.warnings[0].message, /count scope 'bad'.*invalid updatedAfter/);

				const count = server.requests.length;
				const search = await manager.searchPullRequestsPage({
					...target,
					org: 'Default Collection',
					criteria: bad,
				});
				assert.equal(search.fetchFailed, true);
				assert.equal(server.requests.length, count, 'nothing is drained for a search it would refuse');
			});
		});
	});

	suite('capabilities', () => {
		test('declares only what the server search implements, and leaves Azure DevOps Services unchanged', () => {
			const manager = createIntegrationManager(createFakeRuntime());
			try {
				const server = manager.getSupportedFilters(id);
				assert.deepEqual(server.issueSearch, {
					relationships: ['authored', 'assigned', 'any-assignee', 'unassigned'],
					text: true,
					labels: true,
					milestone: false,
					updatedAfter: true,
					createdAfter: true,
					withoutLinkedPullRequest: false,
					states: true,
					sorts: [
						'updated:desc',
						'updated:asc',
						'created:desc',
						'created:asc',
						'closed:desc',
						'closed:asc',
						'comments:desc',
						'comments:asc',
						'title:desc',
						'title:asc',
					],
				});
				assert.deepEqual(server.pullRequestSearch, {
					relationships: [
						PullRequestFilter.Author,
						PullRequestFilter.Assignee,
						PullRequestFilter.ReviewRequested,
					],
					states: ['open', 'closed', 'merged', 'all'],
					text: true,
					updatedAfter: true,
					createdAfter: true,
					includeArchived: false,
					draft: true,
					repositoryScope: true,
					organizationScope: true,
					sorts: ['updated:desc', 'updated:asc', 'created:desc', 'created:asc'],
				});

				const services = manager.getSupportedFilters(GitCloudHostIntegrationId.AzureDevOps);
				assert.deepEqual(services.issueSearch.relationships, []);
				assert.deepEqual(services.pullRequestSearch.relationships, []);
			} finally {
				manager.dispose();
			}
		});
	});

	suite('work items', () => {
		for (const connectionUrl of ['https://server.test/tfs', 'https://server.test/tfs/Default%20Collection']) {
			test(`searches one collection below ${connectionUrl}, applying the collection exactly once`, async () => {
				const server = createServer({
					installation: 'https://server.test/tfs',
					connectionUrl: connectionUrl,
					collections: [collection],
				});
				await withManager(server, async (manager, target) => {
					const result = await manager.searchIssuesPage({
						...target,
						criteria: { relationships: ['authored', 'assigned'] },
					});
					assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
					assert.deepEqual(
						result.items.map(i => i.id),
						['3', '2', '1'],
						'one WIQL OR: the item matching both relationships is served once',
					);
					assert.deepEqual(
						result.items.map(i => i.project?.name),
						['Web', 'Payments & Billing', 'Payments & Billing'],
					);

					const wiql = server.requests.filter(r => r.url.pathname.endsWith('/_apis/wit/wiql'));
					assert.equal(wiql.length, 1);
					assert.equal(decodeURIComponent(wiql[0].url.pathname), '/tfs/Default Collection/_apis/wit/wiql');
					for (const request of server.requests) {
						assert.ok(!request.url.pathname.includes('Collection/Default'), request.url.href);
						assert.ok(request.url.pathname.startsWith('/tfs/'), request.url.href);
					}
				});
			});
		}

		test('bounds a repository scope by its project, with an encoded project name', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const result = await manager.searchIssuesPage({
					...target,
					repos: [{ namespace: 'Default Collection', name: 'ledger', project: 'Payments & Billing' }],
				});
				assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
				assert.deepEqual(
					result.items.map(i => i.id),
					['2', '1'],
				);
				const body = server.requests.find(r => r.url.pathname.endsWith('/wiql'))!.body!;
				assert.match(body, /\[System\.TeamProject\] IN \('Payments & Billing'\)/);
			});
		});

		test('pages past the first page with a cursor and the count agrees with the list', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const criteria = { relationships: ['unassigned' as const] };
				const counted = await manager.countIssues({
					...target,
					scopes: [{ key: 'unassigned', org: 'Default Collection', criteria: criteria }],
				});
				assert.equal(counted.fetchFailed, undefined, JSON.stringify(counted.warnings));
				assert.deepEqual(counted.items, [
					{ key: 'unassigned', count: 2, exceedsProviderLimit: false, providerLimit: 20000 },
				]);

				// `unassigned` describes the work item, not the caller, so it needs a scope of its own.
				const first = await manager.searchIssuesPage({
					...target,
					org: 'Default Collection',
					criteria: criteria,
					itemsPerPage: 1,
				});
				assert.deepEqual(
					first.items.map(i => i.id),
					['5'],
				);
				assert.equal(first.hasMore, true);
				const second = await manager.searchIssuesPage({
					...target,
					org: 'Default Collection',
					criteria: criteria,
					itemsPerPage: 1,
					cursor: first.cursor,
				});
				assert.deepEqual(
					second.items.map(i => i.id),
					['4'],
				);
				assert.equal(second.hasMore, false);
				assert.equal(first.items.length + second.items.length, counted.items[0].count);
			});
		});

		test('refuses a cursor produced under another query instead of restarting it', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const first = await manager.searchIssuesPage({
					...target,
					org: 'Default Collection',
					criteria: { relationships: ['unassigned'] },
					itemsPerPage: 1,
				});
				assert.ok(first.cursor != null);
				const resumed = await manager.searchIssuesPage({
					...target,
					org: 'Default Collection',
					criteria: { relationships: ['unassigned'], sort: 'created:desc' },
					cursor: first.cursor,
				});
				assert.equal(resumed.fetchFailed, true);
				assert.deepEqual(resumed.items, []);
			});
		});

		test('refuses a search that would have to span collections', async () => {
			const other = { ...collection, name: 'Other' };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection, other] });
			await withManager(server, async (manager, target) => {
				const count = server.requests.length;
				const unscoped = await manager.searchIssuesPage({
					...target,
					criteria: { relationships: ['assigned'] },
				});
				assert.equal(unscoped.fetchFailed, true);
				assert.match(unscoped.warnings[0].message, /pass `org`/);

				const mixed = await manager.searchIssuesPage({
					...target,
					repos: [
						{ namespace: 'Default Collection', name: 'a', project: 'Web' },
						{ namespace: 'Other', name: 'b', project: 'Web' },
					],
				});
				assert.equal(mixed.fetchFailed, true);
				assert.equal(
					server.requests.slice(count).filter(r => r.url.pathname.endsWith('/wiql')).length,
					0,
					'nothing is queried before the scope is settled',
				);

				const scoped = await manager.searchIssuesPage({
					...target,
					org: 'Other',
					criteria: { relationships: ['assigned'] },
				});
				assert.ok(!scoped.fetchFailed, JSON.stringify(scoped.warnings));
				assert.ok(
					server.requests.some(r => decodeURIComponent(r.url.pathname) === '/tfs/Other/_apis/wit/wiql'),
				);
			});
		});

		test('reports exactly the limit as a complete result and past it as a quantified ceiling', async () => {
			for (const [matches, expectation] of [
				[20000, { count: 20000, exceeds: false }],
				[20001, { count: undefined, exceeds: true }],
			] as const) {
				const server = createServer({
					installation: 'https://server.test/tfs',
					collections: [collection],
					wiqlMatches: matches,
				});
				await withManager(server, async (manager, target) => {
					const counted = await manager.countIssues({
						...target,
						scopes: [{ key: 'all', org: 'Default Collection' }],
					});
					assert.deepEqual(counted.items, [
						{
							key: 'all',
							count: expectation.count,
							exceedsProviderLimit: expectation.exceeds,
							providerLimit: 20000,
						},
					]);

					const page = await manager.searchIssuesPage({
						...target,
						org: 'Default Collection',
						itemsPerPage: 2,
					});
					assert.equal(page.hasMore, true, 'the reachable window still pages');
					assert.equal(page.page.truncated, expectation.exceeds || undefined, String(matches));
					const omission = page.warnings[0]?.omission;
					if (expectation.exceeds) {
						assert.deepEqual(omission, {
							kind: 'provider-limit',
							recovery: 'none',
							limit: 20000,
							sort: 'updated:desc',
						});
					} else {
						assert.equal(page.warnings.length, 0, JSON.stringify(page.warnings));
					}
				});
			}
		});

		test('refuses a continuation whose snapshot expired instead of resuming against a changed set', async () => {
			const items: FakeWorkItem[] = [5, 4, 3, 2, 1].map(i => ({ id: i, project: 'Web', title: `Item ${i}` }));
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [{ ...collection, workItems: items }],
			});
			await withManager(server, async (manager, target) => {
				const first = await manager.searchIssuesPage({ ...target, org: 'Default Collection', itemsPerPage: 2 });
				assert.deepEqual(
					first.items.map(i => i.id),
					['5', '4'],
				);

				// A fresh manager has none of the first page's snapshot, as after it expired.
				manager.dispose();
				const resumed = server.createManager();
				try {
					await resumed.refreshConnections();
					const count = server.requests.length;
					const second = await resumed.searchIssuesPage({
						...target,
						org: 'Default Collection',
						itemsPerPage: 2,
						cursor: first.cursor,
					});
					assert.equal(second.fetchFailed, true);
					assert.match(second.warnings[0].message, /expired; restart the read/);
					assert.ok(
						!server.requests.slice(count).some(r => r.url.pathname.endsWith('/wiql')),
						'no re-query is resumed against',
					);
				} finally {
					resumed.dispose();
				}
			});
		});

		test('pages a stable snapshot while the set changes under the pagination', async () => {
			const items: FakeWorkItem[] = [5, 4, 3, 2, 1].map(i => ({ id: i, project: 'Web', title: `Item ${i}` }));
			const mutable = { ...collection, workItems: items };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [mutable] });
			await withManager(server, async (manager, target) => {
				const scope = { ...target, org: 'Default Collection', itemsPerPage: 2 };
				const first = await manager.searchIssuesPage(scope);
				mutable.workItems = [{ id: 9, project: 'Web', title: 'Moved ahead' }, ...items.filter(i => i.id !== 4)];
				const second = await manager.searchIssuesPage({ ...scope, cursor: first.cursor });
				const third = await manager.searchIssuesPage({ ...scope, cursor: second.cursor });
				assert.deepEqual(
					[first, second, third].flatMap(r => r.items.map(i => i.id)),
					['5', '4', '3', '2', '1'],
					'every work item of the snapshot, once, whatever changed',
				);
			});
		});

		test('keeps a pagination on its own snapshot when the same query starts again', async () => {
			const items: FakeWorkItem[] = [5, 4, 3, 2, 1].map(i => ({ id: i, project: 'Web', title: `Item ${i}` }));
			const mutable = { ...collection, workItems: items };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [mutable] });
			await withManager(server, async (manager, target) => {
				const scope = { ...target, org: 'Default Collection', itemsPerPage: 2 };
				const first = await manager.searchIssuesPage(scope);
				// Another consumer starts the same query after the set changed, while the first is still paging.
				mutable.workItems = [9, 8, 7, 6, ...items.map(i => i.id)].map(i => ({
					id: i,
					project: 'Web',
					title: `Item ${i}`,
				}));
				const other = await manager.searchIssuesPage(scope);
				assert.deepEqual(
					other.items.map(i => i.id),
					['9', '8'],
				);

				const second = await manager.searchIssuesPage({ ...scope, cursor: first.cursor });
				const third = await manager.searchIssuesPage({ ...scope, cursor: second.cursor });
				assert.deepEqual(
					[first, second, third].flatMap(r => r.items.map(i => i.id)),
					['5', '4', '3', '2', '1'],
					'the earlier pagination reads the snapshot its first page queried',
				);
				const otherNext = await manager.searchIssuesPage({ ...scope, cursor: other.cursor });
				assert.deepEqual(
					otherNext.items.map(i => i.id),
					['7', '6'],
				);
			});
		});

		test('resolves a project created after discovery on the next first page', async () => {
			const growing = { ...collection, projects: [...collection.projects], workItems: [...collection.workItems] };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [growing] });
			await withManager(server, async (manager, target) => {
				const before = await manager.searchIssuesPage({ ...target, org: 'Default Collection' });
				assert.ok(!before.fetchFailed, JSON.stringify(before.warnings));

				growing.projects.push('New');
				growing.workItems.push({ id: 9, project: 'New', title: 'In a new project' });
				const after = await manager.searchIssuesPage({ ...target, org: 'Default Collection' });
				assert.ok(!after.fetchFailed, JSON.stringify(after.warnings));
				assert.equal(after.items[0].id, '9');
				assert.equal(after.items[0].project?.name, 'New');
			});
		});

		test('counts a project created after discovery, as the search it previews does', async () => {
			const growing = { ...collection, projects: [...collection.projects], workItems: [...collection.workItems] };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [growing] });
			await withManager(server, async (manager, target) => {
				const before = await manager.searchIssuesPage({ ...target, org: 'Default Collection' });
				assert.ok(!before.fetchFailed, JSON.stringify(before.warnings));

				growing.projects.push('New');
				growing.workItems.push({ id: 9, project: 'New', title: 'In a new project' });
				const repos = [{ namespace: 'Default Collection', name: 'new-repo', project: 'New' }];
				const counted = await manager.countIssues({ ...target, scopes: [{ key: 'new', repos: repos }] });
				assert.deepEqual(counted.items, [
					{ key: 'new', count: 1, exceedsProviderLimit: false, providerLimit: 20000 },
				]);

				const listed = await manager.searchIssuesPage({ ...target, repos: repos });
				assert.equal(listed.items.length, counted.items[0].count);
			});
		});

		test('retries a failed collection in broadenIssues from its page marker', async () => {
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [collection],
				failFirstWiql: true,
			});
			await withManager(server, async (manager, target) => {
				const other = { ...target, name: 'Default Collection', connectionId: target.connectionId };
				const first = await manager.broadenIssues({
					orgs: [other, { ...other, name: 'Missing' }],
				});
				assert.equal(first.fetchFailed, true);

				const retried = await manager.broadenIssues({
					orgs: [other, { ...other, name: 'Missing' }],
					cursor: first.cursor,
				});
				assert.deepEqual(
					retried.items.map(i => i.id),
					['5', '4', '3', '2', '1'],
					JSON.stringify(retried.warnings),
				);
			});
		});

		test('re-reads the projects when broadenIssues retries a first page from its page marker', async () => {
			const growing = { ...collection, projects: [...collection.projects], workItems: [...collection.workItems] };
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [growing],
				failFirstWiql: true,
			});
			await withManager(server, async (manager, target) => {
				const org = { ...target, name: 'Default Collection', connectionId: target.connectionId };
				const first = await manager.broadenIssues({ orgs: [org, { ...org, name: 'Missing' }] });
				assert.equal(first.fetchFailed, true);

				// A project created between the failed first page and its retry.
				growing.projects.push('New');
				growing.workItems.push({ id: 9, project: 'New', title: 'In a new project' });
				const retried = await manager.broadenIssues({
					orgs: [org, { ...org, name: 'Missing' }],
					cursor: first.cursor,
				});
				assert.deepEqual(
					retried.items.map(i => i.id),
					['9', '5', '4', '3', '2', '1'],
					JSON.stringify(retried.warnings),
				);
			});
		});

		test('counts a match set a server refuses past the limit as exceeding it', async () => {
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [collection],
				wiqlMatches: 25000,
				wiqlLimitIgnoresTop: true,
			});
			await withManager(server, async (manager, target) => {
				const counted = await manager.countIssues({
					...target,
					scopes: [{ key: 'all', org: 'Default Collection' }],
				});
				assert.deepEqual(counted.items, [
					{ key: 'all', count: undefined, exceedsProviderLimit: true, providerLimit: 20000 },
				]);

				const page = await manager.searchIssuesPage({ ...target, org: 'Default Collection' });
				assert.equal(page.fetchFailed, true);
				assert.match(page.warnings[0].message, /more than 20000 results/);
			});
		});

		test('keeps two accounts apart in the id snapshot their continuations page through', async () => {
			// The token's `microHash` keeps 3 hex digits, so two accounts' credentials can share it; a snapshot keyed on
			// it would hand one account's continuation the other's ids. `@Me` makes the two accounts' match sets
			// differ, so a swapped snapshot is visible in what page 2 serves.
			const installation = 'https://server.test/tfs';
			const assigned = (who: string, ids: number[]) =>
				ids.map(i => ({ id: i, project: 'Web', title: `Item ${i}`, assignedTo: who }));
			const server = createServer({
				installation: installation,
				collections: [
					{ ...collection, workItems: [...assigned('me', [10, 11, 12]), ...assigned('someone', [20, 21])] },
				],
				accounts: [
					{ tokenId: 'connection', token: 'me-token', baseUrl: installation },
					{ tokenId: 'secondary', token: 'someone-token', baseUrl: installation },
				],
			});
			await withManager(server, async (manager, target) => {
				const scope = {
					...target,
					org: 'Default Collection',
					criteria: { relationships: ['assigned' as const] },
					itemsPerPage: 1,
				};
				const mineFirst = await manager.searchIssuesPage(scope);
				const theirsFirst = await manager.searchIssuesPage({ ...scope, connectionId: 'secondary' });
				const mineNext = await manager.searchIssuesPage({ ...scope, cursor: mineFirst.cursor });
				const theirsNext = await manager.searchIssuesPage({
					...scope,
					connectionId: 'secondary',
					cursor: theirsFirst.cursor,
				});

				assert.deepEqual(
					[mineFirst, mineNext].flatMap(r => r.items.map(i => i.id)),
					['12', '11'],
				);
				assert.deepEqual(
					[theirsFirst, theirsNext].flatMap(r => r.items.map(i => i.id)),
					['21', '20'],
					'each account pages through its own matches',
				);
			});
		});

		/** One token connected to two installations below one host, each served by its own fake. */
		function createTwoInstallations(one: FakeCollection, two: FakeCollection) {
			const first = createServer({ installation: 'https://server.test/one', collections: [one] });
			const second = createServer({ installation: 'https://server.test/two', collections: [two] });
			const runtime = first.runtime;
			const secondFetch = second.runtime.http.fetch;
			const firstFetch = runtime.http.fetch;
			runtime.http.fetch = (input, init) =>
				new URL(input).pathname.startsWith('/two/') ? secondFetch(input, init) : firstFetch(input, init);
			const connection = (tokenId: string, domain: string) => ({
				tokenId: tokenId,
				provider: toCloudIntegrationType[id],
				type: 'pat',
				domain: domain,
			});
			runtime.account.fetchGkApi = async path =>
				json({
					data:
						path === 'v1/provider-tokens'
							? [
									{
										...connection('one', 'https://server.test/one'),
										secondaries: [connection('two', 'https://server.test/two')],
									},
								]
							: {
									...connection(
										path.endsWith('/two') ? 'two' : 'one',
										path.endsWith('/two') ? 'https://server.test/two' : 'https://server.test/one',
									),
									accessToken: 'me-token',
									expiresIn: 3600,
									scopes: '',
								},
				});
			return createIntegrationManager(runtime);
		}

		test('keeps one token connected to two installations on one host from sharing their discovery', async () => {
			// Two installations below one host, each with its own collection, and the same token on both.
			const alpha = { ...collection, name: 'Alpha' };
			const beta = {
				...collection,
				name: 'Beta',
				projects: ['Beta Project'],
				workItems: [{ id: 50, project: 'Beta Project', title: 'Beta item' }],
			};
			const manager = createTwoInstallations(alpha, beta);
			try {
				await manager.refreshConnections();
				const configured = manager.getConfigured(id);
				assert.equal(configured.length, 2);
				const target = (connectionId: string) => ({
					providerId: id,
					connectionId: connectionId,
					domain: configured[0].domain,
				});

				const one = await manager.searchIssuesPage({
					...target('one'),
					criteria: { relationships: ['assigned'] },
				});
				assert.ok(!one.fetchFailed, JSON.stringify(one.warnings));
				const two = await manager.searchIssuesPage({ ...target('two'), org: 'Beta' });
				assert.ok(!two.fetchFailed, JSON.stringify(two.warnings));
				assert.deepEqual(
					two.items.map(i => i.id),
					['50'],
				);
				assert.equal(two.items[0].project?.resourceName, 'Beta');
			} finally {
				manager.dispose();
			}
		});

		test("reads each installation's own state categories for a collection and project they share by name", async () => {
			// The same collection and project on two installations, whose processes close the same state differently.
			const open = { ...collection, workItems: [{ id: 60, project: 'Web', title: 'Open here' }] };
			const closed = { ...open, stateCategory: 'Completed' };
			const manager = createTwoInstallations(open, closed);
			try {
				await manager.refreshConnections();
				const configured = manager.getConfigured(id);
				const target = (connectionId: string) => ({
					providerId: id,
					connectionId: connectionId,
					domain: configured[0].domain,
					org: 'Default Collection',
					criteria: { state: 'all' as const },
				});
				const one = await manager.searchIssuesPage(target('one'));
				const two = await manager.searchIssuesPage(target('two'));
				assert.ok(!one.fetchFailed && !two.fetchFailed, JSON.stringify([one.warnings, two.warnings]));
				assert.deepEqual([one.items[0].closed, two.items[0].closed], [false, true]);
			} finally {
				manager.dispose();
			}
		});

		test('drops only the scope the provider refuses, keeping its siblings in the batch', async () => {
			const other = { ...collection, name: 'Other' };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection, other] });
			await withManager(server, async (manager, target) => {
				const counted = await manager.countIssues({
					...target,
					scopes: [
						{ key: 'healthy', org: 'Default Collection' },
						{
							key: 'mixed',
							repos: [
								{ namespace: 'Default Collection', name: 'a', project: 'Web' },
								{ namespace: 'Other', name: 'b', project: 'Web' },
							],
						},
					],
				});
				assert.equal(counted.fetchFailed, true);
				assert.deepEqual(counted.items, [
					{ key: 'healthy', count: 5, exceedsProviderLimit: false, providerLimit: 20000 },
				]);
				assert.equal(counted.warnings.length, 1);
				assert.match(counted.warnings[0].message, /span several collections/);
			});
		});

		test('isolates a failed count batch from the others', async () => {
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [collection],
				failWiqlFor: /Unassigned/,
			});
			await withManager(server, async (manager, target) => {
				const counted = await manager.countIssues({
					...target,
					scopes: [{ key: 'bad', org: 'Default Collection', criteria: { text: 'Unassigned' } }],
				});
				assert.equal(counted.fetchFailed, true);
				assert.deepEqual(counted.items, []);
				assert.equal(counted.warnings.length, 1);
			});
		});

		test('broadens a collection through the search rather than a repository drain', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const result = await manager.broadenIssues({
					orgs: [{ ...target, name: 'Default Collection' }],
				});
				assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
				assert.deepEqual(result.broadenedProviderIds, [id]);
				assert.deepEqual(
					result.items.map(i => i.id),
					['5', '4', '3', '2', '1'],
					'every open work item of the collection, assigned or not',
				);
				assert.ok(!server.requests.some(r => r.url.pathname.includes('/_apis/git/repositories')));
			});
		});

		test('refuses the search when project discovery was incomplete', async () => {
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [collection],
				failProjectFor: 'Default Collection',
			});
			await withManager(server, async (manager, target) => {
				const result = await manager.searchIssuesPage({
					...target,
					criteria: { relationships: ['assigned'] },
				});
				assert.equal(result.fetchFailed, true);
				assert.ok(!server.requests.some(r => r.url.pathname.endsWith('/wiql')));
			});
		});
	});

	suite('pull requests', () => {
		test('unions relationships per repository, keeps project and repository identity, and orders the page', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const result = await manager.searchPullRequestsPage({
					...target,
					org: 'Default Collection',
					criteria: {
						relationships: [PullRequestFilter.Author, PullRequestFilter.ReviewRequested],
						sort: 'created:desc',
					},
				});
				assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
				assert.deepEqual(
					result.items.map(pr => `${pr.project?.name}/${pr.repository?.repo}#${pr.id}`),
					['Payments & Billing/ledger#1', 'Web/site#2', 'Web/api#3', 'Web/site#1'],
					'PR #1 in two projects stays two rows; PR #3 matching both relationships is one',
				);
			});
		});

		test('applies text, draft, state and dates exactly, and the count matches the list', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const repos = [{ namespace: 'Default Collection', name: 'site', project: 'Web' }];
				const cases: [PullRequestSearchCriteria, string[]][] = [
					[{ text: 'fix' }, ['2']],
					[{ draft: false }, ['1']],
					[{ states: ['merged'] }, ['5']],
					// Several states are one drain: the count is their union, the total the list pages through.
					[{ states: ['open', 'merged'] }, ['5', '2', '1']],
					[{ states: ['all'], updatedAfter: '2026-01-03' }, ['5', '2']],
				];
				for (const [criteria, expected] of cases) {
					const list = await manager.searchPullRequestsPage({ ...target, repos: repos, criteria: criteria });
					assert.ok(!list.fetchFailed, JSON.stringify(list.warnings));
					assert.deepEqual(
						list.items.map(pr => pr.id),
						expected,
						JSON.stringify(criteria),
					);

					const counted = await manager.countPullRequests({
						...target,
						scopes: [{ key: 'k', repos: repos, criteria: criteria }],
					});
					assert.equal(counted.items[0]?.count, expected.length, JSON.stringify(criteria));
				}
			});
		});

		test('pages with a keyset cursor without losing later-page matches', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const seen: string[] = [];
				let cursor: string | undefined;
				for (let i = 0; i < 10; i++) {
					const page = await manager.searchPullRequestsPage({
						...target,
						org: 'Default Collection',
						criteria: { states: ['all'] },
						itemsPerPage: 2,
						cursor: cursor,
					});
					assert.ok(!page.fetchFailed, JSON.stringify(page.warnings));
					seen.push(...page.items.map(pr => `${pr.project?.name}#${pr.id}`));
					if (!page.hasMore) break;

					cursor = page.cursor;
				}
				assert.equal(seen.length, collection.pullRequests.length);
				assert.equal(new Set(seen).size, seen.length);
			});
		});

		test('refuses a repository name that would widen the route instead of encoding it', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const count = server.requests.length;
				const result = await manager.searchPullRequestsPage({
					...target,
					repos: [{ namespace: 'Default Collection', name: '..', project: 'Web' }],
				});
				assert.equal(result.fetchFailed, true);
				assert.ok(
					!server.requests.slice(count).some(r => r.url.pathname.endsWith('/_apis/git/pullRequests')),
					'no project-wide read is issued in its place',
				);
			});
		});

		test('bounds a facet drain by the rows it read, not by the rows the states kept', async () => {
			const many: FakePullRequest[] = Array.from({ length: 2500 }, (_, i) => ({
				id: i + 1,
				project: 'Web',
				repository: 'site',
				title: `PR ${i + 1}`,
				created: '2026-01-01T00:00:00Z',
				status: i < 3 ? 'abandoned' : 'active',
			}));
			const server = createServer({
				installation: 'https://server.test/tfs',
				collections: [{ ...collection, pullRequests: many }],
			});
			await withManager(server, async (manager, target) => {
				const result = await manager.searchPullRequestsPage({
					...target,
					repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
					criteria: { states: ['closed', 'merged'] },
				});
				const reads = server.requests.filter(r => r.url.pathname.endsWith('/pullRequests')).length;
				assert.equal(reads, 10, 'stops at 1,000 rows read');
				assert.equal(result.page.truncated, true);

				// Its count is unknown past the bound, never the rows read presented as a total or a floor.
				const counted = await manager.countPullRequests({
					...target,
					scopes: [
						{
							key: 'k',
							repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
							criteria: { states: ['closed', 'merged'] },
						},
					],
				});
				assert.deepEqual(counted.items, [
					{ key: 'k', count: undefined, exceedsProviderLimit: false, providerLimit: undefined },
				]);
			});
		});

		test('reads each collection projects once, however many of its repositories are searched', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				// The connect-time discovery runs detached; let it finish so only the search's own reads are counted.
				await new Promise(resolve => setTimeout(resolve, 0));
				const count = server.requests.length;
				const result = await manager.searchPullRequestsPage({
					...target,
					repos: [
						{ namespace: 'Default Collection', name: 'site', project: 'Web' },
						{ namespace: 'Default Collection', name: 'api', project: 'Web' },
						{ namespace: 'Default Collection', name: 'ledger', project: 'Payments & Billing' },
					],
				});
				assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
				const discovery = server.requests.slice(count).filter(r => r.url.pathname.endsWith('/_apis/projects'));
				assert.equal(discovery.length, 1);
			});
		});

		// The SDK reports the next page with each one; the drain must follow it rather than count pages itself, and
		// refuse a continuation that doesn't advance instead of re-reading rows into the union.
		for (const [label, continuation, expectFailure] of [
			['follows a non-sequential continuation', (page: number) => (page === 1 ? 3 : null), false],
			['refuses a continuation that does not advance', (page: number) => page, true],
		] as const) {
			test(`${label} from the provider`, async () => {
				const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
				// The service, not the published facade: the test reaches the integration to stub its SDK read.
				const manager = createIntegrationService(server.runtime);
				try {
					await manager.refreshConnections();
					const [connection] = manager.getConfigured(id);
					const target = { providerId: id, connectionId: connection.id, domain: connection.domain };
					const integration = await manager.get(id, connection.domain);
					const api = await (
						integration as unknown as {
							getProvidersApi(): Promise<{ providers: Record<string, Record<string, unknown>> }>;
						}
					).getProvidersApi();
					const requested: number[] = [];
					api.providers[id].getPullRequestsForRepoFn = (input: { page?: number }) => {
						const page = input.page ?? 1;
						requested.push(page);
						const next = continuation(page);
						return Promise.resolve({
							data: [{ ...fakeProviderPullRequest(page), id: String(page) }],
							pageInfo: { hasNextPage: next != null, nextPage: next, currentPage: page },
						});
					};

					const result = await manager.searchPullRequestsPage({
						...target,
						repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
					});
					if (expectFailure) {
						assert.equal(result.fetchFailed, true);
						assert.deepEqual(requested, [1]);
					} else {
						assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
						assert.deepEqual(requested, [1, 3], 'the page the provider named, not a local counter');
						assert.deepEqual(result.items.map(pr => pr.id).sort(), ['1', '3']);
					}
				} finally {
					manager.dispose();
				}
			});
		}

		test('never serves one query the cached drain of another, even across a continuation', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const repos = [{ namespace: 'Default Collection', name: 'site', project: 'Web' }];
				// Every state, so each query has more than one page at one row per page.
				const all = { states: ['all' as const] };
				const first = await manager.searchPullRequestsPage({
					...target,
					repos: repos,
					criteria: all,
					itemsPerPage: 1,
				});
				// Different queries drain while the first pagination is open, and each count reads its own drain;
				// `draft: false` is its own query, never the drain of an omitted draft filter.
				const counted = await manager.countPullRequests({
					...target,
					scopes: [
						{ key: 'drafts', repos: repos, criteria: { ...all, draft: true } },
						{ key: 'non-drafts', repos: repos, criteria: { ...all, draft: false } },
						{ key: 'any', repos: repos, criteria: all },
					],
				});
				assert.deepEqual(
					counted.items.map(i => [i.key, i.count]),
					[
						['drafts', 1],
						['non-drafts', 2],
						['any', 3],
					],
				);

				const next = await manager.searchPullRequestsPage({
					...target,
					repos: repos,
					criteria: all,
					itemsPerPage: 1,
					cursor: first.cursor,
				});
				assert.ok(!next.fetchFailed, JSON.stringify(next.warnings));
				assert.equal(next.items.length, 1, 'the continuation still pages its own drain');
			});
		});

		test('keeps a pagination on its own drain when the same query starts again', async () => {
			const mutable = { ...collection, pullRequests: [...collection.pullRequests] };
			const server = createServer({ installation: 'https://server.test/tfs', collections: [mutable] });
			await withManager(server, async (manager, target) => {
				const scope = {
					...target,
					repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
					criteria: { states: ['all' as const], sort: 'updated:desc' as const },
					itemsPerPage: 1,
				};
				// By last change (Azure's close date, else creation): Merged (Jan 5), Draft fix (Jan 3), Old (Jan 1).
				const first = await manager.searchPullRequestsPage(scope);
				assert.deepEqual(
					first.items.map(pr => pr.id),
					['5'],
				);

				// Old is completed mid-pagination, moving it ahead of the position already served, and another
				// consumer starts the same query. A shared drain would hand the first pagination the new order, where
				// resuming after Merged skips Old.
				mutable.pullRequests = mutable.pullRequests.map(p =>
					p.repository === 'site' && p.id === 1
						? { ...p, status: 'completed', closed: '2026-02-01T00:00:00Z' }
						: p,
				);
				const other = await manager.searchPullRequestsPage(scope);
				assert.deepEqual(
					other.items.map(pr => pr.id),
					['1'],
				);

				const pages = [first];
				while (pages.at(-1)!.cursor != null) {
					pages.push(await manager.searchPullRequestsPage({ ...scope, cursor: pages.at(-1)!.cursor }));
				}
				assert.deepEqual(
					pages.flatMap(p => p.items.map(pr => pr.id)),
					['5', '2', '1'],
					'the earlier pagination reads the drain its first page read',
				);
			});
		});

		test('keeps a pagination being read while other searches start', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const repos = [{ namespace: 'Default Collection', name: 'site', project: 'Web' }];
				const scope = { ...target, repos: repos, criteria: { states: ['all' as const] }, itemsPerPage: 1 };
				const first = await manager.searchPullRequestsPage(scope);

				// Thirty other searches start, each with its own drain, before the pagination reads its next page.
				for (let i = 0; i < 30; i++) {
					const other = await manager.searchPullRequestsPage({
						...target,
						repos: repos,
						criteria: { states: ['all'], text: `query ${i}` },
					});
					assert.ok(!other.fetchFailed, JSON.stringify(other.warnings));
				}

				const next = await manager.searchPullRequestsPage({ ...scope, cursor: first.cursor });
				assert.ok(!next.fetchFailed, JSON.stringify(next.warnings));
				assert.equal(next.items.length, 1);
			});
		});

		test('counts from a search just read, but drains again once that drain is a minute old', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			const realNow = Date.now;
			try {
				await withManager(server, async (manager, target) => {
					const scope = {
						repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
						criteria: { states: ['all' as const] },
					};
					const pulls = () => server.requests.filter(r => r.url.pathname.endsWith('/pullRequests')).length;
					await manager.searchPullRequestsPage({ ...target, ...scope });
					const drained = pulls();

					await manager.countPullRequests({ ...target, scopes: [{ key: 'k', ...scope }] });
					assert.equal(pulls(), drained, 'the count right after its search reads that drain');

					// Counting again does not keep the drain alive: past a minute from the drain it is read afresh.
					const start = realNow();
					Date.now = () => start + 30 * 1000;
					await manager.countPullRequests({ ...target, scopes: [{ key: 'k', ...scope }] });
					assert.equal(pulls(), drained);
					Date.now = () => start + 61 * 1000;
					await manager.countPullRequests({ ...target, scopes: [{ key: 'k', ...scope }] });
					assert.ok(pulls() > drained, 'a live count drains again');
				});
			} finally {
				Date.now = realNow;
			}
		});

		test('bounds the drains kept for counts however many searches start', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			// The service, not the published facade: the test reaches the integration to read its cache sizes.
			const manager = createIntegrationService(server.runtime);
			try {
				await manager.refreshConnections();
				const [connection] = manager.getConfigured(id);
				const target = { providerId: id, connectionId: connection.id, domain: connection.domain };
				for (let i = 0; i < 30; i++) {
					await manager.searchPullRequestsPage({
						...target,
						repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
						criteria: { states: ['all'], text: `query ${i}` },
					});
				}
				// Capacity is enforced after the call that exceeds it, in a microtask.
				await new Promise(resolve => setTimeout(resolve, 0));

				const integration = (await manager.get(id, connection.domain)) as unknown as {
					_latestPullRequestSearches: { size: number };
				};
				assert.ok(
					integration._latestPullRequestSearches.size <= 20,
					String(integration._latestPullRequestSearches.size),
				);
			} finally {
				manager.dispose();
			}
		});

		test('refuses a continuation whose drain expired or belongs to another connection', async () => {
			const installation = 'https://server.test/tfs';
			const server = createServer({
				installation: installation,
				collections: [collection],
				accounts: [
					{ tokenId: 'connection', token: 'me-token', baseUrl: installation },
					{ tokenId: 'secondary', token: 'someone-token', baseUrl: installation },
				],
			});
			await withManager(server, async (manager, target) => {
				const scope = {
					...target,
					org: 'Default Collection',
					criteria: { relationships: [PullRequestFilter.Author] },
					itemsPerPage: 1,
				};
				const first = await manager.searchPullRequestsPage(scope);
				assert.ok(first.cursor != null);

				// The same query on another account: its drain was never read, so the cursor has nothing to resume.
				const count = server.requests.length;
				const foreign = await manager.searchPullRequestsPage({
					...scope,
					connectionId: 'secondary',
					cursor: first.cursor,
				});
				assert.equal(foreign.fetchFailed, true);
				assert.match(foreign.warnings[0].message, /restart the read without a cursor/);
				assert.ok(
					!server.requests.slice(count).some(r => r.url.pathname.endsWith('/pullRequests')),
					'nothing is drained to resume against',
				);

				// A fresh manager has none of the drains, as after they expired.
				const resumed = server.createManager();
				try {
					await resumed.refreshConnections();
					const expired = await resumed.searchPullRequestsPage({ ...scope, cursor: first.cursor });
					assert.equal(expired.fetchFailed, true);
					assert.match(expired.warnings[0].message, /expired/);
				} finally {
					resumed.dispose();
				}
			});
		});

		test('keeps two accounts on one installation apart', async () => {
			const installation = 'https://server.test/tfs';
			const server = createServer({
				installation: installation,
				collections: [collection],
				accounts: [
					{ tokenId: 'connection', token: 'me-token', baseUrl: installation },
					{ tokenId: 'secondary', token: 'someone-token', baseUrl: installation },
				],
			});
			await withManager(server, async (manager, target) => {
				const criteria = { relationships: [PullRequestFilter.Author] };
				const mine = await manager.searchPullRequestsPage({
					...target,
					org: 'Default Collection',
					criteria: criteria,
				});
				const theirs = await manager.searchPullRequestsPage({
					...target,
					connectionId: 'secondary',
					org: 'Default Collection',
					criteria: criteria,
				});
				assert.equal(mine.items.length, 3, 'open pull requests created by the primary account');
				assert.equal(theirs.items.length, 1, 'the second account reads its own identity, not a cached drain');

				const secondaryRequests = server.requests.filter(r => r.token === 'someone-token');
				assert.ok(secondaryRequests.length > 0);
				assert.ok(
					secondaryRequests.every(
						r =>
							!r.url.searchParams.has('searchCriteria.creatorId') ||
							r.url.searchParams.get('searchCriteria.creatorId') === 'someone',
					),
				);
			});
		});

		for (const connectionUrl of ['https://server.test/tfs', 'https://server.test/tfs/Default%20Collection']) {
			test(`the account-wide my pull requests read addresses each collection once below ${connectionUrl}`, async () => {
				const server = createServer({
					installation: 'https://server.test/tfs',
					connectionUrl: connectionUrl,
					collections: [collection],
				});
				await withManager(server, async (manager, target) => {
					const result = await manager.listPullRequestsPage({
						...target,
						states: ['all'],
						filters: [PullRequestFilter.Author],
					});
					assert.ok(!result.fetchFailed, JSON.stringify(result.warnings));
					assert.equal(result.items.length, 4);
					for (const request of server.requests) {
						assert.ok(
							!decodeURIComponent(request.url.pathname).includes('Default Collection/Default Collection'),
							request.url.href,
						);
					}
				});
			});
		}

		for (const connectionUrl of ['https://server.test/tfs', 'https://server.test/tfs/Default%20Collection']) {
			test(`the legacy my pull requests read uses the collection identity below ${connectionUrl}`, async () => {
				const server = createServer({
					installation: 'https://server.test/tfs',
					connectionUrl: connectionUrl,
					collections: [collection],
				});
				const service = createIntegrationService(server.runtime);
				try {
					await service.refreshConnections();
					const result = await service.getMyPullRequests([id]);
					assert.ok(result != null && result.error == null, String(result?.error));
					assert.deepEqual(
						result.value?.map(pr => `${pr.repository.repo}#${pr.id}`).sort(),
						['api#3', 'ledger#1', 'site#1', 'site#2'],
						'open PRs the user created or reviews, by the collection identity',
					);
					for (const request of server.requests) {
						assert.ok(
							!decodeURIComponent(request.url.pathname).includes('Default Collection/Default Collection'),
							request.url.href,
						);
					}
				} finally {
					service.dispose();
				}
			});
		}

		test('the existing relationship-filtered reads use the collection identity and a Basic credential', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			await withManager(server, async (manager, target) => {
				const repoScoped = await manager.listPullRequestsPage({
					...target,
					repos: [{ namespace: 'Default Collection', name: 'site', project: 'Web' }],
					states: ['all'],
					filters: [PullRequestFilter.Author],
				});
				assert.ok(!repoScoped.fetchFailed, JSON.stringify(repoScoped.warnings));
				assert.deepEqual(repoScoped.items.map(pr => pr.id).sort(), ['1', '5']);

				const accountWide = await manager.listPullRequestsPage({
					...target,
					states: ['all'],
					filters: [PullRequestFilter.Author],
				});
				assert.ok(!accountWide.fetchFailed, JSON.stringify(accountWide.warnings));
				assert.equal(accountWide.items.length, 4, 'every pull request the user created in the collection');
			});
		});

		test('fails the search, rather than serving a partial union, when a facet read fails', async () => {
			const server = createServer({ installation: 'https://server.test/tfs', collections: [collection] });
			const fetch = server.runtime.http.fetch;
			server.runtime.http.fetch = async (input, init) => {
				const url = new URL(input);
				if (/\/Web\/_apis\/git\/pullRequests$/i.test(decodeURIComponent(url.pathname))) {
					return json({ message: 'boom' }, 401);
				}
				return fetch(input, init);
			};
			await withManager(server, async (manager, target) => {
				const result = await manager.searchPullRequestsPage({ ...target, org: 'Default Collection' });
				assert.equal(result.fetchFailed, true);
				assert.deepEqual(result.items, []);
				assert.equal(result.warnings[0].kind, 'auth');
			});
		});
	});
});
