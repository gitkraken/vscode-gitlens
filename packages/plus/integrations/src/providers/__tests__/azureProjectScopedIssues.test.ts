import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { ProviderAuthenticationSession } from '../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';

/**
 * Azure DevOps is a git host, so it can never reach `listIssueTrackerIssuesPage` (gated on
 * `isIssuesIntegration`). Its account-wide issue read therefore fanned out over EVERY project of EVERY org with
 * no way to narrow it, forcing a consumer to filter client-side — which desynchronizes the filtered `items`
 * from that read's `hasMore`/`currentPage` and surfaces "no issues" for a page holding none of project P's.
 * `listIssuesPage({ org, project })` scopes the fan-out instead, since each drain is already a per-project read.
 */
suite('Azure project-scoped issue reads', () => {
	type OrgDescriptor = { key: string; id: string; name: string };
	type ProjectDescriptor = { key: string; id: string; name: string; resourceId: string; resourceName: string };

	function org(name: string): OrgDescriptor {
		return { key: name, id: `${name}-id`, name: name };
	}

	function project(resource: OrgDescriptor, name: string): ProjectDescriptor {
		return {
			key: `${resource.name}/${name}`,
			id: `${name}-id`,
			name: name,
			resourceId: resource.id,
			resourceName: resource.name,
		};
	}

	/**
	 * Stubs Azure's org/project discovery and its per-project work-item read, returning the (namespace, project)
	 * pairs the read actually hit so a test can assert on the drained scope rather than only on the items.
	 */
	async function setup(orgs: OrgDescriptor[], projects: ProjectDescriptor[]) {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		assert.ok(azure != null, 'the Azure integration resolves');
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			id: 'primary',
			accessToken: 't',
			account: { id: 'me', label: 'me' },
			scopes: [],
			domain: 'dev.azure.com',
			protocol: 'https',
		} as unknown as ProviderAuthenticationSession;

		const internals = azure as unknown as {
			getProviderCurrentAccount: () => Promise<{ id: string; username: string }>;
			getProviderResourcesForUser: () => Promise<OrgDescriptor[]>;
			getProviderProjectsForResources: (
				session: unknown,
				resources: OrgDescriptor[],
			) => Promise<{ values: ProjectDescriptor[] }>;
			getProvidersApi: () => Promise<{ providers: Record<string, Record<string, unknown>> }>;
		};
		internals.getProviderCurrentAccount = () => Promise.resolve({ id: 'me', username: 'me' });
		internals.getProviderResourcesForUser = () => Promise.resolve(orgs);
		// Discovery is scoped by the org filter BEFORE it runs, so record what it was asked to discover.
		const discoveryRequests: string[][] = [];
		internals.getProviderProjectsForResources = (_session, resources) => {
			discoveryRequests.push(resources.map(r => r.name));
			const names = new Set(resources.map(r => r.name));
			return Promise.resolve({ values: projects.filter(p => names.has(p.resourceName)) });
		};

		const api = await internals.getProvidersApi();
		const drained: string[] = [];
		(
			api.providers[GitCloudHostIntegrationId.AzureDevOps] as {
				getIssuesForAzureProjectFn: (input: {
					namespace: string;
					project: string;
				}) => Promise<{ data: unknown[]; pageInfo: { hasNextPage: boolean; nextPage: number | null } }>;
			}
		).getIssuesForAzureProjectFn = input => {
			drained.push(`${input.namespace}/${input.project}`);
			return Promise.resolve({
				data: [
					{
						id: `${input.project}-1`,
						title: `${input.project} work item`,
						url: `https://dev.azure.com/${input.namespace}/${input.project}/_workitems/edit/1`,
					},
				],
				pageInfo: { hasNextPage: false, nextPage: null },
			});
		};

		return { manager: manager, drained: drained, discoveryRequests: discoveryRequests };
	}

	test('drains only the requested project', async () => {
		const contoso = org('contoso');
		const { manager, drained } = await setup([contoso], [project(contoso, 'Alpha'), project(contoso, 'Beta')]);
		try {
			const result = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				project: 'Beta',
			});

			assert.deepEqual(
				[...new Set(drained)],
				['contoso/Beta'],
				'the unrequested project is never read, so the cost scales with the scope',
			);
			assert.ok(result.items.length > 0, 'the requested project’s work items come back');
			assert.equal(result.fetchFailed, undefined, 'a scoped read is not a failure');
		} finally {
			manager.dispose();
		}
	});

	test('scopes project discovery by org before it runs', async () => {
		const contoso = org('contoso');
		const fabrikam = org('fabrikam');
		const { manager, drained, discoveryRequests } = await setup(
			[contoso, fabrikam],
			[project(contoso, 'Alpha'), project(fabrikam, 'Alpha')],
		);
		try {
			await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				org: 'fabrikam',
			});

			assert.deepEqual(
				discoveryRequests,
				[['fabrikam']],
				'the other org’s projects are never discovered, let alone drained',
			);
			assert.deepEqual([...new Set(drained)], ['fabrikam/Alpha']);
		} finally {
			manager.dispose();
		}
	});

	test('an unmatched project is an empty success, not an unsupported read', async () => {
		const contoso = org('contoso');
		const { manager, drained } = await setup([contoso], [project(contoso, 'Alpha')]);
		try {
			const result = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				project: 'Missing',
			});

			assert.deepEqual(drained, [], 'nothing is drained for a project that does not exist');
			assert.deepEqual(result.items, []);
			assert.equal(result.hasMore, false);
			// `undefined` from the provider read is reported as "account-wide issue search is not supported",
			// which would send the consumer down a repo-scoped fallback for what is simply an empty scope.
			assert.equal(result.fetchFailed, undefined, 'an empty scope is a successful empty page');
			assert.deepEqual(result.warnings, [], 'and carries no unsupported/truncation warning');
		} finally {
			manager.dispose();
		}
	});

	test('an org with no projects is an empty success once a scope was requested', async () => {
		const empty = org('empty');
		const { manager, drained } = await setup([empty], []);
		try {
			const result = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				org: 'empty',
			});

			assert.deepEqual(drained, []);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, undefined, 'a project-less org is empty, not unsupported');
			assert.deepEqual(result.warnings, []);
		} finally {
			manager.dispose();
		}
	});

	test('an org filter matching nothing never reaches project discovery', async () => {
		const contoso = org('contoso');
		const { manager, drained, discoveryRequests } = await setup([contoso], [project(contoso, 'Alpha')]);
		try {
			const result = await manager.listIssuesPage({
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				org: 'nope',
			});

			assert.deepEqual(discoveryRequests, [], 'no org matched, so nothing is discovered');
			assert.deepEqual(drained, []);
			assert.deepEqual(result.items, []);
			assert.equal(result.fetchFailed, undefined);
			assert.deepEqual(result.warnings, []);
		} finally {
			manager.dispose();
		}
	});
});
