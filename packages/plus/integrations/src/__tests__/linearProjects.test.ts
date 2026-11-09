import assert from 'node:assert/strict';
import { GitIssueState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { parseIssueTrackerPageCursor } from '../reads/cursors.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * `listLinearProjects` lists the workspace's Projects
 * (Linear's own `Project` entity) apart from the teams `listProjects` returns for Linear, and
 * `listIssueTrackerIssuesPage({ linearProjects })` narrows the team-windowed issue read to them server-side.
 */

function linearSession(): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'linear.app',
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

const viewerId = 'viewer-1';
const teams = [
	{ id: 'team-1', key: 'ENG', name: 'Engineering', iconUrl: null },
	{ id: 'team-2', key: 'DES', name: 'Design', iconUrl: null },
];

function linearProject(id: string) {
	return {
		id: id,
		name: `Project ${id}`,
		description: null,
		state: 'started',
		startDate: null,
		targetDate: null,
		url: `https://linear.app/acme/project/${id}`,
	};
}

function linearIssue(identifier: string, assigneeId: string = viewerId) {
	return {
		id: `id-${identifier}`,
		number: identifier,
		title: `Issue ${identifier}`,
		url: `https://linear.app/i/${identifier}`,
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		author: { id: 'a', name: 'A', avatarUrl: null, url: null },
		assignees: [{ id: assigneeId, name: 'Me', avatarUrl: null, url: null }],
		labels: [],
	};
}

type ProjectsPage = { values: unknown[]; paging?: { more: boolean; cursor?: string } };
type IssuesCall = {
	teams?: string[];
	projects?: string[];
	assignees?: string[];
	githubSyncedCreators?: string[];
	states?: GitIssueState[];
	cursor?: string;
	sort?: string;
};
type IssuesPage = { values: unknown[]; paging?: { more: boolean; cursor?: string } };

const done = (values: unknown[]): Promise<IssuesPage> =>
	Promise.resolve({ values: values, paging: { more: false, cursor: '{}' } });

async function connectedLinear(handlers: {
	projects?: (cursor: string | undefined) => Promise<ProjectsPage>;
	issues?: (call: IssuesCall) => Promise<IssuesPage>;
}) {
	const manager = createIntegrationManager(createFakeRuntime());
	const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
	(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

	const projectCursors: (string | undefined)[] = [];
	const issueCalls: IssuesCall[] = [];
	stubApi(linear, {
		getLinearOrganization: () =>
			Promise.resolve({ id: 'org-1', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' }),
		getLinearTeamsForCurrentUser: () => Promise.resolve(teams),
		getLinearCurrentUser: () => Promise.resolve({ id: viewerId, name: 'Me', displayName: 'me', email: null }),
		getLinearProjects: (_token: unknown, options?: { cursor?: string }) => {
			projectCursors.push(options?.cursor);
			// The workspace lists the Projects the narrowing tests ask for, so a narrowed read finds them.
			return (
				handlers.projects ?? (() => Promise.resolve({ values: [linearProject('p1'), linearProject('p2')] }))
			)(options?.cursor);
		},
		getLinearIssues: (
			_token: unknown,
			input: {
				teams?: string[];
				projects?: string[];
				assignees?: string[];
				githubSyncedCreators?: string[];
				states?: GitIssueState[];
			},
			options?: { cursor?: string; sort?: string },
		) => {
			const call: IssuesCall = {
				teams: input.teams,
				projects: input.projects,
				assignees: input.assignees,
				githubSyncedCreators: input.githubSyncedCreators,
				states: input.states,
				cursor: options?.cursor,
				sort: options?.sort,
			};
			issueCalls.push(call);
			return (handlers.issues ?? (() => done([])))(call);
		},
	});
	return { manager: manager, linear: linear, projectCursors: projectCursors, issueCalls: issueCalls };
}

suite('Linear workspace Projects (listLinearProjects)', () => {
	test("drains every page of the workspace's Projects into the public shape", async () => {
		const { manager, projectCursors } = await connectedLinear({
			projects: cursor =>
				Promise.resolve(
					cursor == null
						? { values: [linearProject('p1'), linearProject('p2')], paging: { more: true, cursor: 'c1' } }
						: { values: [linearProject('p3')], paging: { more: false, cursor: '{}' } },
				),
		});

		const result = await manager.listLinearProjects();

		assert.deepEqual(projectCursors, [undefined, 'c1']);
		assert.deepEqual(result.items, [
			{
				id: 'p1',
				providerId: IssuesCloudHostIntegrationId.Linear,
				name: 'Project p1',
				state: 'started',
				url: 'https://linear.app/acme/project/p1',
			},
			{
				id: 'p2',
				providerId: IssuesCloudHostIntegrationId.Linear,
				name: 'Project p2',
				state: 'started',
				url: 'https://linear.app/acme/project/p2',
			},
			{
				id: 'p3',
				providerId: IssuesCloudHostIntegrationId.Linear,
				name: 'Project p3',
				state: 'started',
				url: 'https://linear.app/acme/project/p3',
			},
		]);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reports a workspace with no Projects as a complete, empty list', async () => {
		const { manager } = await connectedLinear({
			projects: () => Promise.resolve({ values: [], paging: { more: false, cursor: '{}' } }),
		});

		const result = await manager.listLinearProjects();

		assert.deepEqual(result.items, []);
		assert.deepEqual(result.warnings, []);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('does not list the teams listProjects returns for Linear', async () => {
		const { manager } = await connectedLinear({
			projects: () => Promise.resolve({ values: [linearProject('p1')] }),
		});

		const projects = await manager.listLinearProjects();
		const teamsAsProjects = await manager.listProjects({ providerId: IssuesCloudHostIntegrationId.Linear });

		assert.deepEqual(
			projects.items.map(p => p.id),
			['p1'],
		);
		assert.deepEqual(
			teamsAsProjects.items.map(p => p.id),
			['team-1', 'team-2'],
		);

		manager.dispose();
	});

	test("caches a complete list until the connection's discovery caches are dropped", async () => {
		const { manager, linear, projectCursors } = await connectedLinear({
			projects: () => Promise.resolve({ values: [linearProject('p1')] }),
		});

		await manager.listLinearProjects();
		await manager.listLinearProjects();
		assert.equal(projectCursors.length, 1, 'the second read is served from the cache');

		// What `forceSync` and a connection re-sync do before reading.
		linear.invalidateDiscoveryCaches();
		await manager.listLinearProjects();
		assert.equal(projectCursors.length, 2, 'a dropped cache reads the workspace again');

		manager.dispose();
	});

	test('fails the read when the first page fails, rather than reporting an empty workspace', async () => {
		const { manager } = await connectedLinear({
			projects: () => Promise.reject(new Error('500: Internal Server Error')),
		});

		const result = await manager.listLinearProjects();

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0]?.providerId, IssuesCloudHostIntegrationId.Linear);

		manager.dispose();
	});

	test('keeps the Projects read before a later page failed, reports it incomplete and does not cache it', async () => {
		const { manager, projectCursors } = await connectedLinear({
			projects: cursor =>
				cursor == null
					? Promise.resolve({ values: [linearProject('p1')], paging: { more: true, cursor: 'c1' } })
					: Promise.reject(new Error('500: Internal Server Error')),
		});

		const result = await manager.listLinearProjects();

		assert.deepEqual(
			result.items.map(p => p.id),
			['p1'],
		);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0, 'the failure is reported');

		await manager.listLinearProjects();
		assert.equal(projectCursors.length, 4, 'an incomplete list is read again, not served from the cache');

		manager.dispose();
	});

	test('shares one drain between concurrent reads on a cold cache', async () => {
		const { manager, projectCursors } = await connectedLinear({
			projects: () => Promise.resolve({ values: [linearProject('p1')] }),
		});

		const [first, second] = await Promise.all([manager.listLinearProjects(), manager.listLinearProjects()]);

		assert.equal(projectCursors.length, 1, 'the second read joins the first');
		assert.deepEqual([first.items.map(p => p.id), second.items.map(p => p.id)], [['p1'], ['p1']]);

		manager.dispose();
	});

	test('does not join a drain started before the cache was dropped', async () => {
		let release!: () => void;
		const gate = new Promise<void>(resolve => (release = resolve));
		const { manager, linear, projectCursors } = await connectedLinear({
			projects: async () => {
				if (projectCursors.length === 1) {
					await gate;
					return { values: [linearProject('old')] };
				}
				return { values: [linearProject('new')] };
			},
		});

		const before = manager.listLinearProjects();
		await new Promise(resolve => setTimeout(resolve, 0));
		linear.invalidateDiscoveryCaches();
		const after = await manager.listLinearProjects();
		release();

		assert.deepEqual(
			after.items.map(p => p.id),
			['new'],
		);
		assert.deepEqual(
			(await before).items.map(p => p.id),
			['old'],
		);
		assert.deepEqual(
			(await manager.listLinearProjects()).items.map(p => p.id),
			['new'],
			'the drain from before the drop is not cached',
		);

		manager.dispose();
	});

	test('an older fresh confirmation cannot overwrite a newer workspace list', async () => {
		let reads = 0;
		let started!: () => void;
		const firstStarted = new Promise<void>(resolve => (started = resolve));
		let release!: () => void;
		const gate = new Promise<void>(resolve => (release = resolve));
		const { manager } = await connectedLinear({
			projects: async () => {
				reads++;
				if (reads === 1) return { values: [linearProject('p1')] };
				if (reads === 2) {
					started();
					await gate;
					return { values: [linearProject('p1'), linearProject('p9')] };
				}
				return { values: [linearProject('p1'), linearProject('p9'), linearProject('p10')] };
			},
		});

		await manager.listLinearProjects();
		const older = manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: ['p9'],
		});
		await firstStarted;
		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: ['p10'],
		});
		release();
		await older;

		assert.deepEqual(
			(await manager.listLinearProjects()).items.map(project => project.id),
			['p1', 'p9', 'p10'],
		);
		assert.equal(reads, 3);
		manager.dispose();
	});

	test('fails rather than serving a prefix when a later page is cancelled', async () => {
		const { manager, projectCursors } = await connectedLinear({
			projects: cursor =>
				cursor == null
					? Promise.resolve({ values: [linearProject('p1')], paging: { more: true, cursor: 'c1' } })
					: Promise.reject(new CancellationError()),
		});

		const result = await manager.listLinearProjects();

		assert.equal(projectCursors.length, 2);
		assert.deepEqual(result.items, [], 'a cancelled read is not reported as a partial workspace');
		assert.equal(result.fetchFailed, true);

		manager.dispose();
	});

	test('reports a drain stopped at its backstop as incomplete', async () => {
		let page = 0;
		const { manager } = await connectedLinear({
			projects: () => {
				page++;
				return Promise.resolve({
					values: [linearProject(`p${page}`)],
					paging: { more: true, cursor: `c${page}` },
				});
			},
		});

		const result = await manager.listLinearProjects();

		assert.equal(page, 20, 'the backstop bounds the drain');
		assert.equal(result.items.length, 20, 'what was read is kept');
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0, 'the cut is reported');

		manager.dispose();
	});

	test('reports a connection that does not resolve as a failure, not an empty workspace', async () => {
		const { manager, projectCursors } = await connectedLinear({});

		const result = await manager.listLinearProjects({ connectionId: 'gone' });

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.ok(result.warnings.length > 0);
		assert.equal(projectCursors.length, 0, 'no request is made for a connection that is not there');

		manager.dispose();
	});
});

suite('Linear issue reads narrowed to Linear Projects (linearProjects)', () => {
	test("narrows the viewer's issues of every team to the Projects in one query", async () => {
		const { manager, issueCalls } = await connectedLinear({
			issues: () => done([linearIssue('ENG-1'), linearIssue('DES-2')]),
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: ['p2', 'p1'],
			itemsPerPage: 20,
		});

		assert.deepEqual(issueCalls, [
			{
				teams: ['team-1', 'team-2'],
				projects: ['p1', 'p2'],
				assignees: [viewerId],
				githubSyncedCreators: [viewerId],
				states: undefined,
				cursor: undefined,
				sort: 'updated:desc',
			},
		]);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['DES-2', 'ENG-1']);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('combines with a team scope', async () => {
		const { manager, issueCalls } = await connectedLinear({ issues: () => done([linearIssue('ENG-1')]) });

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: ['p1'],
		});

		assert.deepEqual(
			issueCalls.map(c => [c.teams, c.projects, c.assignees, c.githubSyncedCreators]),
			[[['team-1'], ['p1'], [viewerId], [viewerId]]],
		);
		assert.deepEqual(
			result.items.map(i => i.id),
			['ENG-1'],
		);

		manager.dispose();
	});

	test("keeps the viewer's unassigned GitHub-synced issues in a Projects-narrowed read, and only those", async () => {
		const filedOnGitHub = {
			...linearIssue('ENG-3', 'someone-else'),
			assignees: [],
			author: { id: viewerId, name: 'Me', avatarUrl: null, url: null },
			syncedWith: [{ service: 'github', id: '6063264575', owner: 'acme', repo: 'web', number: 2 }],
		};
		const unsyncedOfMine = { ...filedOnGitHub, id: 'id-ENG-4', number: 'ENG-4', syncedWith: [] };
		const { manager, issueCalls } = await connectedLinear({
			issues: () => done([linearIssue('ENG-1'), filedOnGitHub, unsyncedOfMine]),
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: ['p1'],
		});

		assert.deepEqual(
			issueCalls.map(c => [c.projects, c.assignees, c.githubSyncedCreators]),
			[[['p1'], [viewerId], [viewerId]]],
		);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['ENG-1', 'ENG-3']);

		manager.dispose();
	});

	test('combines with includeAllAssignees, searching every team together with no assignee filter', async () => {
		const { manager, issueCalls } = await connectedLinear({
			issues: () => done([linearIssue('ENG-1', 'someone-else'), linearIssue('DES-2')]),
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
			linearProjects: ['p1'],
		});

		assert.deepEqual(
			issueCalls.map(c => [c.teams, c.projects, c.assignees, c.githubSyncedCreators]),
			[[['team-1', 'team-2'], ['p1'], undefined, undefined]],
		);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['DES-2', 'ENG-1']);

		manager.dispose();
	});

	test('combines with a team scope and includeAllAssignees', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'DES',
			includeAllAssignees: true,
			linearProjects: ['p1'],
		});

		assert.deepEqual(
			issueCalls.map(c => [c.teams, c.projects, c.assignees, c.githubSyncedCreators]),
			[[['team-2'], ['p1'], undefined, undefined]],
		);

		manager.dispose();
	});

	test('sends the state and sort along with the Projects', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: ['p1'],
			state: 'all',
			sort: 'updated:asc',
		});

		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(issueCalls, [
			{
				teams: ['team-1'],
				projects: ['p1'],
				assignees: [viewerId],
				githubSyncedCreators: [viewerId],
				states: [GitIssueState.Open, GitIssueState.Closed],
				cursor: undefined,
				sort: 'updated:asc',
			},
		]);

		manager.dispose();
	});

	test('reports a narrowed team read cut by its backstop as truncated', async () => {
		let pages = 0;
		const { manager } = await connectedLinear({
			issues: () => {
				pages++;
				return Promise.resolve({
					values: [linearIssue(`ENG-${pages}`)],
					paging: { more: true, cursor: `c${pages}` },
				});
			},
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: ['p1'],
		});

		assert.equal(result.page.truncated, true);
		assert.ok(result.items.length > 0, 'what was read is kept');

		manager.dispose();
	});

	test('records the Projects in the cursor and refuses to resume it under others', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		const first = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
			linearProjects: ['p1'],
			itemsPerPage: 1,
		});
		assert.equal(first.hasMore, true);
		assert.deepEqual(parseIssueTrackerPageCursor(first.cursor)?.linearProjects, ['p1']);

		const resumed = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
			linearProjects: ['p1'],
			itemsPerPage: 1,
			cursor: first.cursor,
		});
		assert.equal(resumed.fetchFailed, undefined);
		assert.deepEqual(
			issueCalls.map(c => c.teams),
			[['team-1'], ['team-2']],
		);

		for (const linearProjects of [['p2'], undefined]) {
			const other = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				includeAllAssignees: true,
				linearProjects: linearProjects,
				itemsPerPage: 1,
				cursor: first.cursor,
			});
			assert.equal(other.fetchFailed, true);
			assert.equal(other.warnings[0]?.kind, 'other');
		}
		assert.equal(issueCalls.length, 2, 'a refused cursor reads nothing');

		manager.dispose();
	});

	test('refuses a Projects narrowing on another tracker rather than ignoring it', async () => {
		const manager = createIntegrationManager(createFakeRuntime());

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			linearProjects: ['p1'],
		});

		assert.deepEqual(result.items, []);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'unsupported');

		manager.dispose();
	});

	test('reads each team with the Projects when the search falls back team by team', async () => {
		const { manager, issueCalls } = await connectedLinear({
			issues: call =>
				call.teams?.length === 1 ? done([]) : Promise.reject(new Error('500: Internal Server Error')),
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
			linearProjects: ['p1'],
		});

		assert.equal(result.fetchFailed, undefined);
		assert.deepEqual(
			issueCalls.map(c => [c.teams, c.projects]),
			[
				[['team-1', 'team-2'], ['p1']],
				[['team-1'], ['p1']],
				[['team-2'], ['p1']],
			],
		);

		manager.dispose();
	});

	test('warns about a missing Project and still reads issues in the other selected Projects', async () => {
		const { manager, issueCalls, projectCursors } = await connectedLinear({
			issues: () => done([linearIssue('ENG-1')]),
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: ['p1', 'gone'],
		});

		assert.deepEqual(
			result.items.map(issue => issue.id),
			['ENG-1'],
		);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.cursor, undefined);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0]?.kind, 'not-found');
		assert.deepEqual(result.warnings[0]?.selector, { kind: 'linearProject', value: 'gone' });
		assert.equal(projectCursors.length, 2, 'the miss is confirmed against a list read past the cache');
		assert.deepEqual(
			issueCalls.map(call => call.projects),
			[['gone', 'p1']],
		);

		manager.dispose();
	});

	test('finds a Project created after the cached list was read', async () => {
		const { manager, issueCalls } = await connectedLinear({
			projects: (() => {
				let reads = 0;
				return () => {
					reads++;
					return Promise.resolve({
						values: reads === 1 ? [linearProject('p1')] : [linearProject('p1'), linearProject('p9')],
					});
				};
			})(),
		});

		await manager.listLinearProjects();
		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: ['p9'],
		});

		assert.deepEqual(result.warnings, []);
		assert.deepEqual(
			issueCalls.map(c => c.projects),
			[['p9']],
		);

		manager.dispose();
	});

	test('reads the Projects as asked when their list cannot be read completely', async () => {
		const { manager, issueCalls } = await connectedLinear({
			projects: () => Promise.reject(new Error('500: Internal Server Error')),
		});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: ['p1'],
		});

		assert.deepEqual(
			issueCalls.map(c => c.projects),
			[['p1']],
		);

		manager.dispose();
	});

	test('refuses a Projects value that is not a list rather than throwing or widening the read', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		for (const value of ['p1', 42, {}]) {
			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				linearProjects: value as unknown as string[],
			});
			assert.equal(result.fetchFailed, true);
			assert.equal(result.warnings[0]?.kind, 'other');
		}
		assert.equal(issueCalls.length, 0);

		manager.dispose();
	});

	test('refuses an empty Project id rather than widening the read', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			linearProjects: [''],
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(issueCalls.length, 0);

		manager.dispose();
	});

	test('narrows nothing when the list is empty', async () => {
		const { manager, issueCalls } = await connectedLinear({});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			project: 'team-1',
			linearProjects: [],
		});

		assert.deepEqual(
			issueCalls.map(c => c.projects),
			[undefined],
		);

		manager.dispose();
	});
});
