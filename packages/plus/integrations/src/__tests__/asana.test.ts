import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { ProviderApiPagedResult, ProviderIssue } from '../providers/models.js';
import {
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
} from '../providers/utils.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the Asana integration: workspaces surface as resources and their projects as projects, task reads are
 * drained by cursor and scoped to the viewer by assignee, and tasks round-trip through branch associations keyed by
 * their workspace.
 */

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

async function createAsana(api: Record<string, unknown>) {
	const manager = createIntegrationManager(createFakeRuntime());
	const asana = await manager.get(IssuesCloudHostIntegrationId.Asana);
	(asana as unknown as { _session: ProviderAuthenticationSession })._session = asanaSession();
	(asana as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () => Promise.resolve(api);
	return { manager: manager, asana: asana };
}

function page<T>(values: T[], cursor?: string): ProviderApiPagedResult<T> {
	return {
		values: values as NonNullable<T>[],
		paging: cursor != null ? { cursor: cursor, more: true } : { cursor: '{}', more: false },
	};
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
	test('getResourcesForUser drains the workspaces across pages', async () => {
		const cursors: (string | undefined)[] = [];
		const { manager, asana } = await createAsana({
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

		manager.dispose();
	});

	test("getProjectsForResources names each project's workspace", async () => {
		const workspaceIds: string[] = [];
		const { manager, asana } = await createAsana({
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

		manager.dispose();
	});

	test('getIssuesForProject reads the project and attributes its tasks to the project and workspace', async () => {
		let captured: { projectId: string; states: unknown } | undefined;
		const { manager, asana } = await createAsana({
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

		manager.dispose();
	});

	test("a user-scoped project read keeps only the viewer's tasks", async () => {
		const { manager, asana } = await createAsana({
			getAsanaIssuesForProject: () =>
				Promise.resolve(
					page([
						fakeTask({
							id: 'mine',
							number: 'mine',
							assignees: [{ id: 'u1' }] as ProviderIssue['assignees'],
						}),
						fakeTask({
							id: 'theirs',
							number: 'theirs',
							assignees: [{ id: 'u2' }] as ProviderIssue['assignees'],
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

		manager.dispose();
	});

	test('a project drain that hits its page backstop is reported as truncated', async () => {
		let calls = 0;
		const { manager, asana } = await createAsana({
			getAsanaIssuesForProject: () => {
				calls++;
				return Promise.resolve(page([fakeTask({ id: `t${calls}`, number: `t${calls}` })], `c${calls}`));
			},
		});

		const result = await asana.getIssuesForProjectWithTruncationResult(project);
		assert.equal(result?.value?.truncated, true);
		assert.equal(result?.value?.values.length, calls);

		manager.dispose();
	});

	test('searchMyIssues reads the assigned tasks of every workspace', async () => {
		const workspaceIds: string[] = [];
		const { manager, asana } = await createAsana({
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

		manager.dispose();
	});

	test('Asana issues round-trip through branch association metadata', async () => {
		let requestedTaskId: string | undefined;
		const { manager, asana } = await createAsana({
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

		manager.dispose();
	});
});
