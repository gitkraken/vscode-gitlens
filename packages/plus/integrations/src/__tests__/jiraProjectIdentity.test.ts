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
		getResourcesForUserResult: () => Promise.resolve({ value: resources }),
		getProjectsForResourcesWithMetadataResult: (scoped: ResourceDescriptor[]) =>
			Promise.resolve({ value: { values: projects.filter(p => scoped.some(r => r.key === p.resourceId)) } }),
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
	return { ctx: ctx, reads: reads };
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
				assert.deepEqual(byLabel.items, []);
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
				assert.deepEqual(missingProject.items, []);

				// site-a is gone; site-b is still named "site-a".
				currentSites.shift();
				const missingSite = await listIssueTrackerIssuesPage(ctx, selection);
				assert.deepEqual(missingSite.items, []);

				assert.deepEqual(reads, [], 'no project is read for a selection that matches nothing');
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
	});
});
