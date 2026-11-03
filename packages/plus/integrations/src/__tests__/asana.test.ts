import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import { fromDisposables } from '@gitlens/utils/disposable.js';
import { Emitter } from '@gitlens/utils/event.js';
import { CloudIntegrationService } from '../authentication/cloudIntegrationService.js';
import { ConfiguredIntegrationService } from '../authentication/configuredIntegrationService.js';
import { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { IntegrationReadUnavailableError } from '../errors.js';
import type { IntegrationConnectionChangeEvent } from '../integrationService.js';
import { createIntegrationService, IntegrationService } from '../integrationService.js';
import { AsanaIntegration } from '../providers/asana.js';
import type { ProviderApiPagedResult, ProviderIssue } from '../providers/models.js';
import { ProvidersApi } from '../providers/providersApi.js';
import {
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
} from '../providers/utils.js';
import { selectorMatches } from '../reads/hierarchy.utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

const workspace = { key: 'w1', id: 'w1', name: 'Workspace' };
const project = { key: 'p1', id: 'p1', name: 'Project', resourceId: 'w1', resourceName: 'Workspace' };

function asanaSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'app.asana.com',
	};
}

class TestAsanaIntegration extends AsanaIntegration {
	protected override _session = asanaSession();
}

function createAsana(api: Partial<Pick<ProvidersApi, Extract<keyof ProvidersApi, `getAsana${string}`>>>) {
	const runtime = createFakeRuntime();
	const configured = new ConfiguredIntegrationService(runtime);
	const cloud = new CloudIntegrationService(runtime);
	let service: IntegrationService;
	const auth = new IntegrationAuthenticationService(configured, runtime, () => service, cloud);
	service = new IntegrationService(auth, configured, runtime);
	const providersApi = Object.assign(new ProvidersApi(auth), api);
	const connectionChange = new Emitter<IntegrationConnectionChangeEvent>();
	const asana = new TestAsanaIntegration(runtime, auth, () => Promise.resolve(providersApi), connectionChange);
	return {
		disposable: fromDisposables(asana, providersApi, connectionChange, service, auth, configured),
		asana: asana,
	};
}

function page<T>(values: NonNullable<T>[], cursor?: string): ProviderApiPagedResult<T> {
	return {
		values: values,
		paging: cursor != null ? { cursor: cursor, more: true } : { cursor: '{}', more: false },
	};
}

function fakeAssignee(id: string): ProviderIssue['assignees'][number] {
	return { id: id, name: null, username: null, email: null, avatarUrl: null, url: null };
}

function fakeTask(overrides?: Partial<ProviderIssue>): ProviderIssue {
	return {
		id: '1201',
		number: '1201',
		title: 'Task',
		url: 'https://app.asana.com/0/p1/1201',
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		description: null,
		author: null,
		assignees: [],
		labels: [],
		repository: null,
		project: { namespace: null, resourceId: null, name: 'Project', key: null, id: 'p1' },
		state: null,
		type: 'default_task',
		commentCount: null,
		upvoteCount: null,
		workspaceId: 'w1',
		...overrides,
	};
}

suite('Asana integration', () => {
	test('gid selectors exclude numeric names and never resolve a removed gid by name', () => {
		const resources = [
			{ key: '1202', id: '1202', name: 'Roadmap' },
			{ key: '1203', id: '1203', name: '1202' },
			{ key: '1204', id: '1204', name: '1205' },
		];
		const selectedIds = (gid: string) =>
			resources
				.filter(resource => selectorMatches(IssuesCloudHostIntegrationId.Asana, resource, gid))
				.map(resource => resource.id);

		assert.deepEqual(selectedIds('1202'), ['1202']);
		assert.deepEqual(selectedIds('1205'), []);
	});

	test('the manager creates the Asana integration', async () => {
		const manager = createIntegrationService(createFakeRuntime());
		assert.ok((await manager.get(IssuesCloudHostIntegrationId.Asana)) instanceof AsanaIntegration);
		manager.dispose();
	});

	test('getResourcesForUser drains the workspaces across pages', async () => {
		const cursors: (string | undefined)[] = [];
		const { disposable, asana } = createAsana({
			getAsanaWorkspacesForCurrentUser: (_t: unknown, options?: { cursor?: string }) => {
				cursors.push(options?.cursor);
				return Promise.resolve(
					options?.cursor == null
						? page([{ id: 'w1', name: 'Workspace', isOrganization: true }], 'next')
						: page([{ id: 'w2', name: 'Other', isOrganization: false }]),
				);
			},
		});

		const resources = await asana.getResourcesForUser();
		assert.deepEqual(resources, [
			{ key: 'w1', id: 'w1', name: 'Workspace' },
			{ key: 'w2', id: 'w2', name: 'Other' },
		]);
		assert.deepEqual(cursors, [undefined, 'next']);

		disposable.dispose();
	});

	test("getProjectsForResources names each project's workspace", async () => {
		const workspaceIds: string[] = [];
		const { disposable, asana } = createAsana({
			getAsanaProjectsForWorkspace: (_t: unknown, workspaceId: string) => {
				workspaceIds.push(workspaceId);
				return Promise.resolve(
					page([{ id: 'p1', name: 'Project', archived: false, color: null, url: null, workspaceId: 'w1' }]),
				);
			},
		});

		const result = await asana.getProjectsForResourcesWithMetadataResult([workspace]);
		assert.deepEqual(result?.value?.values, [project]);
		assert.equal(result?.value?.metadata, undefined, 'a complete drain reports no incompleteness');
		assert.deepEqual(workspaceIds, ['w1']);

		disposable.dispose();
	});

	test('getIssuesForProject reads the project and attributes its tasks to the project and workspace', async () => {
		let captured: { projectId: string; states: unknown } | undefined;
		const { disposable, asana } = createAsana({
			getAsanaIssuesForProject: (_t: unknown, projectId: string, options?: { states?: unknown }) => {
				captured = { projectId: projectId, states: options?.states };
				return Promise.resolve(page([fakeTask()]));
			},
		});

		const issues = await asana.getIssuesForProject(project, { state: 'closed' });
		assert.equal(issues?.length, 1);
		assert.deepEqual(captured, { projectId: 'p1', states: ['CLOSED'] });
		assert.deepEqual(issues?.[0]?.project, {
			id: 'p1',
			name: 'Project',
			resourceId: 'w1',
			resourceName: 'Workspace',
		});

		disposable.dispose();
	});

	test("a user-scoped project read keeps only the viewer's tasks", async () => {
		const { disposable, asana } = createAsana({
			getAsanaIssuesForProject: () =>
				Promise.resolve(
					page([
						fakeTask({
							id: 'mine',
							number: 'mine',
							assignees: [fakeAssignee('u1')],
						}),
						fakeTask({
							id: 'theirs',
							number: 'theirs',
							assignees: [fakeAssignee('u2')],
						}),
						fakeTask({ id: 'nobody', number: 'nobody' }),
					]),
				),
		});

		const issues = await asana.getIssuesForProject(project, { user: 'Me', userId: 'u1' });
		assert.deepEqual(
			issues?.map(i => i.id),
			['mine'],
		);

		disposable.dispose();
	});

	test("user-scoped reads of a workspace's projects share one read of the viewer's tasks", async () => {
		const otherProject = { ...project, key: 'p2', id: 'p2', name: 'Other project' };
		const projectReads: string[] = [];
		const workspaceReads: string[] = [];
		const { disposable, asana } = createAsana({
			getAsanaIssuesForProject: (_t: unknown, projectId: string) => {
				projectReads.push(projectId);
				return Promise.resolve(page([]));
			},
			getAsanaIssuesForCurrentUser: (_t: unknown, workspaceId: string) => {
				workspaceReads.push(workspaceId);
				return Promise.resolve(
					page([
						fakeTask({ id: 'a', number: 'a' }),
						fakeTask({
							id: 'b',
							number: 'b',
							project: { namespace: null, resourceId: null, name: 'Other project', key: null, id: 'p2' },
						}),
						// Outside the read: a project it didn't ask for, and a task in no project. Asana reports only a
						// task's first project, so this is left out even if the task is also in p1 or p2 (documented).
						fakeTask({
							id: 'c',
							number: 'c',
							project: { namespace: null, resourceId: null, name: 'Archived', key: null, id: 'p9' },
						}),
						fakeTask({ id: 'd', number: 'd', project: undefined }),
					]),
				);
			},
		});

		const options = { user: 'Me', userId: 'u1' };
		const results = await asana.getIssuesForProjectsWithTruncationResult([
			{ project: project, options: options },
			{ project: otherProject, options: options },
		]);

		assert.deepEqual(workspaceReads, ['w1']);
		assert.deepEqual(projectReads, [], 'no project is drained on its own');
		assert.deepEqual(
			results.map(r => r?.value?.values.map(i => `${i.id}@${i.project?.id}`)),
			[['a@p1'], ['b@p2']],
		);

		disposable.dispose();
	});

	test("a workspace read that can't finish falls back to each project's own read, filtered to the viewer", async () => {
		const otherProject = { ...project, key: 'p2', id: 'p2', name: 'Other project' };
		let workspacePages = 0;
		const projectReads: string[] = [];
		const { disposable, asana } = createAsana({
			// Never runs out of pages, so the shared read stops at its backstop and is discarded.
			getAsanaIssuesForCurrentUser: () => {
				workspacePages++;
				return Promise.resolve(page([fakeTask()], `w${workspacePages}`));
			},
			getAsanaIssuesForProject: (_t: unknown, projectId: string, options?: { cursor?: string }) => {
				projectReads.push(projectId);
				const mine = fakeTask({
					id: `${projectId}-mine`,
					number: `${projectId}-mine`,
					assignees: [fakeAssignee('u1')],
				});
				const theirs = fakeTask({
					id: `${projectId}-theirs`,
					number: `${projectId}-theirs`,
					assignees: [fakeAssignee('u2')],
				});
				// p2 is busy enough to reach its own backstop.
				return Promise.resolve(
					projectId === 'p2' ? page([mine, theirs], `${options?.cursor ?? ''}+`) : page([mine, theirs]),
				);
			},
		});

		const options = { user: 'Me', userId: 'u1' };
		const results = await asana.getIssuesForProjectsWithTruncationResult([
			{ project: project, options: options },
			{ project: otherProject, options: options },
		]);

		assert.ok(workspacePages > 1, 'the shared read was attempted');
		assert.deepEqual([...new Set(projectReads)], ['p1', 'p2']);
		assert.deepEqual(
			results.map(r => [...new Set(r?.value?.values.map(i => `${i.id}@${i.project?.id}`))]),
			[['p1-mine@p1'], ['p2-mine@p2']],
		);
		assert.equal(results[0]?.value?.truncated, false);
		assert.equal(results[1]?.value?.truncated, true);
		assert.ok(results[1]?.value?.truncated);
		assert.equal(results[1].value.recovery, 'none');

		disposable.dispose();
	});

	test("a user-scoped read refuses to run when the viewer can't be resolved", async () => {
		let projectReads = 0;
		const { disposable, asana } = createAsana({
			getAsanaCurrentUser: () => Promise.resolve(undefined),
			getAsanaIssuesForProject: () => {
				projectReads++;
				return Promise.resolve(page([fakeTask()]));
			},
		});

		const result = await asana.getIssuesForProjectWithTruncationResult(project, { user: 'Me' });
		assert.ok(result?.error instanceof IntegrationReadUnavailableError, String(result?.error));
		assert.equal(projectReads, 0, "no one's tasks are read");

		disposable.dispose();
	});

	test('project discovery keeps the other workspaces and names the one that failed or was capped', async () => {
		const { disposable, asana } = createAsana({
			getAsanaProjectsForWorkspace: (_t: unknown, workspaceId: string, options?: { cursor?: string }) => {
				switch (workspaceId) {
					case 'w1':
						return Promise.reject(new Error('boom'));
					case 'w2': {
						// Never runs out of pages.
						const n = Number(options?.cursor ?? '0');
						return Promise.resolve(
							page(
								[
									{
										id: `p${n}`,
										name: `P${n}`,
										archived: false,
										color: null,
										url: null,
										workspaceId: 'w2',
									},
								],
								String(n + 1),
							),
						);
					}
					default:
						return Promise.resolve(
							page([
								{ id: 'p3', name: 'P3', archived: false, color: null, url: null, workspaceId: 'w3' },
							]),
						);
				}
			},
		});

		const result = await asana.getProjectsForResourcesWithMetadataResult([
			{ key: 'w1', id: 'w1', name: 'Failing' },
			{ key: 'w2', id: 'w2', name: 'Huge' },
			{ key: 'w3', id: 'w3', name: 'Fine' },
		]);
		const value = result?.value;
		assert.equal(
			value?.values.filter(p => p.resourceId === 'w2').length,
			20,
			"the capped workspace's prefix is kept",
		);
		assert.ok(
			value?.values.some(p => p.id === 'p3'),
			'the readable workspace is kept',
		);
		assert.equal(value?.metadata?.completeness, 'partial');
		assert.deepEqual(
			value?.metadata?.failures?.map(f => f.scope?.resourceId),
			['w1'],
		);
		assert.deepEqual(value?.metadata?.omissions, [
			{ kind: 'pagination-incomplete', scope: { providerId: 'asana', resourceId: 'w2' } },
		]);

		disposable.dispose();
	});

	test('a project drain that hits its page backstop is reported as truncated', async () => {
		let calls = 0;
		const { disposable, asana } = createAsana({
			getAsanaIssuesForProject: () => {
				calls++;
				return Promise.resolve(page([fakeTask({ id: `t${calls}`, number: `t${calls}` })], `c${calls}`));
			},
		});

		const result = await asana.getIssuesForProjectWithTruncationResult(project);
		assert.equal(result?.value?.truncated, true);
		assert.equal(result?.value?.values.length, calls);

		disposable.dispose();
	});

	test('searchMyIssues reads the assigned tasks of every workspace', async () => {
		const workspaceIds: string[] = [];
		const { disposable, asana } = createAsana({
			getAsanaWorkspacesForCurrentUser: () =>
				Promise.resolve(
					page([
						{ id: 'w1', name: 'Workspace', isOrganization: true },
						{ id: 'w2', name: 'Other', isOrganization: false },
					]),
				),
			getAsanaIssuesForCurrentUser: (_t: unknown, workspaceId: string) => {
				workspaceIds.push(workspaceId);
				return Promise.resolve(
					workspaceId === 'w1'
						? page([fakeTask()])
						: // A task in no project, only in the user's My Tasks.
							page([fakeTask({ id: '2201', number: '2201', project: undefined, workspaceId: 'w2' })]),
				);
			},
		});

		const result = await asana.searchMyIssuesWithTruncationResult();
		assert.deepEqual(workspaceIds, ['w1', 'w2']);
		assert.equal(result?.value?.truncated, false);
		assert.deepEqual(
			result?.value?.values.map(i => i.project),
			[
				{ id: 'p1', name: 'Project', resourceId: 'w1', resourceName: 'Workspace' },
				{ id: 'w2', name: 'Other', resourceId: 'w2', resourceName: 'Other' },
			],
		);

		disposable.dispose();
	});

	test("searchMyIssues keeps the workspaces it could read and names the one it couldn't", async () => {
		const { disposable, asana } = createAsana({
			getAsanaIssuesForCurrentUser: (_t: unknown, workspaceId: string) =>
				workspaceId === 'w1'
					? Promise.reject(new Error('boom'))
					: Promise.resolve(page([fakeTask({ id: '2201', number: '2201', workspaceId: 'w2' })])),
		});

		const result = await asana.searchMyIssuesWithTruncationResult([
			{ key: 'w1', id: 'w1', name: 'Failing' },
			{ key: 'w2', id: 'w2', name: 'Other' },
		]);
		assert.equal(result?.error, undefined);
		assert.deepEqual(
			result?.value?.values.map(i => i.id),
			['2201'],
		);
		assert.equal(result?.value?.truncated, true);
		assert.equal(result?.value?.metadata?.completeness, 'partial');
		assert.deepEqual(
			result?.value?.metadata?.failures?.map(f => f.scope?.resourceId),
			['w1'],
		);

		disposable.dispose();
	});

	test('searchMyIssues fails when no workspace could be read', async () => {
		const { disposable, asana } = createAsana({
			getAsanaIssuesForCurrentUser: () => Promise.reject(new Error('boom')),
		});

		const result = await asana.searchMyIssuesWithTruncationResult([
			{ key: 'w1', id: 'w1', name: 'Workspace' },
			{ key: 'w2', id: 'w2', name: 'Other' },
		]);
		assert.equal(result?.value, undefined);
		assert.ok(result?.error != null, 'an empty list would read as nothing assigned');

		disposable.dispose();
	});

	test('Asana issues round-trip through branch association metadata', async () => {
		let requestedTaskId: string | undefined;
		const { disposable, asana } = createAsana({
			getAsanaIssuesForProject: () => Promise.resolve(page([fakeTask()])),
			getAsanaIssue: (_t: unknown, taskId: string) => {
				requestedTaskId = taskId;
				return Promise.resolve(fakeTask());
			},
		});

		const issue = (await asana.getIssuesForProject(project))?.[0];
		if (issue == null) throw new Error('Expected an Asana issue');

		const owner = getIssueOwner(issue);
		if (owner == null) throw new Error('Expected an Asana owner descriptor');

		const identifier = encodeIssueOrPullRequestForGitConfig({ ...issue, type: 'issue' } satisfies Issue, owner);
		assert.equal(identifier.provider, 'asana');

		const resolved = await getIssueFromGitConfigEntityIdentifier(
			id => Promise.resolve(id === IssuesCloudHostIntegrationId.Asana ? asana : undefined),
			identifier,
		);
		assert.equal(requestedTaskId, '1201');
		assert.equal(resolved?.id, '1201');
		assert.deepEqual(resolved?.project, {
			id: 'p1',
			name: 'Project',
			resourceId: 'w1',
			resourceName: 'Workspace',
		});

		disposable.dispose();
	});
});
