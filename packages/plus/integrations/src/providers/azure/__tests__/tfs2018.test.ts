import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IntegrationAuthenticationService } from '../../../authentication/integrationAuthenticationService.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.js';
import { AuthenticationError } from '../../../errors.js';
import { ProvidersApi } from '../../providersApi.js';
import { AzureDevOpsApi } from '../azure.js';
import { AzureWorkItemStatesCache, requireAzureWorkItemStateCategories } from '../workItemStateCategories.js';
import { azureProject, azureProvider, azureToken, createAzurePullRequest, createWorkItem } from './fixtures.js';

const baseUrl = 'http://tfs.example.test:8080/tfs';
const collection = 'DefaultCollection';
const project = azureProject.name;
const token: TokenWithInfo<typeof GitSelfManagedHostIntegrationId.AzureDevOpsServer> = {
	...azureToken,
	providerId: GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	cloud: false,
};
const scope = { baseUrl: baseUrl, namespace: collection, project: project, token: token.accessToken, isPAT: true };

function location(id: string, routeTemplate: string, preview = false) {
	return {
		id: id,
		routeTemplate: routeTemplate,
		minVersion: '1.0',
		maxVersion: '4.0',
		releasedVersion: preview ? '0.0' : '4.0',
		resourceVersion: 1,
	};
}

const resources = {
	wit: [
		location('1a9c53f7-f243-4447-b110-35ef023636e4', '{project}/{team}/_apis/wit/wiql'),
		location('72c7ddf8-2cdc-4f60-90cd-ab71c14a399b', '_apis/wit/workItems/{id}'),
		location('7c8d7a76-4a09-43e8-b5df-bd792f4ac6aa', '{project}/_apis/wit/workItemTypes/{type}'),
		location('7c9d7a76-4a09-43e8-b5df-bd792f4ac6aa', '{project}/_apis/wit/workItemTypes/{type}/states', true),
	],
	git: [
		location(
			'9946fd70-0d40-406e-b686-b4744cbbcc37',
			'{project}/_apis/git/repositories/{repositoryId}/pullRequests/{pullRequestId}',
		),
		location('225f7195-f9c7-4d14-ab28-a83f7ff77e1f', '{project}/_apis/git/repositories/{repositoryId}'),
		location(
			'b3a6eebe-9cf0-49ea-b6cb-1a4c5f5007b0',
			'{project}/_apis/git/repositories/{repositoryId}/pullRequestQuery',
			true,
		),
	],
	IMS: [
		location('28010c54-d0c0-4c89-a5b0-1c9e188b9fb7', '_apis/identities/{identityId}'),
		location('299e50df-fe45-4d3a-8b5b-a5836fac74dc', '_apis/identitybatch', true),
	],
	work: [location('7799f497-3cb5-4f16-ad4f-5cd06012db64', '{project}/{team}/_apis/work/backlogconfiguration', true)],
};

const legacyStates = {
	value: [
		{ name: 'Active', color: '007acc' },
		{ name: 'Closed', color: '339933' },
		{ name: 'New', color: 'b2b2b2' },
		{ name: 'Removed', color: 'ffffff' },
	],
};
const legacyMappings = {
	workItemTypeMappedStates: [
		{ workItemTypeName: 'Task', states: { New: 'Proposed', Active: 'InProgress', Closed: 'Completed' } },
	],
};

function harness() {
	const requests: { url: URL; method: string }[] = [];
	let state = 'New';
	let itemProject = project;
	let discoveryStatus = 200;
	let legacyIdentity: string | undefined;
	const item = () => {
		const value = createWorkItem();
		value.fields['System.TeamProject'] = itemProject;
		value.fields['System.WorkItemType'] = 'Task';
		value.fields['System.State'] = state;
		if (legacyIdentity !== undefined) {
			value.fields['System.CreatedBy'] = legacyIdentity;
			value.fields['System.AssignedTo'] = legacyIdentity;
		}

		return value;
	};
	const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(input.toString());
		const method = init?.method ?? 'GET';
		requests.push({ url: url, method: method });
		const route = decodeURIComponent(url.pathname)
			.replace(`/tfs/${collection}/`, '')
			.replace('/workItems', '/workitems');
		if (method === 'OPTIONS') {
			const area = route.split('/').at(-1) as keyof typeof resources;
			assert.ok(resources[area], route);
			return Response.json({ value: resources[area] }, { status: discoveryStatus });
		}

		assert.match(url.searchParams.get('api-version') ?? '', /^4\.0(?:-preview\.1)?$/);
		if (route === `${project}/_apis/wit/workItemTypes/Task/states`) return Response.json(legacyStates);
		if (route === `${project}/_apis/wit/workItemTypes`) return Response.json({ value: [{ name: 'Task' }] });
		if (route === `${project}/_apis/work/backlogconfiguration`) return Response.json(legacyMappings);
		if (route === '_apis/wit/workitems/42') return Response.json(item());
		if (route === '_apis/wit/workitems/999') {
			return Response.json({ typeKey: 'WorkItemUnauthorizedAccessException' }, { status: 404 });
		}
		if (route === '_apis/wit/workitems') return Response.json({ value: [item(), null] });
		if (route === '_apis/identities') return Response.json({ value: [{ memberOf: ['group-descriptor'] }] });
		if (route === '_apis/identitybatch') return Response.json({ value: [{ id: 'group-id' }] });
		if (route === '_apis/wit/wiql' || route === `${project}/_apis/wit/wiql`) {
			return Response.json({ workItems: [{ id: 42 }] });
		}
		if (route === `${project}/_apis/git/repositories/repo/pullrequests/5`) {
			return Response.json(createAzurePullRequest(url.toString(), project, 'repo'));
		}
		throw new Error(`Unexpected request: ${url.toString()}`);
	};
	return {
		api: new ProvidersApi({ ctx: { http: { fetch: fetch } } } as unknown as IntegrationAuthenticationService),
		native: new AzureDevOpsApi({ fetch: fetch, wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()) }),
		requests: requests,
		useLegacyIdentity: (value = 'Jane Example <DOMAIN\\jane>') => {
			legacyIdentity = value;
		},
		setState: (value: string) => {
			state = value;
		},
		setProject: (value: string) => {
			itemProject = value;
		},
		denyDiscovery: () => {
			discoveryStatus = 401;
		},
	};
}

suite('TFS 2018 core REST compatibility', () => {
	test('point and etag reads use the advertised collection route and legacy categories', async () => {
		const h = harness();
		const coordinate = { namespace: collection, project: project };
		const options = { baseUrl: baseUrl, isPAT: true };
		const issue = await h.api.getAzureWorkItem(token, coordinate, 42, options);
		assert.equal(issue?.state?.category, 'TO_DO');
		const etags = await h.api.getAzureWorkItemsEtagFields(token, coordinate, [42], options);
		assert.equal(etags[0].category, 'TO_DO');
		assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/backlogconfiguration')).length, 1);
		assert.equal(h.requests.filter(r => r.method === 'OPTIONS').length, 2);
		assert.ok(
			h.requests
				.filter(r => r.url.pathname.includes('/workitems'))
				.every(r => !r.url.pathname.includes(`/${project}/`)),
		);
	});

	test('native issue readers use the collection work item route and exact mapped categories', async () => {
		const h = harness();
		const descriptor = { ...azureProject, resourceName: collection };
		const issue = await h.native.getIssue(azureProvider, token, descriptor, '42', { baseUrl: baseUrl });
		assert.equal(issue?.id, '42');
		assert.equal(issue?.state, 'opened');
		const either = await h.native.getIssueOrPullRequest(
			azureProvider,
			token,
			collection,
			`${project}/_git/repo`,
			'42',
			{ baseUrl: baseUrl, type: 'issue' },
		);
		assert.equal(either?.id, '42');
	});

	test('partial legacy selection metadata still classifies mapped list rows from its single snapshot', async () => {
		const h = harness();
		const result = await h.api.getIssuesForAzureProject(token, collection, project, {
			baseUrl: baseUrl,
			isPAT: true,
		});
		assert.equal(result.values.length, 1);
		assert.equal(result.values[0].state?.category, 'TO_DO');
		assert.equal(result.metadata?.completeness, 'partial');
		assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/states')).length, 1);
	});

	test('legacy collection routes preserve project isolation and typed absence', async () => {
		const h = harness();
		const coordinate = { namespace: collection, project: project };
		const options = { baseUrl: baseUrl, isPAT: true };
		assert.equal(await h.api.getAzureWorkItem(token, coordinate, 999, options), undefined);
		h.setProject('Another project');
		await assert.rejects(h.api.getAzureWorkItem(token, coordinate, 42, options), /not 'Payments'/);
	});

	test('legacy identity strings retain the SDK opaque identity contract on both core point paths', async () => {
		const h = harness();
		h.useLegacyIdentity();
		const issue = await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
			baseUrl: baseUrl,
			isPAT: true,
		});
		assert.equal(issue?.author?.id, 'Jane Example <DOMAIN\\jane>');
		assert.equal(issue?.author?.username, 'Jane Example <DOMAIN\\jane>');
		const native = await h.native.getIssue(
			azureProvider,
			token,
			{ ...azureProject, resourceName: collection },
			'42',
			{ baseUrl: baseUrl },
		);
		assert.equal(native?.author?.id, issue?.author?.id);
		assert.equal(native?.author?.name, issue?.author?.name);
	});

	test('blank legacy identity fields do not create an assignee', async () => {
		const h = harness();
		h.useLegacyIdentity('');
		const issue = await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
			baseUrl: baseUrl,
			isPAT: true,
		});
		assert.equal(issue?.author, null);
		assert.deepEqual(issue?.assignees, []);
		const native = await h.native.getIssue(
			azureProvider,
			token,
			{ ...azureProject, resourceName: collection },
			'42',
			{ baseUrl: baseUrl },
		);
		assert.equal(native?.author, undefined);
		assert.deepEqual(native?.assignees, []);
	});

	test('a collection point read without project evidence cannot answer a project coordinate', async () => {
		const h = harness();
		h.setProject('');
		await assert.rejects(
			h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
				baseUrl: baseUrl,
				isPAT: true,
			}),
			/has no project/,
		);
	});

	test('a missing category is never inferred from a state name or color', async () => {
		const h = harness();
		h.setState('Removed');
		await assert.rejects(
			h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
				baseUrl: baseUrl,
				isPAT: true,
			}),
			/does not expose a category/,
		);
	});

	test('discovery auth errors propagate without retrying resource reads', async () => {
		const h = harness();
		h.denyDiscovery();
		await assert.rejects(
			h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
				baseUrl: baseUrl,
				isPAT: true,
			}),
			AuthenticationError,
		);
		assert.deepEqual(
			h.requests.map(r => r.method),
			['OPTIONS'],
		);
	});

	test('reviewer group reads negotiate the IMS versions with one discovery', async () => {
		const h = harness();
		assert.deepEqual(
			await h.api.getAzureGroupIdsForUser(token, collection, 'user-id', { baseUrl: baseUrl, isPAT: true }),
			['group-id'],
		);
		assert.equal(h.requests.filter(r => r.method === 'OPTIONS' && r.url.pathname.endsWith('/IMS')).length, 1);
	});

	test('cheap pull request reads negotiate the legacy version', async () => {
		const h = harness();
		const pr = await h.api.getAzurePullRequest(
			token,
			{ namespace: collection, project: project, name: 'repo' },
			5,
			{ baseUrl: baseUrl, isPAT: true },
		);
		assert.equal(pr?.pullRequestId, 5);
	});

	test('search and count use WIQL 4.0 and GET hydration when batch is not registered', async () => {
		const h = harness();
		const options = {
			baseUrl: baseUrl,
			criteria: { state: 'all' as const },
			projectNames: [project],
			resolveProject: () => azureProject,
		};
		const page = await h.native.searchWorkItemsPage(azureProvider, token, collection, options);
		assert.equal(page.values[0].id, '42');
		assert.equal(await h.native.countWorkItems(azureProvider, token, collection, options), 1);
		assert.ok(h.requests.some(r => r.url.pathname.endsWith('/workitems') && r.method === 'GET'));
		assert.ok(h.requests.every(r => !r.url.pathname.includes('/workitemsbatch')));
	});

	test('legacy GET hydration rejects a work item that moved outside the requested project', async () => {
		const h = harness();
		h.setProject('Another project');
		await assert.rejects(
			h.native.searchWorkItemsPage(azureProvider, token, collection, {
				baseUrl: baseUrl,
				criteria: { state: 'all' },
				projectNames: [project],
				resolveProject: () => azureProject,
			}),
			/outside the requested projects/,
		);
	});

	test('exact state-filtered searches fail explicitly when a workflow has unmapped states', async () => {
		const h = harness();
		await assert.rejects(
			h.native.countWorkItems(azureProvider, token, collection, { baseUrl: baseUrl, projectNames: [project] }),
			/does not expose a category/,
		);
		assert.ok(h.requests.every(r => !r.url.pathname.endsWith('/wiql')));
	});
});

suite('TFS workflow metadata cache', () => {
	test('retains known mappings and leaves absent pairs unknown', async () => {
		const cache = new AzureWorkItemStatesCache();
		const states = await cache.getStates(
			scope,
			'Task',
			async () => legacyStates,
			undefined,
			async () => legacyMappings,
		);
		assert.equal(states.find(s => s.name === 'New')?.category, 'Proposed');
		assert.equal(states.find(s => s.name === 'Removed')?.category, undefined);
		assert.throws(() => requireAzureWorkItemStateCategories(states), /does not expose a category/);
	});

	test('uses explicit category values even when a state name suggests the opposite', async () => {
		const cache = new AzureWorkItemStatesCache();
		const states = await cache.getStates(
			scope,
			'Task',
			async () => legacyStates,
			undefined,
			async () => ({
				workItemTypeMappedStates: [
					{ workItemTypeName: 'Task', states: { New: 'Completed', Closed: 'Proposed' } },
				],
			}),
		);
		assert.equal(states.find(s => s.name === 'New')?.category, 'Completed');
		assert.equal(states.find(s => s.name === 'Closed')?.category, 'Proposed');
	});

	test('keeps native categories without requesting backlog mappings', async () => {
		const cache = new AzureWorkItemStatesCache();
		const states = await cache.getStates(
			scope,
			'Task',
			async () => ({ value: [{ name: 'Closed', category: 'Proposed' }] }),
			undefined,
			async () => {
				throw new Error('must not read mappings');
			},
		);
		assert.equal(states[0].category, 'Proposed');
	});

	test('shares project mappings between types but isolates credentials and connections', async () => {
		const cache = new AzureWorkItemStatesCache();
		let reads = 0;
		const read = async () => {
			reads++;
			return legacyMappings;
		};
		await cache.getStates(scope, 'Task', async () => legacyStates, undefined, read);
		await cache.getStates(scope, 'Issue', async () => legacyStates, undefined, read);
		assert.equal(reads, 1);
		await cache.getStates({ ...scope, token: 'another-token' }, 'Task', async () => legacyStates, undefined, read);
		await cache.getStates(
			{ ...scope, baseUrl: 'https://another.example.test' },
			'Task',
			async () => legacyStates,
			undefined,
			read,
		);
		assert.equal(reads, 3);
		cache.clear();
		await cache.getStates(scope, 'Task', async () => legacyStates, undefined, read);
		assert.equal(reads, 4);
	});
});
