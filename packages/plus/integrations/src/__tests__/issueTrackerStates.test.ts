import * as assert from 'node:assert/strict';
import { GitIssueState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { IssueShape, IssueStateFilter } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId, IssuesSelfManagedHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { Integration } from '../models/integration.js';
import { parseIssueTrackerPageCursor, toIssueTrackerPageCursor } from '../reads/cursors.js';
import { createFakeRuntime } from './fakeRuntime.js';
import { primarySession } from './issueSortHelpers.js';
import { readProjectsOneByOne } from './projectReads.js';

/**
 * The `state` option on the issue-tracker reads (#5911): what reaches provider-apis for each value, that Linear's
 * reads narrow server-side so a drain never yields done work, and that a tracker that can't express a state refuses
 * it instead of answering with its open issues.
 */

type Manager = ReturnType<typeof createIntegrationManager>;

function session(domain: string, extra?: Partial<ProviderAuthenticationSession>): ProviderAuthenticationSession {
	return { ...primarySession('tok', domain), scopes: [], ...extra };
}

type Drain = { values: IssueShape[]; truncated: boolean };

/** Calls the protected project-scoped drain, which the integration type does not expose. */
function readProject(
	integration: Record<string, unknown>,
	s: ProviderAuthenticationSession,
	project: unknown,
	options?: unknown,
): Promise<Drain> {
	const fn = integration.getProviderIssuesForProjectWithTruncation as (...args: unknown[]) => Promise<Drain>;
	return fn.call(integration, s, project, options);
}

/** Calls the protected account-wide drain, which the integration type does not expose. */
function readAccount(
	integration: Record<string, unknown>,
	s: ProviderAuthenticationSession,
	resources: unknown,
	options?: unknown,
): Promise<Drain> {
	const fn = integration.searchProviderMyIssuesWithTruncation as (...args: unknown[]) => Promise<Drain>;
	return fn.call(integration, s, resources, undefined, options);
}

async function connected(manager: Manager, id: IssuesCloudHostIntegrationId, domain: string, extra?: object) {
	const integration = await manager.get(id);
	assert.ok(integration != null);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session(domain, extra);
	return integration as unknown as Record<string, unknown>;
}

async function withManager<T>(
	body: (manager: Manager, runtime: ReturnType<typeof createFakeRuntime>) => Promise<T>,
): Promise<T> {
	const runtime = createFakeRuntime();
	const manager = createIntegrationManager(runtime);
	try {
		return await body(manager, runtime);
	} finally {
		manager.dispose();
	}
}

const stateCases: { state: IssueStateFilter | undefined; states: GitIssueState[] | undefined }[] = [
	{ state: undefined, states: undefined },
	{ state: 'open', states: [GitIssueState.Open] },
	{ state: 'closed', states: [GitIssueState.Closed] },
	{ state: 'all', states: [GitIssueState.Open, GitIssueState.Closed] },
];

// A Linear workspace behind the real `ProvidersApi` and the real provider-apis client, so the test sees the
// GraphQL document provider-apis actually builds and the issues come back through its own normalization.

type WorkflowType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled' | 'duplicate';

interface LinearNode {
	identifier: string;
	type: WorkflowType;
	assigneeId?: string;
}

const viewer = { id: 'viewer-1', name: 'Viewer One', email: 'viewer@example.com', displayName: 'viewer' };

function toApiIssue(node: LinearNode) {
	return {
		id: `id-${node.identifier}`,
		identifier: node.identifier,
		title: node.identifier,
		url: `https://linear.app/acme/issue/${node.identifier}`,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		archivedAt: null,
		description: null,
		creator: { id: viewer.id, name: viewer.name, avatarUrl: null },
		assignee: node.assigneeId != null ? { id: node.assigneeId, name: 'Someone', avatarUrl: null } : null,
		project: null,
		team: { id: 'team-1', name: 'Team', key: 'TEAM', icon: null },
		state: { id: `state-${node.type}`, name: node.type, color: '#000', type: node.type },
		projectMilestone: null,
	};
}

/** Applies the workflow-state clause provider-apis spliced into the query, as Linear's server would. */
function filterByStateClause(query: string, nodes: LinearNode[]): LinearNode[] {
	const match = /state: \{ type: \{ (in|nin): \[([^\]]*)\] \} \}/.exec(query);
	if (match == null) return nodes;

	const types = match[2].split(',').map(t => JSON.parse(t.trim()) as string);
	return nodes.filter(n => (match[1] === 'in' ? types.includes(n.type) : !types.includes(n.type)));
}

function stubLinearServer(
	runtime: ReturnType<typeof createFakeRuntime>,
	nodes: LinearNode[],
	pageSize = 2,
): { queries: string[] } {
	const queries: string[] = [];
	runtime.http.fetch = (_url, init) => {
		const { query, variables } = JSON.parse(init!.body as string) as {
			query: string;
			variables?: { after?: string };
		};
		let data: unknown;
		if (query.includes('query GetViewer')) {
			data = { viewer: viewer };
		} else if (query.includes('query GetIssues') || query.includes('query GetMyIssues')) {
			queries.push(query);
			const matching = filterByStateClause(query, nodes);
			const start = variables?.after != null ? Number(variables.after) : 0;
			const end = start + pageSize;
			data = {
				issues: {
					nodes: matching.slice(start, end).map(toApiIssue),
					pageInfo: { hasNextPage: end < matching.length, endCursor: String(end) },
				},
			};
		} else {
			throw new Error(`unexpected Linear query: ${query}`);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ data: data }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
	};
	return { queries: queries };
}

/** Two open issues behind four done ones, so a drain that doesn't narrow reads the done work first. */
const mixedTeam: LinearNode[] = [
	{ identifier: 'TEAM-1', type: 'completed', assigneeId: viewer.id },
	{ identifier: 'TEAM-2', type: 'canceled', assigneeId: viewer.id },
	{ identifier: 'TEAM-3', type: 'completed', assigneeId: viewer.id },
	{ identifier: 'TEAM-4', type: 'canceled', assigneeId: viewer.id },
	{ identifier: 'TEAM-5', type: 'started', assigneeId: viewer.id },
	{ identifier: 'TEAM-6', type: 'backlog', assigneeId: viewer.id },
	{ identifier: 'TEAM-7', type: 'triage', assigneeId: 'someone-else' },
	// Closed as a duplicate: Linear gives it a state type of its own, which counts as closed (provider-apis 0.63.0).
	{ identifier: 'TEAM-8', type: 'duplicate', assigneeId: viewer.id },
];

const team = { id: 'team-1', key: 'TEAM', name: 'Team', resourceId: 'org-1' };

function drainTeam(
	linear: Record<string, unknown>,
	options?: { state?: IssueStateFilter; user?: string },
): Promise<Drain> {
	return readProject(linear, session('linear.app'), team, options);
}

function drainAccount(linear: Record<string, unknown>, options?: { state?: IssueStateFilter }): Promise<Drain> {
	return readAccount(linear, session('linear.app'), undefined, options);
}

const ids = (values: IssueShape[]) => values.map(v => v.id).sort();

suite('Issue tracker state selector (#5911)', () => {
	suite('Linear', () => {
		for (const { state, states } of stateCases) {
			test(`team read sends states=${JSON.stringify(states)} for state=${state ?? 'omitted'}`, () =>
				withManager(async manager => {
					const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
					const inputs: Record<string, unknown>[] = [];
					linear.getProvidersApi = () =>
						Promise.resolve({
							getLinearIssues: (_t: unknown, input: Record<string, unknown>) => {
								inputs.push(input);
								return Promise.resolve({ values: [], paging: { more: false } });
							},
						});

					await drainTeam(linear, { state: state });

					assert.deepEqual(inputs, [{ teams: ['team-1'], states: states }]);
				}));

			test(`account-wide read sends states=${JSON.stringify(states)} for state=${state ?? 'omitted'}`, () =>
				withManager(async manager => {
					const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
					const inputs: Record<string, unknown>[] = [];
					linear.getProvidersApi = () =>
						Promise.resolve({
							getIssuesForCurrentUser: (_t: unknown, input: Record<string, unknown>) => {
								inputs.push(input);
								return Promise.resolve({ values: [], paging: { more: false } });
							},
						});

					await drainAccount(linear, { state: state });

					assert.equal(inputs.length, 1);
					assert.deepEqual(inputs[0].states, states);
				}));
		}

		test('an open team drain never yields a DONE issue, even behind pages of done work', () =>
			withManager(async (manager, runtime) => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const { queries } = stubLinearServer(runtime, mixedTeam);

				for (const state of [undefined, 'open'] as const) {
					queries.length = 0;
					const result = await drainTeam(linear, { state: state, user: 'viewer' });

					assert.deepEqual(ids(result.values), ['TEAM-5', 'TEAM-6'], `state=${state ?? 'omitted'}`);
					assert.ok(result.values.every(v => v.providerState?.category !== 'DONE' && !v.closed));
					assert.equal(result.truncated, false);
					// Three open issues at two a page: two pages. Unnarrowed, the four done ones ahead of them would make it
					// four, which is the budget a team full of done work used to spend before reaching open work.
					assert.equal(queries.length, 2, 'the done issues never cost a page');
					assert.ok(
						queries.every(q =>
							q.includes('state: { type: { nin: ["completed", "canceled", "duplicate"] } }'),
						),
					);
				}
			}));

		test('closed and all team drains reach the done issues', () =>
			withManager(async (manager, runtime) => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const { queries } = stubLinearServer(runtime, mixedTeam);

				const closed = await drainTeam(linear, { state: 'closed' });
				assert.deepEqual(ids(closed.values), ['TEAM-1', 'TEAM-2', 'TEAM-3', 'TEAM-4', 'TEAM-8']);
				assert.ok(closed.values.every(v => v.providerState?.category === 'DONE' && v.closed));
				assert.match(queries.at(-1)!, /state: \{ type: \{ in: \["completed", "canceled", "duplicate"\] \} \}/);

				const all = await drainTeam(linear, { state: 'all' });
				assert.deepEqual(ids(all.values), mixedTeam.map(n => n.identifier).sort());
				assert.doesNotMatch(queries.at(-1)!, /state: \{/, "'all' sends no state clause");
			}));

		test('the viewer filter still applies on top of the state', () =>
			withManager(async (manager, runtime) => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				stubLinearServer(runtime, mixedTeam);

				const all = await drainTeam(linear, { state: 'all', user: 'viewer' });

				assert.equal(
					all.values.some(v => v.id === 'TEAM-7'),
					false,
					"another assignee's issue is dropped",
				);
				// The viewer's six done/open issues plus the one closed as a duplicate.
				assert.equal(all.values.length, 7);
			}));

		test('the account-wide drain ANDs the state with the involvement filter', () =>
			withManager(async (manager, runtime) => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const { queries } = stubLinearServer(runtime, mixedTeam);

				const open = await drainAccount(linear);
				assert.deepEqual(ids(open.values), ['TEAM-5', 'TEAM-6', 'TEAM-7']);
				assert.ok(open.values.every(v => v.providerState?.category !== 'DONE'));
				assert.match(queries[0], /\{ and: \[/);
				assert.match(queries[0], /assignee: \{ id: \{ eq: \$viewerId \} \}/);

				const all = await drainAccount(linear, { state: 'all' });
				assert.equal(all.values.length, mixedTeam.length);
				assert.doesNotMatch(queries.at(-1)!, /\{ and: \[/);
			}));
	});

	suite('Jira', () => {
		for (const { state, states } of stateCases) {
			test(`project read sends states=${JSON.stringify(states)} for state=${state ?? 'omitted'}`, () =>
				withManager(async manager => {
					const jira = await connected(manager, IssuesCloudHostIntegrationId.Jira, 'atlassian.net');
					const inputs: Record<string, unknown>[] = [];
					jira.getProvidersApi = () =>
						Promise.resolve({
							getIssuesForProjectPaged: (
								_t: unknown,
								_project: string,
								_resource: string,
								input: Record<string, unknown>,
							) => {
								inputs.push(input);
								return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
							},
						});

					await readProject(
						jira,
						session('atlassian.net'),
						{ id: 'p1', key: 'P', name: 'P', resourceId: 'site-1' },
						{ state: state, user: 'me', filters: ['assignee', 'author'] },
					);

					assert.equal(inputs.length, 2, 'one drain per filter');
					for (const input of inputs) {
						assert.deepEqual(input.states, states, 'every filter branch carries the state');
					}
				}));

			test(`account-wide read sends states=${JSON.stringify(states)} for state=${state ?? 'omitted'}`, () =>
				withManager(async manager => {
					const jira = await connected(manager, IssuesCloudHostIntegrationId.Jira, 'atlassian.net');
					const inputs: Record<string, unknown>[] = [];
					jira.getProvidersApi = () =>
						Promise.resolve({
							getIssuesForResourceForCurrentUser: (
								_t: unknown,
								_resource: string,
								input: Record<string, unknown>,
							) => {
								inputs.push(input);
								return Promise.resolve({ values: [], paging: { more: false } });
							},
						});

					const result = await readAccount(
						jira,
						session('atlassian.net'),
						[
							{ id: 'site-1', key: 's1', name: 'S1' },
							{ id: 'site-2', key: 's2', name: 'S2' },
						],
						{ state: state },
					);

					assert.equal(inputs.length, 2, 'one read per site');
					for (const input of inputs) {
						assert.deepEqual(input.states, states);
					}
					assert.equal(result.truncated, false);
				}));
		}

		test('the account-wide read sends the state JQL through provider-apis', () =>
			withManager(async (manager, runtime) => {
				const jira = await connected(manager, IssuesCloudHostIntegrationId.Jira, 'atlassian.net');
				const jqls: string[] = [];
				runtime.http.fetch = (url, init) => {
					const u = new URL(url.toString());
					const json = (body: unknown) =>
						Promise.resolve(
							new Response(JSON.stringify(body), {
								status: 200,
								headers: { 'content-type': 'application/json' },
							}),
						);
					if (u.pathname.endsWith('/accessible-resources')) {
						return json([{ id: 'site-1', name: 'acme', url: 'https://acme.atlassian.net', scopes: [] }]);
					}
					if (!u.searchParams.has('jql')) return json([]);

					jqls.push(`${init?.method ?? 'GET'} ${u.pathname} ${u.searchParams.get('jql') ?? ''}`);
					return Promise.resolve(
						new Response(JSON.stringify({ issues: [], isLast: true }), {
							status: 200,
							headers: { 'content-type': 'application/json' },
						}),
					);
				};

				const read = (state?: IssueStateFilter) =>
					readAccount(jira, session('atlassian.net'), [{ id: 'site-1', key: 's1', name: 'S1' }], {
						state: state,
					});

				await read();
				await read('closed');
				await read('all');

				assert.equal(jqls.length, 3, jqls.join('\n'));
				assert.match(jqls[0], /statusCategory != Done/);
				assert.match(jqls[1], /statusCategory = Done/);
				assert.doesNotMatch(jqls[2], /statusCategory/);
			}));
	});

	suite('Jira Data Center', () => {
		test('project and account-wide reads forward the state', () =>
			withManager(async manager => {
				const integration = await manager.get(
					IssuesSelfManagedHostIntegrationId.JiraServer,
					'jira.example.com',
				);
				assert.ok(integration != null);
				const jira = integration as unknown as Record<string, unknown>;
				(jira as unknown as { _session: ProviderAuthenticationSession })._session = session(
					'jira.example.com',
					{ cloud: false },
				);
				const projectInputs: Record<string, unknown>[] = [];
				const accountInputs: Record<string, unknown>[] = [];
				jira.getProvidersApi = () =>
					Promise.resolve({
						getJiraServerIssuesForProjectPaged: (
							_t: unknown,
							_base: string,
							_key: string,
							input: Record<string, unknown>,
						) => {
							projectInputs.push(input);
							return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
						},
						getJiraServerIssuesForCurrentUser: (
							_t: unknown,
							_base: string,
							input: Record<string, unknown>,
						) => {
							accountInputs.push(input);
							return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
						},
					});

				await readProject(
					jira,
					session('jira.example.com', { cloud: false }),
					{ id: '10000', key: 'P', name: 'P', resourceId: 'jira.example.com' },
					{ state: 'closed' },
				);
				await readAccount(jira, session('jira.example.com', { cloud: false }), undefined, { state: 'all' });

				assert.deepEqual(projectInputs[0]?.states, [GitIssueState.Closed]);
				assert.deepEqual(accountInputs[0]?.states, [GitIssueState.Open, GitIssueState.Closed]);
			}));
	});

	suite('Trello', () => {
		for (const state of ['closed', 'all'] as const) {
			test(`refuses state=${state} instead of serving the open cards`, () =>
				withManager(async manager => {
					const trello = await connected(manager, IssuesCloudHostIntegrationId.Trello, 'trello.com', {
						appKey: 'app',
					});
					let boardReads = 0;
					trello.getProvidersApi = () =>
						Promise.resolve({
							getTrelloListsForBoard: () => Promise.resolve([]),
							getTrelloIssuesForBoard: () => {
								boardReads++;
								return Promise.resolve({ values: [] });
							},
						});

					await assert.rejects(
						readProject(
							trello,
							session('trello.com', { appKey: 'app' }),
							{ id: 'b1', key: 'b1', name: 'B' },
							{
								state: state,
							},
						),
						/issue state '(closed|all)' is not supported/,
					);
					assert.equal(boardReads, 0, 'refused before any request');
				}));
		}

		for (const state of [undefined, 'open'] as const) {
			test(`reads the board for state=${state ?? 'omitted'}`, () =>
				withManager(async manager => {
					const trello = await connected(manager, IssuesCloudHostIntegrationId.Trello, 'trello.com', {
						appKey: 'app',
					});
					let boardReads = 0;
					trello.getProvidersApi = () =>
						Promise.resolve({
							getTrelloListsForBoard: () => Promise.resolve([]),
							getTrelloIssuesForBoard: () => {
								boardReads++;
								return Promise.resolve({ values: [] });
							},
						});

					await readProject(
						trello,
						session('trello.com', { appKey: 'app' }),
						{ id: 'b1', key: 'b1', name: 'B' },
						{
							state: state,
						},
					);
					assert.equal(boardReads, 1);
				}));
		}
	});

	suite('listIssueTrackerIssuesPage', () => {
		function stubTracker(integration: Record<string, unknown>) {
			const calls: Record<string, unknown>[] = [];
			// Pins what the facade hands each project; the trackers' own searches are covered in
			// `linearTeamSearches.test.ts` and `jiraProjectSearches.test.ts`.
			readProjectsOneByOne(integration as unknown as Integration);
			integration.getResourcesForUserResult = () =>
				Promise.resolve({ value: [{ id: 'org-1', key: 'org', name: 'Org' }] });
			integration.getProjectsForResourcesWithMetadataResult = () =>
				Promise.resolve({ value: { values: [{ id: 'p1', key: 'P', name: 'P', resourceId: 'org-1' }] } });
			integration.getAccountForResourceResult = () =>
				Promise.resolve({ value: { id: 'u1', name: 'Me', username: 'me' } });
			integration.getIssuesForProjectWithTruncationResult = (_p: unknown, options: Record<string, unknown>) => {
				calls.push(options);
				return Promise.resolve({ value: { values: [], truncated: false } });
			};
			return calls;
		}

		for (const providerId of [IssuesCloudHostIntegrationId.Linear, IssuesCloudHostIntegrationId.Jira]) {
			test(`forwards state to every ${providerId} project read`, () =>
				withManager(async manager => {
					const integration = await connected(manager, providerId, 'x');
					const calls = stubTracker(integration);

					for (const state of [undefined, 'open', 'closed', 'all'] as const) {
						const page = await manager.listIssueTrackerIssuesPage({ providerId: providerId, state: state });
						assert.equal(page.fetchFailed, undefined, `state=${state ?? 'omitted'}`);
						assert.deepEqual(page.warnings, []);
					}

					assert.deepEqual(
						calls.map(c => c.state),
						[undefined, 'open', 'closed', 'all'],
					);
				}));
		}

		for (const state of ['closed', 'all'] as const) {
			test(`refuses state=${state} for Trello before any request`, () =>
				withManager(async manager => {
					const trello = await connected(manager, IssuesCloudHostIntegrationId.Trello, 'trello.com', {
						appKey: 'app',
					});
					let discoveries = 0;
					trello.getResourcesForUserResult = () => {
						discoveries++;
						return Promise.resolve({ value: [] });
					};

					const page = await manager.listIssueTrackerIssuesPage({
						providerId: IssuesCloudHostIntegrationId.Trello,
						state: state,
					});

					assert.equal(page.fetchFailed, true);
					assert.deepEqual(page.items, []);
					assert.equal(page.warnings.length, 1);
					assert.match(page.warnings[0].message, /Issue state '(closed|all)' is not supported by 'trello'/);
					assert.equal(discoveries, 0, 'no discovery round trip for a refused read');
				}));
		}

		test('refuses a state outside the vocabulary instead of reading it as open', () =>
			withManager(async manager => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const calls = stubTracker(linear);

				const page = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					state: 'merged' as IssueStateFilter,
				});

				assert.equal(page.fetchFailed, true);
				assert.match(page.warnings[0]?.message ?? '', /Unknown issue state; expected one of open, closed, all/);
				assert.equal(calls.length, 0);
			}));

		test('refuses a composite cursor minted under another state', () =>
			withManager(async manager => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const calls = stubTracker(linear);
				const openCursor = toIssueTrackerPageCursor({
					currentPage: 2,
					nextPage: 2,
					retryPages: [],
					retryProjects: ['org-1:p9'],
					completedProjects: ['org-1:p1'],
				});
				const closedCursor = toIssueTrackerPageCursor({
					currentPage: 2,
					nextPage: 2,
					retryPages: [],
					retryProjects: ['org-1:p9'],
					completedProjects: ['org-1:p1'],
					state: 'closed',
				});

				const mixed = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					cursor: openCursor,
					state: 'closed',
				});
				assert.equal(mixed.fetchFailed, true);
				assert.match(mixed.warnings[0]?.message ?? '', /another issue state/);
				assert.equal(calls.length, 0);

				const reversed = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					cursor: closedCursor,
				});
				assert.equal(reversed.fetchFailed, true);

				const same = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					cursor: closedCursor,
					state: 'closed',
				});
				assert.deepEqual(same.warnings, []);
			}));

		test('a state-narrowed read mints a cursor that carries its state', () =>
			withManager(async manager => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				linear.getResourcesForUserResult = () =>
					Promise.resolve({ value: [{ id: 'org-1', key: 'org', name: 'Org' }] });
				linear.getProjectsForResourcesWithMetadataResult = () =>
					Promise.resolve({
						value: {
							values: [
								{ id: 'p1', key: 'P1', name: 'P1', resourceId: 'org-1' },
								{ id: 'p2', key: 'P2', name: 'P2', resourceId: 'org-1' },
							],
						},
					});
				linear.getIssuesForProjectWithTruncationResult = (project: { id: string }) =>
					Promise.resolve(
						project.id === 'p1'
							? { error: new Error('boom') }
							: { value: { values: [], truncated: false } },
					);

				const page = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					includeAllAssignees: true,
					state: 'all',
					itemsPerPage: 1,
				});
				const cursor = parseIssueTrackerPageCursor(page.cursor);
				assert.equal(cursor?.state, 'all', page.cursor);
			}));

		test('a forward-only narrowed read keeps its state in the cursor, and an open page cursor is refused', () =>
			withManager(async manager => {
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const calls: { id: string; state: unknown }[] = [];
				linear.getResourcesForUserResult = () =>
					Promise.resolve({ value: [{ id: 'org-1', key: 'org', name: 'Org' }] });
				linear.getProjectsForResourcesWithMetadataResult = () =>
					Promise.resolve({
						value: {
							values: [
								{ id: 'p1', key: 'P1', name: 'P1', resourceId: 'org-1' },
								{ id: 'p2', key: 'P2', name: 'P2', resourceId: 'org-1' },
							],
						},
					});
				linear.getIssuesForProjectWithTruncationResult = (
					project: { id: string },
					options: { state?: unknown },
				) => {
					calls.push({ id: project.id, state: options.state });
					return Promise.resolve({ value: { values: [], truncated: false } });
				};
				const read = (state?: IssueStateFilter, cursor?: string) =>
					manager.listIssueTrackerIssuesPage({
						providerId: IssuesCloudHostIntegrationId.Linear,
						includeAllAssignees: true,
						itemsPerPage: 1,
						state: state,
						cursor: cursor,
					});

				const closedFirst = await read('closed');
				assert.equal(closedFirst.hasMore, true);
				assert.equal(parseIssueTrackerPageCursor(closedFirst.cursor)?.state, 'closed', closedFirst.cursor);
				const closedSecond = await read('closed', closedFirst.cursor);
				assert.deepEqual(closedSecond.warnings, []);
				assert.equal(closedSecond.hasMore, false);
				assert.deepEqual(calls, [
					{ id: 'p1', state: 'closed' },
					{ id: 'p2', state: 'closed' },
				]);

				const openFirst = await read();
				assert.equal(
					parseIssueTrackerPageCursor(openFirst.cursor),
					undefined,
					'open keeps the plain page cursor',
				);
				calls.length = 0;
				const mixed = await read('closed', openFirst.cursor);
				assert.equal(mixed.fetchFailed, true);
				assert.match(mixed.warnings[0]?.message ?? '', /another issue state/);
				assert.deepEqual(calls, [], "window 1's closed issues would otherwise be skipped");
			}));

		test('direct provider reads refuse a state outside the vocabulary before any request', () =>
			withManager(async manager => {
				let requests = 0;
				const api = {
					getLinearIssues: () => {
						requests++;
						return Promise.resolve({ values: [], paging: { more: false } });
					},
					getIssuesForCurrentUser: () => {
						requests++;
						return Promise.resolve({ values: [], paging: { more: false } });
					},
					getIssuesForProjectPaged: () => {
						requests++;
						return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
					},
					getIssuesForResourceForCurrentUser: () => {
						requests++;
						return Promise.resolve({ values: [], paging: { more: false } });
					},
				};
				const linear = await connected(manager, IssuesCloudHostIntegrationId.Linear, 'linear.app');
				const jira = await connected(manager, IssuesCloudHostIntegrationId.Jira, 'atlassian.net');
				linear.getProvidersApi = () => Promise.resolve(api);
				jira.getProvidersApi = () => Promise.resolve(api);
				const bogus = { state: 'merged' };
				const site = [{ id: 'site-1', key: 's1', name: 'S1' }];

				await assert.rejects(readProject(linear, session('linear.app'), team, bogus), /Unknown issue state/);
				await assert.rejects(
					readAccount(linear, session('linear.app'), undefined, bogus),
					/Unknown issue state/,
				);
				await assert.rejects(
					readProject(
						jira,
						session('atlassian.net'),
						{ id: 'p1', key: 'P', name: 'P', resourceId: 'site-1' },
						bogus,
					),
					/Unknown issue state/,
				);
				await assert.rejects(readAccount(jira, session('atlassian.net'), site, bogus), /Unknown issue state/);
				assert.equal(requests, 0);
			}));

		test("accepts Trello's own open state", () =>
			withManager(async manager => {
				const trello = await connected(manager, IssuesCloudHostIntegrationId.Trello, 'trello.com', {
					appKey: 'app',
				});
				const calls = stubTracker(trello);

				const page = await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Trello,
					state: 'open',
				});

				assert.equal(page.fetchFailed, undefined);
				assert.equal(calls[0]?.state, 'open');
			}));
	});

	test('getSupportedFilters reports which trackers can read other states', () =>
		withManager(manager => {
			assert.equal(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Linear).issueStates, true);
			assert.equal(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Jira).issueStates, true);
			assert.equal(manager.getSupportedFilters(IssuesSelfManagedHostIntegrationId.JiraServer).issueStates, true);
			assert.equal(manager.getSupportedFilters(IssuesCloudHostIntegrationId.Trello).issueStates, false);
			return Promise.resolve();
		}));
});
