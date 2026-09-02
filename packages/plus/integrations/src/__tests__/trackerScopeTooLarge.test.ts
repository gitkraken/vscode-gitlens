import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderPagedResult, ProviderWarningOmissionRecovery } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

function trackerSession(domain: string): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: domain,
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

const jiraResource = { key: 'org-1', id: 'org-1', name: 'Org One' };
const jiraProject = {
	key: 'p1',
	id: 'p1',
	name: 'Project One',
	resourceId: 'org-1',
	resourceName: 'Org One',
};

async function connectedJira(mode: 'endless' | 'stall') {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
	let page = 0;
	stubApi(jira, {
		getJiraResourcesForCurrentUser: () => Promise.resolve([jiraResource]),
		getCurrentUserForResource: () => Promise.resolve({ id: 'me', name: 'Me', username: 'me' }),
		getJiraProjectsForResource: () => Promise.resolve({ values: [jiraProject], paging: undefined }),
		getIssuesForProjectPaged: () => {
			page++;
			return Promise.resolve({
				data: [],
				hasMore: true,
				nextCursor: mode === 'endless' ? `c${page}` : 'stuck',
			});
		},
	});
	return { manager: manager, jira: jira };
}

const linearResource = { key: 'workspace-1', id: 'workspace-1', name: 'Workspace One' };
const linearProject = { key: 'TEAM', id: 'team-1', name: 'Team One', iconUrl: null };

async function connectedLinear(mode: 'endless' | 'stall' | 'provider-truncated') {
	const manager = createIntegrationManager(createFakeRuntime());
	const linear = await manager.get(IssuesCloudHostIntegrationId.Linear);
	(linear as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('linear.app');
	let page = 0;
	stubApi(linear, {
		getLinearOrganization: () => Promise.resolve(linearResource),
		getLinearTeamsForCurrentUser: () => Promise.resolve([linearProject]),
		getLinearIssues: () => {
			page++;
			const paging =
				mode === 'endless'
					? { more: true, cursor: `c${page}` }
					: mode === 'stall'
						? { more: true, cursor: 'stuck' }
						: { more: false, cursor: '{}', truncated: true };
			return Promise.resolve({
				values: [],
				paging: paging,
				...(mode === 'provider-truncated' ? { metadata: { completeness: 'partial' as const } } : {}),
			});
		},
	});
	return { manager: manager, linear: linear };
}

function omissionRecovery(result: ProviderPagedResult<IssueShape>): ProviderWarningOmissionRecovery | undefined {
	return result.warnings.find(warning => warning.omission != null)?.omission?.recovery;
}

suite('Tracker project truncation recovery', () => {
	test('reports narrow-scope for an unscoped Jira query stopped by the page backstop', async () => {
		const { manager, jira } = await connectedJira('endless');

		const drain = await jira.getIssuesForProjectWithTruncationResult(jiraProject);
		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(drain?.value?.truncated, true);
		assert.equal(drain?.value?.recovery, 'narrow-scope');
		assert.equal(result.page.truncated, true);
		assert.equal(result.fetchFailed, undefined);
		assert.equal(omissionRecovery(result), 'narrow-scope');
		assert.match(result.warnings.find(warning => warning.omission != null)?.message ?? '', /narrow the scope/i);

		manager.dispose();
	});

	test('does not claim narrow-scope for an already user-scoped Jira query', async () => {
		const { manager, jira } = await connectedJira('endless');

		const drain = await jira.getIssuesForProjectWithTruncationResult(jiraProject, { user: 'me' });
		const result = await manager.listIssueTrackerIssuesPage({ providerId: IssuesCloudHostIntegrationId.Jira });

		assert.equal(drain?.value?.truncated, true);
		assert.equal(drain?.value?.recovery, 'none');
		assert.equal(omissionRecovery(result), 'none');

		manager.dispose();
	});

	test('does not claim narrow-scope for a stalled Jira cursor', async () => {
		const { manager, jira } = await connectedJira('stall');

		const drain = await jira.getIssuesForProjectWithTruncationResult(jiraProject);
		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(drain?.value?.truncated, true);
		assert.equal(drain?.value?.recovery, 'none');
		assert.notEqual(omissionRecovery(result), 'narrow-scope');

		manager.dispose();
	});

	test('deduplicates the recovery warning across oversized Jira projects', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
		const secondProject = { ...jiraProject, key: 'p2', id: 'p2', name: 'Project Two' };
		let page = 0;
		stubApi(jira, {
			getJiraResourcesForCurrentUser: () => Promise.resolve([jiraResource]),
			getJiraProjectsForResource: () =>
				Promise.resolve({ values: [jiraProject, secondProject], paging: undefined }),
			getIssuesForProjectPaged: () => {
				page++;
				return Promise.resolve({ data: [], hasMore: true, nextCursor: `c${page}` });
			},
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.warnings.filter(warning => warning.omission?.recovery === 'narrow-scope').length, 1);
		assert.equal(result.fetchFailed, undefined);

		manager.dispose();
	});

	test('keeps Linear backstop and stalled-cursor recovery conservative', async () => {
		for (const mode of ['endless', 'stall'] as const) {
			const { manager, linear } = await connectedLinear(mode);
			const drain = await linear.getIssuesForProjectWithTruncationResult(linearProject);
			const result = await manager.listIssueTrackerIssuesPage({
				providerId: IssuesCloudHostIntegrationId.Linear,
				includeAllAssignees: true,
			});

			assert.equal(drain?.value?.truncated, true);
			assert.equal(drain?.value?.recovery, 'none');
			assert.equal(omissionRecovery(result), 'none');

			manager.dispose();
		}
	});

	test('propagates Linear provider truncation without duplicating its warning', async () => {
		const { manager, linear } = await connectedLinear('provider-truncated');
		const drain = await linear.getIssuesForProjectWithTruncationResult(linearProject);
		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Linear,
			includeAllAssignees: true,
		});

		assert.equal(drain?.value?.truncated, true);
		assert.equal(drain?.value?.metadata?.completeness, 'partial');
		assert.equal(result.page.truncated, true);
		assert.equal(omissionRecovery(result), 'none');
		assert.equal(result.warnings.length, 1);

		manager.dispose();
	});

	test("keeps Trello's provider-native cap distinct from narrow-scope", async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = {
			...trackerSession('trello.com'),
			appKey: 'my-app-key',
		};
		const board = { key: 'b1', id: 'b1', name: 'Board One' };
		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([]),
			getTrelloIssuesForBoard: () =>
				Promise.resolve({ values: [], metadata: { completeness: 'partial', omissions: [] } }),
		});

		const drain = await trello.getIssuesForProjectWithTruncationResult(board);

		assert.equal(drain?.value?.truncated, true);
		assert.equal(drain?.value?.recovery, 'none');

		manager.dispose();
	});

	test('removes omission recovery when another project fails', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
		(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
		const failedProject = { ...jiraProject, key: 'p2', id: 'p2', name: 'Project Two' };
		let page = 0;
		stubApi(jira, {
			getJiraResourcesForCurrentUser: () => Promise.resolve([jiraResource]),
			getJiraProjectsForResource: () =>
				Promise.resolve({ values: [jiraProject, failedProject], paging: undefined }),
			getIssuesForProjectPaged: (_token: unknown, name: string) => {
				if (name === failedProject.name) return Promise.reject(new Error('upstream exploded'));

				page++;
				return Promise.resolve({ data: [], hasMore: true, nextCursor: `c${page}` });
			},
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(
			result.warnings.every(warning => warning.omission == null),
			true,
		);

		manager.dispose();
	});
});
