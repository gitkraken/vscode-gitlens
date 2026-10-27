import * as assert from 'node:assert/strict';
import { GitIssueState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { Emitter } from '@gitlens/utils/event.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationService } from '../../../authentication/integrationAuthenticationService.js';
import type { TokenWithInfo } from '../../../authentication/models.js';
import { GitSelfManagedHostIntegrationId } from '../../../constants.js';
import type { ConfigChangeEvent } from '../../../context.js';
import { AuthenticationError } from '../../../errors.js';
import { issueEtag, issueEtagFieldsFromShape } from '../../../reads/etag.js';
import { ProvidersApi } from '../../providersApi.js';
import { AzureDevOpsApi } from '../azure.js';
import { toAzureWorkItemEtagFields } from '../models.js';
import { AzureWorkItemDescriptionsCache } from '../workItemDescriptions.js';
import { AzureWorkItemStatesCache, requireAzureWorkItemStateCategories } from '../workItemStateCategories.js';
import { azureProject, azureProvider, azureToken, createAzurePullRequest, createWorkItem } from './fixtures.js';

const baseUrl = 'http://tfs.example.test:8080/tfs';
const collection = 'DefaultCollection';
const project = azureProject.name;
const projectId = 'c47e55ea-54b6-4330-af70-d858e00f2338';
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
		location('b51fd764-e5c2-4b9b-aaf7-3395cf4bdd94', '_apis/wit/fields'),
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

function harness(allMappedStates = false) {
	const descriptions = new AzureWorkItemDescriptionsCache();
	const changes = new Emitter<ConfigChangeEvent>();
	let legacy = true;
	const requests: { url: URL; method: string }[] = [];
	let state = 'New';
	let itemProject = project;
	let discoveryStatus = 200;
	let legacyIdentity: string | undefined;
	let missingProject = false;
	let descriptionFields: Record<string, unknown> = {};
	let catalogStatus = 200;
	let catalogFailure: Error | undefined;
	let title: string | undefined;
	const item = () => {
		const value = createWorkItem();
		value.fields['System.TeamProject'] = itemProject;
		value.fields['System.WorkItemType'] = 'Task';
		value.fields['System.State'] = state;
		Object.assign(value.fields, descriptionFields);
		if (title != null) {
			value.fields['System.Title'] = title;
		}
		if (missingProject) {
			delete (value.fields as Partial<typeof value.fields>)['System.TeamProject'];
		}
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
			const value = resources[area].map(resource => ({
				...resource,
				maxVersion: legacy ? '4.0' : '6.0',
				releasedVersion: resource.releasedVersion === '0.0' ? '0.0' : legacy ? '4.0' : '6.0',
				routeTemplate:
					!legacy && resource.id === '72c7ddf8-2cdc-4f60-90cd-ab71c14a399b'
						? '{project}/_apis/wit/workItems/{id}'
						: resource.routeTemplate,
			}));
			return Response.json({ value: value }, { status: discoveryStatus });
		}

		if (route === `_apis/projects/${projectId}` || route === `_apis/projects/${project}`) {
			return Response.json({ id: projectId, name: project });
		}

		assert.match(
			url.searchParams.get('api-version') ?? '',
			legacy ? /^4\.0(?:-preview\.1)?$/ : /^6\.0(?:-preview\.1)?$/,
		);
		if ([project, projectId].some(name => route === `${name}/_apis/wit/workItemTypes/Task/states`)) {
			return Response.json(
				allMappedStates
					? { value: legacyStates.value.filter(state => state.name !== 'Removed') }
					: legacyStates,
			);
		}
		if (route === `${project}/_apis/wit/workItemTypes`) return Response.json({ value: [{ name: 'Task' }] });
		if ([project, projectId].some(name => route === `${name}/_apis/work/backlogconfiguration`)) {
			return Response.json(legacyMappings);
		}
		if (route === '_apis/wit/fields') {
			if (catalogFailure != null) throw catalogFailure;

			return Response.json(
				{
					value: [
						{ referenceName: legacy ? 'Custom.Notes' : 'Custom.NewNotes', name: 'Notes', type: 'html' },
					],
				},
				{ status: catalogStatus },
			);
		}
		if (route === '_apis/wit/workitems/42' || route === `${project}/_apis/wit/workitems/42`) {
			return Response.json(item());
		}
		if (route === '_apis/wit/workitems/999') {
			return Response.json({ typeKey: 'WorkItemUnauthorizedAccessException' }, { status: 404 });
		}
		if (route === '_apis/wit/workitems' || route === `${project}/_apis/wit/workitems`) {
			return Response.json({ value: [item(), null] });
		}
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
		api: new ProvidersApi(
			{
				ctx: { http: { fetch: fetch }, config: { onDidChange: changes.event } },
			} as unknown as IntegrationAuthenticationService,
			undefined,
			descriptions,
		),
		native: new AzureDevOpsApi(
			{ fetch: fetch, wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()) },
			undefined,
			descriptions,
		),
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
		omitProject: () => {
			missingProject = true;
		},
		setDescription: (fields: Record<string, unknown>, status = 200) => {
			descriptionFields = fields;
			catalogStatus = status;
		},
		setTitle: (value: string) => {
			title = value;
		},
		cancelCatalog: () => {
			catalogFailure = new CancellationError();
		},
		denyDiscovery: () => {
			discoveryStatus = 401;
		},
		changeProxy: () => {
			legacy = false;
			changes.fire({ httpProxy: true, remotes: false, integrationsEnabled: false, launchpad: false });
		},
	};
}

suite('TFS 2018 core REST compatibility', () => {
	test('proxy changes retire facade discovery and bound SDK catalog caches together', async () => {
		const h = harness();
		h.setDescription({ 'Custom.Notes': '<p>Old catalog</p>', 'Custom.NewNotes': '<p>New catalog</p>' });
		const options = { baseUrl: baseUrl, isPAT: true };
		assert.equal(
			(await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, options))
				?.description,
			'<p>Old catalog</p>',
		);
		assert.equal(
			(
				await h.api.getIssuesForAzureProject(token, collection, project, {
					...options,
					states: [GitIssueState.Open, GitIssueState.Closed],
				})
			).values[0]?.description,
			'<p>Old catalog</p>',
		);
		h.changeProxy();
		assert.equal(
			(await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, options))
				?.description,
			'<p>New catalog</p>',
		);
		assert.equal(
			(
				await h.api.getIssuesForAzureProject(token, collection, project, {
					...options,
					states: [GitIssueState.Open, GitIssueState.Closed],
				})
			).values[0]?.description,
			'<p>New catalog</p>',
		);
	});
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

	test('native linked issues resolve project IDs before checking collection membership', async () => {
		const h = harness();
		const issue = await h.native.getIssueOrPullRequest(
			azureProvider,
			token,
			collection,
			`${projectId}/_git/repo`,
			'42',
			{ baseUrl: baseUrl, type: 'issue' },
		);
		assert.equal(issue?.id, '42');
		assert.ok(h.requests.some(r => r.url.pathname.endsWith(`/_apis/projects/${projectId}`)));
	});

	test('native project validation failures remain failures on both point paths', async () => {
		const h = harness();
		h.setProject('Another project');
		await assert.rejects(
			h.native.getIssue(azureProvider, token, { ...azureProject, resourceName: collection }, '42', {
				baseUrl: baseUrl,
			}),
			/outside the requested project/,
		);
		await assert.rejects(
			h.native.getIssueOrPullRequest(azureProvider, token, collection, `${project}/_git/repo`, '42', {
				baseUrl: baseUrl,
				type: 'issue',
			}),
			/outside the requested project/,
		);
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

	test('a collection etag without project evidence cannot reuse a project coordinate', async () => {
		const h = harness();
		h.omitProject();
		const [read] = await h.api.getAzureWorkItemsEtagFields(
			token,
			{ namespace: collection, project: project },
			[42],
			{
				baseUrl: baseUrl,
				isPAT: true,
			},
		);
		assert.throws(() => toAzureWorkItemEtagFields(read.workItem, project, read.category), /has no project/);
	});

	for (const [name, fields, status, description, descriptionField] of [
		[
			'built-in fallback',
			{ 'Microsoft.VSTS.TCM.ReproSteps': '<p>Reproduce this</p>' },
			200,
			'<p>Reproduce this</p>',
			{ referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps' },
		],
		[
			'custom HTML',
			{ 'Custom.Notes': '<p>Custom content</p>' },
			200,
			'<p>Custom content</p>',
			{ referenceName: 'Custom.Notes', name: 'Notes' },
		],
		[
			'blank markup',
			{ 'System.Description': '<div></div>', 'Custom.Notes': '<p> </p>' },
			200,
			'<div></div>',
			{ referenceName: 'System.Description', name: 'Description' },
		],
		[
			'unavailable catalog',
			{ 'Custom.Notes': '<p>Unverified content</p>' },
			503,
			'',
			{ referenceName: 'System.Description', name: 'Description' },
		],
	] as const) {
		test(`SDK lists and direct point/search reads agree on ${name} descriptions`, async () => {
			const h = harness();
			h.setDescription(fields, status);
			const options = { baseUrl: baseUrl, isPAT: true };
			const listed = await h.api.getIssuesForAzureProject(token, collection, project, {
				...options,
				states: [GitIssueState.Open, GitIssueState.Closed],
			});
			const point = await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, options);
			// As the integration's point read asks: with the collection's own identity, which the row's people carry.
			const native = await h.native.getIssue(
				azureProvider,
				token,
				{ ...azureProject, resourceName: collection },
				'42',
				{ ...options, viewer: () => Promise.resolve({ id: 'me' }) },
			);
			const search = await h.native.searchWorkItemsPage(azureProvider, token, collection, {
				baseUrl: baseUrl,
				criteria: { state: 'all' },
				projectNames: [project],
				resolveProject: () => azureProject,
			});
			assert.equal(listed.values.length, 1);
			assert.equal(listed.values[0].description, description);
			assert.deepEqual(listed.values[0].descriptionField, descriptionField);
			assert.equal(point?.description, listed.values[0].description);
			assert.deepEqual(point?.descriptionField, listed.values[0].descriptionField);
			assert.equal(native?.body, listed.values[0].description);
			assert.equal(search.values[0]?.body, listed.values[0].description);
			const bodyField = { id: descriptionField.referenceName, name: descriptionField.name };
			assert.deepEqual(native?.bodyField, bodyField);
			assert.deepEqual(search.values[0]?.bodyField, bodyField);
			assert.ok(native);
			const [cheap] = await h.api.getAzureWorkItemsEtagFields(
				token,
				{ namespace: collection, project: project },
				[42],
				options,
			);
			assert.equal(
				issueEtag(toAzureWorkItemEtagFields(cheap.workItem, project, cheap.category), []),
				issueEtag(issueEtagFieldsFromShape(native), []),
			);
			const catalogReads = h.requests.filter(r => r.url.pathname.endsWith('/wit/fields'));
			assert.equal(catalogReads.length, name === 'built-in fallback' ? 0 : 2);
		});
	}

	test('cached catalog failures remain observable while point reads keep their fallback', async () => {
		const h = harness();
		h.setDescription({ 'Custom.Notes': '<p>Unverified content</p>' }, 503);
		const logged: string[] = [];
		const originalWarn = Logger.warn;
		Logger.warn = (...params: unknown[]) => void logged.push(params.join(' '));
		try {
			for (let i = 0; i < 2; i++) {
				const issue = await h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
					baseUrl: baseUrl,
					isPAT: true,
				});
				assert.ok(issue);
				assert.notEqual(issue.description, '<p>Unverified content</p>');
			}
			assert.equal(logged.filter(message => message.includes('field catalog')).length, 2);
			assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/wit/fields')).length, 1);
		} finally {
			Logger.warn = originalWarn;
		}
	});

	test('a catalog cancellation the caller did not request keeps the work item readable', async () => {
		const h = harness();
		h.setDescription({ 'Custom.Notes': '<p>Unverified content</p>' });
		h.cancelCatalog();
		const issue = await h.native.getIssue(
			azureProvider,
			token,
			{ ...azureProject, resourceName: collection },
			'42',
			{ baseUrl: baseUrl },
		);
		assert.equal(issue?.id, '42');
		assert.notEqual(issue?.body, '<p>Unverified content</p>');
	});

	for (const invalid of ['another project', 'missing project', 'unreadable title'] as const) {
		test(`a point row with ${invalid} cannot trigger a catalog read`, async () => {
			const h = harness();
			h.setDescription({ 'Custom.Notes': '<p>Private content</p>' });
			if (invalid === 'another project') {
				h.setProject('Another project');
			} else if (invalid === 'missing project') {
				h.omitProject();
			} else {
				h.setTitle('');
			}
			await assert.rejects(
				h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, {
					baseUrl: baseUrl,
					isPAT: true,
				}),
				/has no project|not 'Payments'|no readable work item/,
			);
			assert.equal(h.requests.filter(r => r.url.pathname.endsWith('/wit/fields')).length, 0);
		});
	}

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

	for (const allMappedStates of [false, true]) {
		for (const closedDate of [undefined, '2026-10-01T00:00:00.000Z']) {
			test(`an absent legacy state refuses cached categories (all mapped: ${allMappedStates}, closed: ${closedDate != null})`, async () => {
				const h = harness(allMappedStates);
				h.setDescription(closedDate == null ? {} : { 'Microsoft.VSTS.Common.ClosedDate': closedDate });
				const options = { baseUrl: baseUrl, isPAT: true };
				const descriptor = { ...azureProject, resourceName: collection };
				assert.equal(
					(await h.native.getIssue(azureProvider, token, descriptor, '42', options))?.state,
					'opened',
				);
				h.setState('Unlisted');
				await assert.rejects(
					h.native.getIssue(azureProvider, token, descriptor, '42', options),
					/does not expose a category/,
				);
				await assert.rejects(
					h.native.getIssueOrPullRequest(azureProvider, token, collection, `${project}/_git/repo`, '42', {
						...options,
						type: 'issue',
					}),
					/does not expose a category/,
				);
				await assert.rejects(
					h.native.searchWorkItemsPage(azureProvider, token, collection, {
						baseUrl: baseUrl,
						criteria: { state: 'all' },
						projectNames: [project],
						resolveProject: () => azureProject,
					}),
					/does not expose a category/,
				);
				await assert.rejects(
					h.api.getAzureWorkItem(token, { namespace: collection, project: project }, 42, options),
					/does not expose a category/,
				);
				await assert.rejects(
					h.api.getAzureWorkItemsEtagFields(
						token,
						{ namespace: collection, project: project },
						[42],
						options,
					),
					/does not expose a category/,
				);
			});
		}
	}

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
		assert.equal(states.states.find(s => s.name === 'New')?.category, 'Proposed');
		assert.equal(states.states.find(s => s.name === 'Removed')?.category, undefined);
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
		assert.equal(states.states.find(s => s.name === 'New')?.category, 'Completed');
		assert.equal(states.states.find(s => s.name === 'Closed')?.category, 'Proposed');
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
		assert.equal(states.states[0].category, 'Proposed');
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
