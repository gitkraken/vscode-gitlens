import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderReadContext } from '../reads/context.js';
import { listOrgs, listProjects } from '../reads/hierarchy.js';
import { listIssueTrackerIssuesPage } from '../reads/issueTracker.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * A Jira project is addressed by its key, and a site by its id. A project's display name is free text that can equal
 * ANOTHER project's key, and JQL resolves `project = "<value>"` against keys first, so reading by name can return
 * another project's issues; and a remembered selection matched by any identifier can resolve, after its site or
 * project is removed, to another one that happens to carry the old value as a name or id.
 */

type Project = ResourceDescriptor & { id: string; name: string; resourceId: string };

/**
 * A read context over one fake tracker, recording each project issue read. The integration answers only what the
 * facade reads ask, so these tests pin the facade's selection, not a provider's own discovery.
 */
function trackerContext(providerId: IntegrationIds, resources: ResourceDescriptor[], projects: Project[]) {
	const reads: string[] = [];
	const integration = {
		id: providerId,
		type: 'issues',
		getCurrentAccount: () => Promise.resolve(undefined),
		getAccountForResourceResult: () => Promise.resolve({ value: { id: 'me', name: 'me', username: 'me' } }),
		getResourcesForUserResult: () => Promise.resolve({ value: resources }),
		getProjectsForResourcesWithMetadataResult: (scoped: ResourceDescriptor[]) =>
			Promise.resolve({ value: { values: projects.filter(p => scoped.some(r => r.key === p.resourceId)) } }),
		/**
		 * The provider's lists as they are now, past the cache: what the cached reads above answer, read through them at
		 * call time so a test that replaces one replaces both.
		 */
		getUncachedDiscoveryResult: async (projectsOf: (resource: ResourceDescriptor) => boolean) => {
			const discovered = await (
				integration.getResourcesForUserResult as () => Promise<{
					value?: ResourceDescriptor[];
					error?: Error;
				}>
			)();
			if (discovered.error != null && discovered.value == null) return { error: discovered.error };
			if (discovered.value == null) return { value: { resources: undefined } };

			const scoped = discovered.value.filter(projectsOf);
			const listed = await (
				integration.getProjectsForResourcesWithMetadataResult as (
					scoped: ResourceDescriptor[],
				) => Promise<{ value?: { values: Project[]; metadata?: unknown }; error?: Error }>
			)(scoped);
			if (listed.error != null && listed.value == null) return { error: listed.error };
			return { value: { resources: discovered.value, projects: listed.value } };
		},
		getUncachedAccountForResourceResult: (resource: ResourceDescriptor) =>
			(integration.getAccountForResourceResult as (resource: ResourceDescriptor) => Promise<unknown>)(resource),
		getIssuesForProjectsWithTruncationResult: (requests: { project: Project }[]) =>
			Promise.resolve(
				requests.map(({ project }) => {
					reads.push(`${project.resourceId}:${project.key}`);
					return { value: { values: [{ id: `${project.resourceId}:${project.key}` }], truncated: false } };
				}),
			),
	};
	const ctx = {
		getIntegrationForRead: () => Promise.resolve(integration),
		domainForRead: () => undefined,
		forceRefreshIfRequested: () => Promise.resolve(),
	} as unknown as ProviderReadContext;
	return { ctx: ctx, reads: reads, integration: integration as Record<string, unknown> };
}

/** The one warning a selection that a complete discovery no longer contains reports, on an empty, unfailed page. */
function assertSelectorMiss(
	page: Awaited<ReturnType<typeof listIssueTrackerIssuesPage>>,
	selector: { kind: 'org' | 'project'; value: string },
): void {
	assert.deepEqual(page.items, []);
	assert.equal(page.fetchFailed, undefined);
	assert.equal(page.hasMore, false);
	assert.equal(page.cursor, undefined);
	assert.deepEqual(
		page.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth, selector: w.selector, scope: w.scope })),
		[{ kind: 'not-found', isAuth: false, selector: selector, scope: undefined }],
	);
}

function assertNoSelectorMiss(page: Awaited<ReturnType<typeof listIssueTrackerIssuesPage>>): void {
	assert.equal(
		page.warnings.some(w => w.selector != null || w.kind === 'not-found'),
		false,
	);
}

function jiraSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'atlassian.net',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function providerIssue(number: string) {
	return {
		id: `id-${number}`,
		number: number,
		title: number,
		url: `https://site.atlassian.net/browse/${number}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: null,
		assignees: [],
		labels: [],
	};
}

suite('Jira project identity', () => {
	test('Jira Cloud reads a project by its key and attributes a failure mid-drain to it, not to its name', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = jiraSession();
		const reads: [string, string][] = [];
		stubApi(jira, {
			getIssuesForProjectPaged: (
				_token: unknown,
				project: string,
				resourceId: string,
				options: { cursor?: string },
			) => {
				reads.push([project, resourceId]);
				if (options.cursor != null) return Promise.reject(new Error('Jira search unavailable'));

				return Promise.resolve({ data: [providerIssue(`${project}-1`)], hasMore: true, nextCursor: 'next' });
			},
		});

		// The name is another project's key: a read by name would read OTHER.
		const result = await jira.getIssuesForProjectWithTruncationResult({
			id: '100',
			key: 'OPS',
			name: 'OTHER',
			resourceId: 'site-a',
		});

		assert.deepEqual(reads, [
			['OPS', 'site-a'],
			['OPS', 'site-a'],
		]);
		assert.deepEqual(
			result?.value?.values.map(issue => issue.id),
			['OPS-1'],
		);
		assert.equal(result?.value?.truncated, true);
		assert.deepEqual(
			result?.value?.metadata?.failures?.map(f => ({ scope: f.scope, message: f.message })),
			[
				{
					scope: { providerId: IssuesCloudHostIntegrationId.Jira, resourceId: 'site-a', projectId: 'OPS' },
					message: 'Jira search unavailable',
				},
			],
		);

		manager.dispose();
	});

	for (const providerId of [IssuesCloudHostIntegrationId.Jira, IssuesSelfManagedHostIntegrationId.JiraServer]) {
		suite(providerId, () => {
			// Every name and id collides with another descriptor's key: only the keys tell them apart.
			const sites = (): ResourceDescriptor[] => [
				{ key: 'site-a', id: 'site-a', name: 'Production' },
				{ key: 'site-b', id: 'site-b', name: 'site-a' },
			];
			const projects = (): Project[] => [
				{ key: 'OPS', id: '100', name: 'OTHER', resourceId: 'site-a' },
				{ key: 'OTHER', id: '200', name: 'OPS', resourceId: 'site-a' },
				{ key: 'THIRD', id: 'OPS', name: 'Third', resourceId: 'site-a' },
				{ key: 'OPS', id: '300', name: 'Other site', resourceId: 'site-b' },
			];

			test('lists each project by its key, with its site as label and id', async () => {
				const { ctx } = trackerContext(providerId, sites(), projects());

				const catalog = await listProjects(ctx, { providerId: providerId });

				assert.deepEqual(
					catalog.items.map(({ id, name, org, orgId }) => ({ id: id, name: name, org: org, orgId: orgId })),
					[
						{ id: '100', name: 'OPS', org: 'Production', orgId: 'site-a' },
						{ id: '200', name: 'OTHER', org: 'Production', orgId: 'site-a' },
						{ id: 'OPS', name: 'THIRD', org: 'Production', orgId: 'site-a' },
						{ id: '300', name: 'OPS', org: 'site-a', orgId: 'site-b' },
					],
				);
			});

			test('a listed project selects exactly that project, by its key and its site id', async () => {
				const { ctx, reads } = trackerContext(providerId, sites(), projects());
				const catalog = await listProjects(ctx, { providerId: providerId });

				for (const item of catalog.items) {
					const page = await listIssueTrackerIssuesPage(ctx, {
						providerId: providerId,
						org: item.orgId,
						project: item.name,
						includeAllAssignees: true,
					});
					assert.deepEqual(
						page.items.map(issue => issue.id),
						[`${item.orgId}:${item.name}`],
					);
				}
				assert.equal(reads.length, catalog.items.length);
			});

			test("a listed site's id selects it; its label does not", async () => {
				const { ctx } = trackerContext(providerId, sites(), projects());
				const orgs = await listOrgs(ctx, { providerId: providerId });
				const production = orgs.items.find(org => org.id === 'site-a')!;
				assert.equal(production.name, 'Production');

				const byId = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: production.id,
					project: 'OPS',
					includeAllAssignees: true,
				});
				assert.deepEqual(
					byId.items.map(issue => issue.id),
					['site-a:OPS'],
				);

				const byLabel = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: production.name,
					project: 'OPS',
					includeAllAssignees: true,
				});
				assertSelectorMiss(byLabel, { kind: 'org', value: 'Production' });
			});

			test('a removed project or site selects nothing rather than one that carries its key as a name or id', async () => {
				const currentSites = sites();
				const currentProjects = projects();
				const { ctx, reads } = trackerContext(providerId, currentSites, currentProjects);
				const selection = {
					providerId: providerId,
					org: 'site-a',
					project: 'OPS',
					includeAllAssignees: true,
				};

				// OPS is gone; OTHER is still named "OPS" and THIRD still has the id "OPS".
				currentProjects.shift();
				const missingProject = await listIssueTrackerIssuesPage(ctx, selection);
				assertSelectorMiss(missingProject, { kind: 'project', value: 'OPS' });
				assert.match(missingProject.warnings[0].message, /'OPS' in 'site-a'/);

				// site-a is gone; site-b is still named "site-a".
				currentSites.shift();
				const missingSite = await listIssueTrackerIssuesPage(ctx, selection);
				assertSelectorMiss(missingSite, { kind: 'org', value: 'site-a' });

				assert.deepEqual(reads, [], 'no project is read for a selection that matches nothing');
			});

			test('a removed project selected without a site misses the project', async () => {
				const { ctx } = trackerContext(providerId, sites(), projects());

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					project: 'GONE',
					includeAllAssignees: true,
				});
				assertSelectorMiss(page, { kind: 'project', value: 'GONE' });
				assert.doesNotMatch(page.warnings[0].message, / in '/);
			});

			test('a selected site with no projects left misses the project', async () => {
				const { ctx } = trackerContext(providerId, sites(), []);

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'OPS',
					includeAllAssignees: true,
				});
				assertSelectorMiss(page, { kind: 'project', value: 'OPS' });
			});

			for (const [label, lookup] of [
				['fails', { error: new Error('(401) Unauthorized.') }],
				['answers no user', { value: undefined }],
				['answers an account with no name', { value: { id: 'me' } }],
			] as const) {
				test(`a removed project is not reported missing when the account lookup ${label}`, async () => {
					const { ctx, integration } = trackerContext(providerId, sites(), projects());
					let uncached = 0;
					integration.getUncachedAccountForResourceResult = () => {
						uncached++;
						return Promise.resolve(lookup);
					};

					for (const selection of [
						{ org: 'site-a', project: 'GONE' },
						{ org: 'site-gone', project: 'OPS' },
					]) {
						const page = await listIssueTrackerIssuesPage(ctx, {
							providerId: providerId,
							...selection,
							includeAllAssignees: true,
						});
						assert.deepEqual(page.items, []);
						assert.equal(page.fetchFailed, true);
						assert.notEqual(page.cursor, undefined, 'the read can be retried');
						assertNoSelectorMiss(page);
						assert.equal(page.warnings.length, 1);
					}
					assert.equal(uncached, 2, 'looked up past any lookup in flight');
				});
			}

			test('an account with no sites left misses the site', async () => {
				const { ctx } = trackerContext(providerId, [], projects());

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'OPS',
					includeAllAssignees: true,
				});
				assertSelectorMiss(page, { kind: 'org', value: 'site-a' });
			});

			test('an account with no sites left misses a project selected without a site', async () => {
				const { ctx, reads } = trackerContext(providerId, [], projects());

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					project: 'OPS',
					includeAllAssignees: true,
				});
				assertSelectorMiss(page, { kind: 'project', value: 'OPS' });
				assert.deepEqual(reads, []);
			});

			test('an incomplete project discovery reports its failure, not a missing project', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getProjectsForResourcesWithMetadataResult = () =>
					Promise.resolve({
						value: {
							values: [],
							metadata: {
								completeness: 'partial',
								failures: [{ kind: 'authentication', scope: { resourceId: 'site-a' } }],
							},
						},
					});

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'OPS',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.equal(page.fetchFailed, true);
				assert.ok(
					page.warnings.some(w => w.kind === 'auth' && w.scope?.resourceId === 'site-a'),
					'the failure is reported',
				);
				assertNoSelectorMiss(page);
			});

			test('a project discovery that answered with an error reports it, not a missing project', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getProjectsForResourcesWithMetadataResult = () =>
					Promise.resolve({ value: { values: projects() }, error: new Error('some projects unavailable') });

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'GONE',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.ok(page.warnings.some(w => w.message.includes('some projects unavailable')));
				assertNoSelectorMiss(page);
			});

			test('a truncated project discovery reports the truncation, not a missing project', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getProjectsForResourcesWithMetadataResult = () =>
					Promise.resolve({ value: { values: projects(), metadata: { completeness: 'unknown' } } });

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'GONE',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.equal(page.page.truncated, true);
				assertNoSelectorMiss(page);
			});

			test('a site discovery that answered with an error reports it, not a missing site', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getResourcesForUserResult = () =>
					Promise.resolve({ value: sites(), error: new Error('some sites unavailable') });

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-gone',
					project: 'OPS',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.ok(page.warnings.some(w => w.message.includes('some sites unavailable')));
				assertNoSelectorMiss(page);
			});

			test('a site discovery that answered with an error reports it, not a missing project', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getResourcesForUserResult = () =>
					Promise.resolve({ value: sites(), error: new Error('some sites unavailable') });

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'GONE',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.ok(page.warnings.some(w => w.message.includes('some sites unavailable')));
				assertNoSelectorMiss(page);
			});

			test('a failed site discovery reports its failure, not a missing site', async () => {
				const { ctx, integration } = trackerContext(providerId, sites(), projects());
				integration.getResourcesForUserResult = () =>
					Promise.resolve({ error: new Error('discovery unavailable') });

				const page = await listIssueTrackerIssuesPage(ctx, {
					providerId: providerId,
					org: 'site-a',
					project: 'OPS',
					includeAllAssignees: true,
				});
				assert.deepEqual(page.items, []);
				assert.equal(page.fetchFailed, true);
				assert.ok(page.warnings.some(w => w.message.includes('discovery unavailable')));
				assertNoSelectorMiss(page);
			});
		});
	}

	test('Linear keeps selecting a team and workspace by any identifier, and publishes no orgId', async () => {
		const { ctx } = trackerContext(
			IssuesCloudHostIntegrationId.Linear,
			[{ key: 'workspace-id', id: 'workspace-id', name: 'Workspace' }],
			[{ key: 'ENG', id: 'team-id', name: 'Engineering', resourceId: 'workspace-id' }],
		);

		const catalog = await listProjects(ctx, { providerId: IssuesCloudHostIntegrationId.Linear });
		assert.equal(catalog.items[0].name, 'Engineering');
		assert.equal(catalog.items[0].org, 'Workspace');
		assert.equal('orgId' in catalog.items[0], false);

		const page = await listIssueTrackerIssuesPage(ctx, {
			providerId: IssuesCloudHostIntegrationId.Linear,
			org: 'Workspace',
			project: 'Engineering',
			includeAllAssignees: true,
		});
		assert.deepEqual(
			page.items.map(issue => issue.id),
			['workspace-id:ENG'],
		);

		const missing = await listIssueTrackerIssuesPage(ctx, {
			providerId: IssuesCloudHostIntegrationId.Linear,
			org: 'Workspace',
			project: 'Design',
			includeAllAssignees: true,
		});
		assertSelectorMiss(missing, { kind: 'project', value: 'Design' });
	});
});
