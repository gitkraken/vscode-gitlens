import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { GitConfigEntityIdentifier } from '../providers/models.js';
import type { ProvidersApi } from '../providers/providersApi.js';
import {
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
} from '../providers/utils.js';
import { isIssuesHostIntegrationId, isSelfManagedHostIntegrationId } from '../utils/integration.utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Jira Server/Data Center (#5864): a self-hosted issue tracker, which is a combination nothing in this package
 * had before — a tracker addressed by the connection's own host. The two properties these tests exist to hold
 * are that every read is routed to THAT host, and that two configured hosts never share state.
 */

function jiraServerSession(domain: string): ProviderAuthenticationSession {
	return {
		id: `conn-${domain}`,
		accessToken: `tok-${domain}`,
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'pat',
		domain: domain,
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function withSession(integration: IssuesIntegration, domain: string): IssuesIntegration {
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = jiraServerSession(domain);
	return integration;
}

function providerIssue(number: string, baseUrl: string) {
	return {
		id: `i${number}`,
		number: number,
		title: `Issue ${number}`,
		url: `${baseUrl}/browse/PROJ-${number}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [],
		labels: [],
	};
}

/**
 * An issue as the SDK reports it for a point read: `number` is the KEY (`PROJ-1`), which becomes `IssueShape.id`.
 *
 * The project is supplied by the stub. The SDK's Jira normalizer reports `project.resourceId` and `namespace` as
 * null for Jira Server, which `toIssueShape` reads as "no project", and a branch association cannot be encoded
 * without one; what is under test here is the identifier's host routing, not that mapping.
 */
function providerIssueForKey(key: string, baseUrl: string) {
	return {
		...providerIssue(key.replace(/^PROJ-/, ''), baseUrl),
		number: key,
		project: { id: 'p1', name: 'PROJ', key: 'PROJ', resourceId: new URL(baseUrl).host, namespace: 'PROJ' },
	};
}

/** Two hosts whose point reads record the base URL they were addressed to, so routing is asserted on requests. */
async function twoHostsRecordingIssueReads(manager: ReturnType<typeof createIntegrationManager>) {
	const hostA = withSession(
		(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-a.example.com'))!,
		'jira-a.example.com',
	);
	const hostB = withSession(
		(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-b.example.com'))!,
		'jira-b.example.com',
	);
	const reads: string[] = [];
	for (const host of [hostA, hostB]) {
		stubApi(host, {
			getJiraServerIssue: (_t: unknown, baseUrl: string, key: string) => {
				reads.push(baseUrl);
				return Promise.resolve(key === 'PROJ-404' ? undefined : providerIssueForKey(key, baseUrl));
			},
		});
	}
	return { hostA: hostA, hostB: hostB, reads: reads };
}

/** Encodes a branch association for `PROJ-1` read from the given host, the way the extension does. */
async function encodedAssociationFrom(host: IssuesIntegration): Promise<GitConfigEntityIdentifier> {
	const issue = await host.getIssue((await host.getResourcesForUser())![0], 'PROJ-1');
	assert.ok(issue != null, 'the host answered the point read');
	const owner = getIssueOwner(issue);
	assert.ok(owner != null, 'a self-hosted issue derives an owner from its project');
	return encodeIssueOrPullRequestForGitConfig(issue, owner);
}

suite('Jira Server/Data Center (#5864)', () => {
	test('is an issue tracker, and is keyed by host like the other self-managed providers', () => {
		const id = IssuesSelfManagedHostIntegrationId.JiraServer;
		// Both must hold at once: the tracker half routes it to the issue-tracker reads (and refuses the
		// repo/PR surfaces), the self-managed half is what makes every key carry the domain.
		assert.equal(isIssuesHostIntegrationId(id), true, 'reads must treat it as a tracker, not a git host');
		assert.equal(isSelfManagedHostIntegrationId(id), true, 'connections must be keyed by host');
	});

	test('returns undefined when no domain is supplied or configured, and constructs with one', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			assert.equal(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer), undefined);

			const integration = await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com');
			assert.ok(integration != null);
			assert.equal(integration.id, IssuesSelfManagedHostIntegrationId.JiraServer);
			assert.equal(integration.domain, 'jira.example.com');
		} finally {
			manager.dispose();
		}
	});

	test('every read is addressed to the configured host, never to Jira Cloud', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		const baseUrls: string[] = [];
		stubApi(jiraServer, {
			getJiraServerCurrentUser: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve({ id: 'me', name: 'Me', username: 'me', email: null, avatarUrl: null });
			},
			getJiraServerProjects: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve([{ id: 'p1', name: 'PROJ' }]);
			},
			getJiraServerIssuesForProjectPaged: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
			},
			getJiraServerIssue: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve(providerIssue('1', baseUrl));
			},
		});

		const resources = await jiraServer.getResourcesForUser();
		assert.deepEqual(
			resources?.map(r => r.key),
			['jira.example.com'],
			'a self-hosted instance is its own single resource',
		);

		await jiraServer.getAccountForResource(resources[0]);
		const projects = (await jiraServer.getProjectsForResourcesWithMetadataResult(resources))?.value?.values;
		assert.equal(projects?.length, 1);
		await jiraServer.getIssuesForProject(projects[0]);
		await jiraServer.getIssue(resources[0], 'PROJ-1');

		assert.ok(baseUrls.length >= 4, 'every read went through the API');
		for (const baseUrl of baseUrls) {
			assert.equal(baseUrl, 'https://jira.example.com', 'reads target the configured host');
		}

		manager.dispose();
	});

	test('two configured hosts stay independent instances with their own projects', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const first = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-a.example.com'))!,
			'jira-a.example.com',
		);
		const second = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-b.example.com'))!,
			'jira-b.example.com',
		);

		assert.notEqual(first, second, 'each host gets its own integration instance');

		// Same project id on both hosts, different names: a cache keyed only by token (both sessions could
		// legitimately carry one) would serve host A's projects for host B.
		stubApi(first, {
			getJiraServerProjects: () => Promise.resolve([{ id: 'p1', name: 'ALPHA' }]),
		});
		stubApi(second, {
			getJiraServerProjects: () => Promise.resolve([{ id: 'p1', name: 'BETA' }]),
		});

		const firstProjects = (
			await first.getProjectsForResourcesWithMetadataResult((await first.getResourcesForUser())!)
		)?.value?.values;
		const secondProjects = (
			await second.getProjectsForResourcesWithMetadataResult((await second.getResourcesForUser())!)
		)?.value?.values;

		assert.deepEqual(
			firstProjects?.map(p => p.key),
			['ALPHA'],
		);
		assert.deepEqual(
			secondProjects?.map(p => p.key),
			['BETA'],
			"the second host's projects are its own, not the first host's cached set",
		);

		manager.dispose();
	});

	test('drains every page of a project read, threading the SDK cursor', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		const cursors: (string | undefined)[] = [];
		stubApi(jiraServer, {
			getJiraServerProjects: () => Promise.resolve([{ id: 'p1', name: 'PROJ' }]),
			getJiraServerIssuesForProjectPaged: (
				_t: unknown,
				baseUrl: string,
				_projectKey: string,
				options?: { cursor?: string },
			) => {
				cursors.push(options?.cursor);
				const page = options?.cursor == null ? 1 : Number(options.cursor);
				return Promise.resolve({
					data: [providerIssue(String(page), baseUrl)],
					hasMore: page < 3,
					nextCursor: page < 3 ? String(page + 1) : undefined,
				});
			},
		});

		const projects = (
			await jiraServer.getProjectsForResourcesWithMetadataResult((await jiraServer.getResourcesForUser())!)
		)?.value?.values;
		const issues = await jiraServer.getIssuesForProject(projects![0]);

		assert.deepEqual(cursors, [undefined, '2', '3'], 'each page threads the previous page cursor');
		assert.equal(issues?.length, 3, 'issues from all three pages are returned');

		manager.dispose();
	});

	test('a resolved user scopes the read to the assignee rather than fetching the whole project', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		const captured: { assigneeLogins?: string[] }[] = [];
		stubApi(jiraServer, {
			getJiraServerProjects: () => Promise.resolve([{ id: 'p1', name: 'PROJ' }]),
			getJiraServerIssuesForProjectPaged: (
				_t: unknown,
				_baseUrl: string,
				_projectKey: string,
				options?: { assigneeLogins?: string[] },
			) => {
				captured.push(options ?? {});
				return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
			},
		});

		const projects = (
			await jiraServer.getProjectsForResourcesWithMetadataResult((await jiraServer.getResourcesForUser())!)
		)?.value?.values;
		await jiraServer.getIssuesForProject(projects![0], { user: 'me' });

		assert.deepEqual(captured[0]?.assigneeLogins, ['me'], 'defaults to the assignee filter for the user');

		manager.dispose();
	});

	test('a failed read surfaces as a structured error result, not an empty success', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		stubApi(jiraServer, {
			getJiraServerProjects: () => Promise.reject(new Error('boom')),
		});

		const result = await jiraServer.getProjectsForResourcesWithMetadataResult(
			(await jiraServer.getResourcesForUser())!,
		);
		assert.ok(result?.error != null, 'the failure is recovered into { error } so callers can warn on it');
		assert.equal(result?.value, undefined);

		manager.dispose();
	});

	test('an account-wide read failure is an error result, not an empty success', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		// Jira Cloud swallows this per resource so one bad site cannot discard the others. A self-hosted
		// connection addresses exactly one instance, so swallowing would report an expired token as "no issues".
		stubApi(jiraServer, {
			getJiraServerIssuesForCurrentUser: () => Promise.reject(new Error('401 Unauthorized')),
		});

		const result = await jiraServer.searchMyIssuesResult();
		assert.ok(result?.error != null, 'the failure reaches the caller as { error }');
		assert.equal(result?.value, undefined, 'and not as an empty list of issues');

		manager.dispose();
	});

	test("reads keep the connection's configured context path, which the host-keyed domain has stripped", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		// What a Data Center instance mounted below a context path looks like: `IntegrationService.get()`
		// normalizes the domain to the bare host, so the path only survives on the session.
		const jiraServer = (await manager.get(
			IssuesSelfManagedHostIntegrationId.JiraServer,
			'https://jira.example.com/jira',
		))!;
		// `domain` is the normalized host on BOTH the integration and the session — that is what production
		// stores, since `toProviderSession` derives it with `hostFromDomain`. The configured address survives
		// only on `baseUrl`, so pinning it here is what proves the read uses that field and not the host.
		(jiraServer as unknown as { _session: ProviderAuthenticationSession })._session = {
			...jiraServerSession('jira.example.com'),
			baseUrl: 'https://jira.example.com/jira',
		};

		assert.equal(jiraServer.domain, 'jira.example.com', 'the connection is still keyed by bare host');

		const baseUrls: string[] = [];
		stubApi(jiraServer, {
			getJiraServerCurrentUser: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve({ id: 'me', name: 'Me', username: 'me', email: null, avatarUrl: null });
			},
			getJiraServerProjects: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve([{ id: 'p1', name: 'PROJ' }]);
			},
			getJiraServerIssue: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve(providerIssue('1', baseUrl));
			},
		});

		const resources = (await jiraServer.getResourcesForUser())!;
		await jiraServer.getAccountForResource(resources[0]);
		await jiraServer.getProjectsForResourcesWithMetadataResult(resources);
		await jiraServer.getIssue(resources[0], 'PROJ-1');

		assert.ok(baseUrls.length >= 3, 'every read went through the API');
		for (const baseUrl of baseUrls) {
			assert.equal(baseUrl, 'https://jira.example.com/jira', 'the context path reaches every request');
		}
		assert.equal(
			resources[0].url,
			'https://jira.example.com/jira',
			'the synthesized resource points at the same place the reads do',
		);

		manager.dispose();
	});

	test('a baseUrl naming another host is refused, and the read stays on the keyed host', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!;
		// A stored session whose baseUrl drifted to a different host (a reconfigured connection, a corrupted
		// descriptor) must not redirect this integration's reads somewhere its key never named.
		(jiraServer as unknown as { _session: ProviderAuthenticationSession })._session = {
			...jiraServerSession('jira.example.com'),
			baseUrl: 'https://evil.example.com/jira',
		};

		const baseUrls: string[] = [];
		stubApi(jiraServer, {
			getJiraServerIssue: (_t: unknown, baseUrl: string) => {
				baseUrls.push(baseUrl);
				return Promise.resolve(providerIssue('1', baseUrl));
			},
		});

		const resources = (await jiraServer.getResourcesForUser())!;
		await jiraServer.getIssue(resources[0], 'PROJ-1');

		assert.deepEqual(baseUrls, ['https://jira.example.com'], 'the read stays on the host the key names');

		manager.dispose();
	});

	test('a key that names no issue is a clean miss, not an error', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		// The real `ProvidersApi`, not a stub of it: the not-found handling under test lives inside
		// `getJiraServerIssue`, so a stubbed facade would assert nothing. Only the SDK function is replaced.
		const api = await (jiraServer as unknown as { getProvidersApi: () => Promise<ProvidersApi> }).getProvidersApi();
		const provider = (api as unknown as { providers: Record<string, Record<string, unknown>> }).providers[
			IssuesSelfManagedHostIntegrationId.JiraServer
		];
		// An autolink or a stored reference can name an issue that was deleted or never existed. Jira answers
		// 404; translating that into a `RequestNotFoundError` would log an exception where Jira Cloud's
		// `getJiraIssueByKey` and the generic `getIssue` both report nothing found.
		provider.getJiraServerIssueFn = () =>
			Promise.reject(Object.assign(new Error('Issue does not exist'), { response: { status: 404 } }));

		assert.equal(
			await api.getJiraServerIssue(
				toTokenWithInfo(IssuesSelfManagedHostIntegrationId.JiraServer, jiraServerSession('jira.example.com')),
				'https://jira.example.com',
				'PROJ-404',
			),
			undefined,
		);

		manager.dispose();
	});

	test("a connection re-pointed to another context path does not serve the old path's projects", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!;
		const sessionFor = (baseUrl: string): ProviderAuthenticationSession => ({
			...jiraServerSession('jira.example.com'),
			baseUrl: baseUrl,
		});

		// Same host, same token, different context path. A cache keyed by host and token alone cannot tell the
		// two apart, so the move would keep serving the old path's projects.
		stubApi(jiraServer, {
			getJiraServerProjects: (_t: unknown, baseUrl: string) =>
				Promise.resolve([{ id: '1', name: baseUrl.endsWith('/jira') ? 'OLD' : 'NEW' }]),
		});

		const readWith = async (baseUrl: string) => {
			(jiraServer as unknown as { _session: ProviderAuthenticationSession })._session = sessionFor(baseUrl);
			const resources = (await jiraServer.getResourcesForUser())!;
			return (await jiraServer.getProjectsForResourcesWithMetadataResult(resources))?.value?.values;
		};

		assert.deepEqual(
			(await readWith('https://jira.example.com/jira'))?.map(p => p.name),
			['OLD'],
		);
		assert.deepEqual(
			(await readWith('https://jira.example.com/jira-dc'))?.map(p => p.name),
			['NEW'],
			"the re-pointed connection reads its own path, not the previous one's cached projects",
		);

		manager.dispose();
	});

	test('a project read addresses the project by id, not by its display name', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		// JQL resolves `project = "<value>"` against key before name, so a project DISPLAY NAME that collides
		// with another project's key would read the wrong project's issues. The id cannot collide.
		const addressedBy: string[] = [];
		stubApi(jiraServer, {
			getJiraServerProjects: () => Promise.resolve([{ id: '10001', name: 'ALPHA' }]),
			getJiraServerIssuesForProjectPaged: (_t: unknown, _baseUrl: string, projectKey: string) => {
				addressedBy.push(projectKey);
				return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
			},
		});

		const projects = (
			await jiraServer.getProjectsForResourcesWithMetadataResult((await jiraServer.getResourcesForUser())!)
		)?.value?.values;
		assert.equal(projects?.[0].name, 'ALPHA', 'the display name is still what the project is called');

		await jiraServer.getIssuesForProject(projects[0]);

		assert.ok(addressedBy.length > 0, 'the project read went through the API');
		for (const value of addressedBy) {
			assert.equal(value, '10001', 'reads address the project by id');
		}

		manager.dispose();
	});

	test('an account-wide read stopped by the page backstop reports itself truncated', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		// Always another page: the drain can only stop at its own backstop, which must not be published as a
		// complete account.
		let page = 0;
		stubApi(jiraServer, {
			getJiraServerIssuesForCurrentUser: (_t: unknown, baseUrl: string) => {
				page++;
				return Promise.resolve({
					data: [providerIssue(String(page), baseUrl)],
					hasMore: true,
					nextCursor: `c${page}`,
				});
			},
		});

		const result = (await jiraServer.searchMyIssuesWithTruncationResult())?.value;
		assert.equal(result?.truncated, true, 'the backstop is reported, not swallowed');
		assert.equal(result?.values.length, 10, 'the prefix it did read is still published');
		assert.equal(result?.metadata?.completeness, 'partial');

		manager.dispose();
	});

	test('an account-wide read whose continuation never advances reports itself truncated', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		// `hasMore` with no advancing cursor: continuing would re-read the same page forever, so the drain
		// stops — but the caller has to learn it stopped early.
		stubApi(jiraServer, {
			getJiraServerIssuesForCurrentUser: (_t: unknown, baseUrl: string) =>
				Promise.resolve({ data: [providerIssue('1', baseUrl)], hasMore: true, nextCursor: undefined }),
		});

		const result = (await jiraServer.searchMyIssuesWithTruncationResult())?.value;
		assert.equal(result?.truncated, true);
		assert.equal(result?.values.length, 1);
		assert.equal(result?.metadata?.completeness, 'partial');
		// The stall belongs to the whole connection, so it names no sub-scope a consumer would read as confined
		// (#5890): the instance is this connection's only resource.
		assert.deepEqual(
			result?.metadata?.failures?.map(f => f.scope),
			[{ providerId: IssuesSelfManagedHostIntegrationId.JiraServer }],
		);

		manager.dispose();
	});

	test('a complete account-wide read is not reported as truncated', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jiraServer = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!,
			'jira.example.com',
		);

		stubApi(jiraServer, {
			getJiraServerIssuesForCurrentUser: (_t: unknown, baseUrl: string) =>
				Promise.resolve({ data: [providerIssue('1', baseUrl)], hasMore: false, nextCursor: undefined }),
		});

		const result = (await jiraServer.searchMyIssuesWithTruncationResult())?.value;
		assert.equal(result?.truncated, false);
		assert.equal(result?.values.length, 1);
		assert.equal(result?.metadata, undefined, 'a clean drain records no partial-completeness metadata');

		manager.dispose();
	});

	test('listIssueTrackerIssuesPage routes by domain, and never touches the other host', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const hostA = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-a.example.com'))!,
			'jira-a.example.com',
		);
		const hostB = withSession(
			(await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira-b.example.com'))!,
			'jira-b.example.com',
		);

		// Every call either host receives is recorded with the base URL it was addressed to, so "host A was
		// never touched" is asserted on the requests themselves rather than inferred from the result.
		const calls: string[] = [];
		const stubHost = (integration: IssuesIntegration, project: string) =>
			stubApi(integration, {
				getJiraServerProjects: (_t: unknown, baseUrl: string) => {
					calls.push(baseUrl);
					return Promise.resolve([{ id: `id-${project}`, name: project }]);
				},
				getJiraServerIssuesForProjectPaged: (_t: unknown, baseUrl: string) => {
					calls.push(baseUrl);
					return Promise.resolve({
						data: [providerIssue('1', baseUrl)],
						hasMore: false,
						nextCursor: undefined,
					});
				},
				getJiraServerCurrentUser: (_t: unknown, baseUrl: string) => {
					calls.push(baseUrl);
					return Promise.resolve({ id: 'me', name: 'Me', username: 'me', email: null, avatarUrl: null });
				},
			});
		stubHost(hostA, 'ALPHA');
		stubHost(hostB, 'BETA');

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			domain: 'jira-b.example.com',
		});

		assert.ok(calls.length > 0, 'the read reached the provider');
		for (const baseUrl of calls) {
			assert.equal(baseUrl, 'https://jira-b.example.com', 'every request went to the requested host');
		}
		assert.ok(result.items.length > 0, 'and the page carries what that host returned');
		for (const issue of result.items) {
			assert.match(issue.url, /jira-b\.example\.com/, 'every issue came from the requested host');
		}

		manager.dispose();
	});

	suite('the cloud session host guard', () => {
		// Drives the real `getCloudSession` path: a configured Jira Server connection, a mocked
		// `v1/provider-tokens` backend, and `isConnected()` as the trigger.
		const connectWith = async (
			tokenDomain: string | undefined,
			configuredBaseUrl?: string,
			configured = true,
			callerConnectionId?: string,
		) => {
			const runtime = createFakeRuntime();
			runtime.account.getAccount = async () => ({ id: 'me' });
			runtime.account.fetchGkApi = (path: string) =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							data:
								path === 'v1/provider-tokens'
									? [
											{
												tokenId: 'js1',
												provider: 'jiraServer',
												type: 'pat',
												domain: tokenDomain ?? '',
											},
										]
									: {
											tokenId: 'js1',
											accessToken: 'tok-js1',
											expiresIn: 3600,
											scopes: '',
											type: 'pat',
											...(tokenDomain != null ? { domain: tokenDomain } : {}),
										},
						}),
						{ status: 200 },
					),
				);
			await runtime.storage.store('integrations:configured', {
				'jira-server': configured
					? [
							{
								id: 'js1',
								cloud: true,
								integrationId: 'jira-server',
								scopes: '',
								primary: true,
								domain: 'jira.example.com',
								...(configuredBaseUrl != null ? { baseUrl: configuredBaseUrl } : {}),
							},
						]
					: [],
			});

			const manager = createIntegrationManager(runtime);
			// The auth provider directly: `getSession` is where the host guard lives, and going through the
			// integration would report a cached connection flag rather than what the guard decided.
			const authProvider = await (
				manager as unknown as {
					authenticationService: {
						get: (id: typeof IssuesSelfManagedHostIntegrationId.JiraServer) => Promise<{
							getSession: (
								descriptor: { domain: string; scopes: string[]; connectionId?: string },
								options?: { sync?: boolean },
							) => Promise<ProviderAuthenticationSession | undefined>;
						}>;
					};
				}
			).authenticationService.get(IssuesSelfManagedHostIntegrationId.JiraServer);
			// `sync` is what sends `getNewSession` down the cloud path; without it, an absent stored session
			// short-circuits before the guard and every case would look identical.
			const session = await authProvider.getSession(
				{
					domain: 'jira.example.com',
					scopes: [],
					...(callerConnectionId != null ? { connectionId: callerConnectionId } : {}),
				},
				{ sync: true },
			);
			manager.dispose();
			return session;
		};

		test('accepts a session the backend returned without a domain', async () => {
			// `toSession` defaults an absent wire domain to `''`, and the connection id the session was fetched
			// by already identifies the host — so "no domain" must not read as "another host", which would
			// strand the refresh and leave the integration permanently disconnected.
			assert.notEqual(await connectWith(undefined), undefined);
		});

		test("accepts a session whose domain names the connection's own host", async () => {
			assert.notEqual(await connectWith('https://jira.example.com'), undefined);
		});

		test('a refresh that reports no domain keeps the configured context path', async () => {
			// The token endpoint is allowed to omit the domain. Writing `undefined` through would reach the
			// descriptor via `writeSecret` and silently drop a context path the user never changed, so the
			// address already configured is kept instead.
			const session = await connectWith(undefined, 'https://jira.example.com/jira');
			assert.equal(session?.baseUrl, 'https://jira.example.com/jira');
		});

		test('a reported domain replaces the configured one', async () => {
			const session = await connectWith('https://jira.example.com/jira-dc', 'https://jira.example.com/jira');
			assert.equal(session?.baseUrl, 'https://jira.example.com/jira-dc');
		});

		test('refuses a domainless token when no configured connection scoped the fetch', async () => {
			// With nothing configured for this host the fetch falls through to the provider-GLOBAL primary
			// endpoint, whose token can belong to any host. Accepting a response that names no host would bind
			// that token to whatever `domain` the caller asked for and send it there.
			assert.equal(await connectWith(undefined, undefined, false), undefined);
		});

		test('refuses a domainless token fetched by a connection id we never configured for this host', async () => {
			// `descriptor.connectionId` can come from the caller, so a non-null id is not on its own evidence
			// that the token belongs here — only a descriptor WE stored for this host is. Otherwise a stale or
			// supplied id would fetch `/tokens/{id}` and have a domainless response bound to the wrong Jira.
			assert.equal(await connectWith(undefined, undefined, true, 'someone-elses-id'), undefined);
		});

		test('still refuses a session issued for a different host', async () => {
			assert.equal(await connectWith('https://other.example.com'), undefined);
		});
	});

	test("draws with Jira's glicon, not a glyph named after its id", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			const jiraServer = (await manager.get(IssuesSelfManagedHostIntegrationId.JiraServer, 'jira.example.com'))!;
			// `icon` reaches consumers on every issue as `IssueShape.provider.icon`, where it names a
			// `gl-provider-<key>` glyph. The registry has `provider-jira` and no `provider-jira-server`, so
			// returning the id would request a glyph that does not exist.
			assert.equal(jiraServer.icon, IssuesCloudHostIntegrationId.Jira);

			const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
			assert.equal(jira.icon, IssuesCloudHostIntegrationId.Jira, 'Jira Cloud is unchanged');
		} finally {
			manager.dispose();
		}
	});

	test('Jira Cloud stays cloud-keyed and unaffected', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		try {
			// Cloud takes no domain and must not have become host-keyed by the self-managed widening.
			const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
			assert.ok(jira != null);
			assert.equal(jira.domain, 'atlassian.net');
			assert.equal(isSelfManagedHostIntegrationId(IssuesCloudHostIntegrationId.Jira), false);
		} finally {
			manager.dispose();
		}
	});

	test('a branch association round-trips through the host it was encoded for (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { hostA, reads } = await twoHostsRecordingIssueReads(manager);

		const identifier = await encodedAssociationFrom(hostA);
		const encoded = identifier as unknown as { provider: string; domain: string | null; projectId: string | null };
		assert.equal(encoded.provider, 'jiraServer');
		assert.equal(encoded.domain, 'jira-a.example.com', 'the host is the identity of a self-hosted issue');
		assert.equal(encoded.projectId, 'p1');

		reads.length = 0;
		const askedFor: (string | undefined)[] = [];
		const resolved = await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			askedFor.push(domain);
			return manager.get(id, domain);
		}, identifier);

		assert.deepEqual(askedFor, ['jira-a.example.com'], 'the resolver is handed the encoded host');
		assert.deepEqual(reads, ['https://jira-a.example.com'], 'the read went to the encoded host and nowhere else');
		assert.equal(resolved?.id, 'PROJ-1');
		assert.equal(resolved?.provider.domain, 'jira-a.example.com');

		manager.dispose();
	});

	test('a branch association encoded on one host never resolves against another (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { hostA, reads } = await twoHostsRecordingIssueReads(manager);

		const identifier = await encodedAssociationFrom(hostA);
		reads.length = 0;

		// A resolver that knows only host B — a machine where host A is not configured — yields nothing, and host
		// B is never read even though it would answer for the same key with a different issue.
		const resolvedElsewhere = await getIssueFromGitConfigEntityIdentifier(
			(id, domain) => (domain === 'jira-b.example.com' ? manager.get(id, domain) : Promise.resolve(undefined)),
			identifier,
		);
		assert.equal(resolvedElsewhere, undefined);
		assert.deepEqual(reads, [], 'no host was read');

		// An identifier that names no host is dropped rather than resolved through the primary connection, which
		// is what a domainless `resolveIntegration(id)` used to fall back to.
		const domainless = { ...identifier, domain: null } as unknown as GitConfigEntityIdentifier;
		let resolverCalls = 0;
		const resolvedWithoutHost = await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			resolverCalls++;
			return manager.get(id, domain);
		}, domainless);
		assert.equal(resolvedWithoutHost, undefined);
		assert.equal(resolverCalls, 0, 'the resolver is not consulted, since it would answer from the primary');
		assert.deepEqual(reads, []);

		manager.dispose();
	});

	test('getTrackerIssue serves Jira Data Center by domain, and never reads the other host (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { reads } = await twoHostsRecordingIssueReads(manager);
		// No `resourceUrl`: the browser link comes from the base URL the read was addressed to.
		const target = {
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-b.example.com',
			domain: 'jira-b.example.com',
		};

		const found = await manager.getTrackerIssue({ ...target, key: 'PROJ-7' });

		assert.deepEqual(reads, ['https://jira-b.example.com'], 'one request, to the requested host only');
		assert.equal(found.items[0]?.key, 'PROJ-7');
		assert.equal(found.items[0]?.issue?.id, 'PROJ-7');
		assert.match(found.items[0]?.issue?.url ?? '', /^https:\/\/jira-b\.example\.com\//);
		assert.deepEqual(found.warnings, []);
		assert.equal(found.fetchFailed, undefined);

		const absent = await manager.getTrackerIssue({ ...target, key: 'PROJ-404' });

		assert.deepEqual(absent.items, [{ key: 'PROJ-404' }], 'a key that names no issue is a proven absence');
		assert.deepEqual(absent.warnings, []);
		assert.equal(absent.fetchFailed, undefined);

		manager.dispose();
	});

	test('getTrackerIssue refuses a Jira Data Center resource id that names another host (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { reads } = await twoHostsRecordingIssueReads(manager);

		// The read is cached under `resourceId`, so host B's answer must not be stored under host A's resource.
		const result = await manager.getTrackerIssue({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-a.example.com',
			domain: 'jira-b.example.com',
			key: 'PROJ-404',
		});

		assert.deepEqual(reads, [], 'no host is read');
		assert.deepEqual(result.items, [], 'no absence is reported under the mismatched resource');
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /resource id/i);

		manager.dispose();
	});

	test('getTrackerIssue refuses a Jira Data Center read that names no host (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		// Both instances are cached, so a domainless resolution would have fallen back to whichever was built first.
		const { reads } = await twoHostsRecordingIssueReads(manager);

		const result = await manager.getTrackerIssue({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-a.example.com',
			key: 'PROJ-1',
		});

		assert.deepEqual(reads, [], 'no host is consulted, primary or otherwise');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /domain or a configured connection id/i);

		manager.dispose();
	});

	test('getTrackerIssue refuses a Jira Data Center domain that names no host (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { reads } = await twoHostsRecordingIssueReads(manager);

		// An unparsable domain selects no host, so resolving it would fall back to the primary one.
		const result = await manager.getTrackerIssue({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-a.example.com',
			domain: 'https://%',
			key: 'PROJ-404',
		});

		assert.deepEqual(reads, [], 'no host is consulted, primary or otherwise');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /domain or a configured connection id/i);

		manager.dispose();
	});

	test('getTrackerIssue refuses a Jira Data Center connection id that names no configured connection (#5872)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const { reads } = await twoHostsRecordingIssueReads(manager);

		// An unknown id selects no host, so resolving it would fall back to the primary one.
		const result = await manager.getTrackerIssue({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-a.example.com',
			connectionId: 'no-such-connection',
			key: 'PROJ-1',
		});

		assert.deepEqual(reads, [], 'no host is consulted, primary or otherwise');
		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /domain or a configured connection id/i);

		manager.dispose();
	});
	test('getTrackerIssue refuses a Jira Data Center connection that has no host (#5872)', async () => {
		const runtime = createFakeRuntime();
		// A legacy descriptor without a domain selects no host, so it would resolve the primary one.
		await runtime.storage.store('integrations:configured', {
			[IssuesSelfManagedHostIntegrationId.JiraServer]: [
				{
					id: 'hostless',
					cloud: true,
					integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
					domain: '',
					scopes: '',
				},
				{
					id: 'jira-a',
					cloud: true,
					integrationId: IssuesSelfManagedHostIntegrationId.JiraServer,
					domain: 'jira-a.example.com',
					scopes: '',
					primary: true,
				},
			],
		});
		const manager = createIntegrationManager(runtime);
		const { reads } = await twoHostsRecordingIssueReads(manager);

		const result = await manager.getTrackerIssue({
			providerId: IssuesSelfManagedHostIntegrationId.JiraServer,
			resourceId: 'jira-a.example.com',
			connectionId: 'hostless',
			key: 'PROJ-404',
		});

		assert.deepEqual(reads, [], 'the primary host is not read on behalf of a hostless connection');
		assert.deepEqual(result.items, [], 'no absence is reported for it');
		assert.equal(result.fetchFailed, true);
		assert.match(result.warnings[0].message, /domain or a configured connection id/i);

		manager.dispose();
	});
});

suite('Branch-association host routing for the self-managed git hosts (#5872)', () => {
	function association(provider: string, domain: string | null): GitConfigEntityIdentifier {
		return {
			provider: provider,
			entityType: 'issue',
			version: '1',
			domain: domain,
			entityId: '7',
			accountOrOrgId: null,
			organizationName: null,
			projectId: null,
			repoId: null,
			resourceId: null,
			metadata: {
				id: '7',
				owner: { key: 'org/repo', id: 'org/repo', name: 'repo', owner: 'org' },
				createdDate: new Date(0).toISOString(),
				isCloudEnterprise: true,
			},
		} as unknown as GitConfigEntityIdentifier;
	}

	async function resolverArgs(identifier: GitConfigEntityIdentifier): Promise<[string, string | undefined][]> {
		const calls: [string, string | undefined][] = [];
		await getIssueFromGitConfigEntityIdentifier((id, domain) => {
			calls.push([id, domain]);
			return Promise.resolve(undefined);
		}, identifier);
		return calls;
	}

	test('a self-managed git host resolves the integration for the host its identifier carries', async () => {
		assert.deepEqual(await resolverArgs(association('githubEnterprise', 'ghe.example.com')), [
			[GitSelfManagedHostIntegrationId.CloudGitHubEnterprise, 'ghe.example.com'],
		]);
		assert.deepEqual(await resolverArgs(association('gitlabSelfHosted', 'gitlab.example.com')), [
			[GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'gitlab.example.com'],
		]);
		assert.deepEqual(await resolverArgs(association('azureDevOpsServer', 'ado.example.com')), [
			[GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'ado.example.com'],
		]);
	});

	test('a cached read of an unresolvable self-managed identifier does not peek the unscoped key', async () => {
		const peeked: (string | undefined)[] = [];
		const resolved = await getIssueFromGitConfigEntityIdentifier(
			() => Promise.resolve(undefined),
			association('githubEnterprise', null),
			{
				cached: true,
				peekCachedIssue: (_integration, resource) => {
					peeked.push(resource.key);
					return undefined;
				},
			},
		);

		// Without an integration the key cannot name the host, so it would match what github.com writes.
		assert.equal(resolved, undefined);
		assert.deepEqual(peeked, []);
	});

	test('a cloud host is resolved without a domain', async () => {
		assert.deepEqual(await resolverArgs(association('github', null)), [
			[GitCloudHostIntegrationId.GitHub, undefined],
		]);
	});
});
