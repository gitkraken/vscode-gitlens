import assert from 'node:assert/strict';
import { GitIssueState } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { AuthenticationError } from '@gitlens/git/errors.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { parseIssueTrackerPageCursor } from '../reads/cursors.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that a user-scoped Linear read asks Linear for the viewer's issues instead of draining every team.
 *
 * Linear's issue list had no assignee filter, so each team's issues were drained in full and filtered to the viewer
 * client-side: a team holding none of the user's issues still cost a full drain, once per team
 * (gitkraken/vscode-gitlens#5902). With `assignees` the viewer's issues of every team come back from one query.
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
	{ id: 'team-3', key: 'OPS', name: 'Ops', iconUrl: null },
];

/** Linear numbers an issue `<team key>-<n>`; the normalized issue carries its team only inside an optional project. */
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

type IssuesCall = { teams?: string[]; assignees?: string[]; cursor?: string };
type IssuesPage = {
	values: unknown[];
	paging?: { more: boolean; cursor?: string };
	metadata?: { completeness: 'complete' | 'partial' };
};

async function connectedLinear(issues: (call: IssuesCall) => Promise<IssuesPage>) {
	const manager = createIntegrationManager(createFakeRuntime());
	const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
	(linear as unknown as { _session: ProviderAuthenticationSession })._session = linearSession();

	const calls: IssuesCall[] = [];
	const states: (GitIssueState[] | undefined)[] = [];
	let viewerReads = 0;
	stubApi(linear, {
		getLinearOrganization: () =>
			Promise.resolve({ id: 'org-1', key: 'acme', name: 'Acme', url: 'https://linear.app/acme' }),
		getLinearTeamsForCurrentUser: () => Promise.resolve(teams),
		getLinearCurrentUser: () => {
			viewerReads++;
			return Promise.resolve({ id: viewerId, name: 'Me', displayName: 'me', email: null });
		},
		getLinearIssues: (
			_token: unknown,
			input: { teams?: string[]; assignees?: string[]; states?: GitIssueState[] },
			options?: { cursor?: string },
		) => {
			const call = { teams: input.teams, assignees: input.assignees, cursor: options?.cursor };
			calls.push(call);
			states.push(input.states);
			return issues(call);
		},
	});
	return { manager: manager, linear: linear, calls: calls, states: states, viewerReads: () => viewerReads };
}

const done = (values: unknown[]): Promise<IssuesPage> =>
	Promise.resolve({ values: values, paging: { more: false, cursor: '{}' } });

suite('Linear team issue searches', () => {
	test("reads the viewer's issues of every team in one query and splits them back by team", async () => {
		const { manager, calls } = await connectedLinear(() =>
			done([linearIssue('ENG-1'), linearIssue('OPS-7'), linearIssue('OPS-8')]),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.deepEqual(calls, [{ teams: ['team-1', 'team-2', 'team-3'], assignees: [viewerId], cursor: undefined }]);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['ENG-1', 'OPS-7', 'OPS-8']);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(result.page.truncated, undefined);

		manager.dispose();
	});

	test('splits the search back to each requested team, in request order', async () => {
		const { manager, linear } = await connectedLinear(() =>
			done([linearIssue('OPS-7'), linearIssue('ENG-1'), linearIssue('OPS-8')]),
		);
		const options = { user: 'me', userId: viewerId };

		const results = await linear.getIssuesForProjectsWithTruncationResult(
			teams.map(team => ({ project: { key: team.key, id: team.id, name: team.name }, options: options })),
		);

		assert.deepEqual(
			results.map(r => r?.value?.values.map(i => i.id)),
			[['ENG-1'], [], ['OPS-7', 'OPS-8']],
		);

		manager.dispose();
	});

	test('scopes each team read to the viewer server-side, asking for the viewer once', async () => {
		// An issue matching no requested team sends the search to per-team reads, which is where a viewer query per
		// team would show.
		const { manager, calls, viewerReads } = await connectedLinear(call =>
			call.teams?.length === 1 ? done([]) : done([linearIssue('MOVED-3')]),
		);

		await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Linear, itemsPerPage: 20 });

		assert.deepEqual(
			calls.slice(1).map(c => c.assignees),
			teams.map(() => [viewerId]),
		);
		// One for the account lookup, which the tracker cannot hand to a team, and one shared by every read after.
		assert.equal(viewerReads(), 2);

		manager.dispose();
	});

	test("drops an issue the provider returns for someone else, even though the query asks for the viewer's", async () => {
		const { manager } = await connectedLinear(() =>
			done([linearIssue('ENG-1'), linearIssue('ENG-2', 'someone-else')]),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.deepEqual(
			result.items.map(i => i.id),
			['ENG-1'],
		);

		manager.dispose();
	});

	test('reads team by team when the search reports a partial result', async () => {
		const { manager, calls } = await connectedLinear(call =>
			call.teams?.length === 1
				? done([])
				: Promise.resolve({
						values: [linearIssue('ENG-1')],
						paging: { more: false, cursor: '{}' },
						metadata: { completeness: 'partial' as const },
					}),
		);

		await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Linear, itemsPerPage: 20 });

		assert.equal(calls.length, 1 + teams.length);

		manager.dispose();
	});

	test('reads team by team when the search fails for a reason that may be one team', async () => {
		const { manager, calls } = await connectedLinear(call =>
			call.teams?.length === 1
				? done([linearIssue(`${teams.find(t => t.id === call.teams![0])!.key}-1`)])
				: Promise.reject(new Error('500: Internal Server Error')),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.equal(calls.length, 1 + teams.length);
		assert.deepEqual(result.items.map(i => i.id).sort(), ['DES-1', 'ENG-1', 'OPS-1']);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reads team by team when an issue matches no requested team', async () => {
		const { manager, calls } = await connectedLinear(call =>
			call.teams?.length === 1 ? done([]) : done([linearIssue('ENG-1'), linearIssue('MOVED-3')]),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.equal(calls.length, 1 + teams.length, 'one search, then one read per team');
		assert.deepEqual(
			calls.slice(1).map(c => c.teams),
			teams.map(t => [t.id]),
		);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('reads team by team when the search reaches its backstop', async () => {
		let page = 0;
		const { manager, calls } = await connectedLinear(call => {
			if (call.teams?.length === 1) return done([]);

			page++;
			return Promise.resolve({ values: [], paging: { more: true, cursor: `c${page}` } });
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.equal(page, 10, "one team's page budget");
		assert.equal(calls.length, 10 + teams.length);
		assert.equal(result.page.truncated, undefined, 'each team read completed on its own');

		manager.dispose();
	});

	test('fails every team at once on a rejected token, without reading them one by one', async () => {
		const { manager, calls } = await connectedLinear(() =>
			Promise.reject(
				new AuthenticationError({
					providerId: IssuesCloudHostIntegrationId.Linear,
					microHash: undefined,
					cloud: true,
					type: 'oauth',
					scopes: [],
				}),
			),
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			itemsPerPage: 20,
		});

		assert.equal(calls.length, 1);
		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings[0]?.kind, 'auth');
		assert.equal(parseIssueTrackerPageCursor(result.cursor)?.retryProjects?.length, teams.length);

		manager.dispose();
	});

	test('keeps reading every assignee team by team, with no assignee filter', async () => {
		const { manager, calls } = await connectedLinear(() => done([linearIssue('ENG-1', 'someone-else')]));

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
		});

		assert.deepEqual(
			calls.map(c => [c.teams, c.assignees]),
			teams.map(t => [[t.id], undefined]),
		);

		manager.dispose();
	});

	test('sends the requested state to the search', async () => {
		const { manager, calls, states } = await connectedLinear(() => done([]));

		for (const state of [undefined, 'open', 'closed', 'all'] as const) {
			await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				state: state,
				itemsPerPage: 20,
			});
		}

		assert.equal(calls.length, 4, 'one search per read');
		assert.deepEqual(states, [
			undefined,
			[GitIssueState.Open],
			[GitIssueState.Closed],
			[GitIssueState.Open, GitIssueState.Closed],
		]);

		manager.dispose();
	});
});
