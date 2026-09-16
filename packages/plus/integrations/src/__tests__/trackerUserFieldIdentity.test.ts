import assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import { IssueFilter } from '../providerFilters.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Which identity a tracker's user-scoped project read sends, per query kind.
 *
 * Jira resolves `assignee`/`creator` against its user directory, where an accountId keeps matching an account a
 * display name no longer can — a deactivated account, or a profile whose visibility hides the name. Measured
 * against a live site: a deactivated assignee returns its issues by accountId and an empty page by display name,
 * and Jira answers that miss with a successful empty search rather than an error, so the read cannot tell the
 * difference and the list simply looks empty.
 *
 * `comment ~` (how a mention is expressed) is a free-TEXT search instead, so it must keep receiving the handle:
 * an opaque id matches no comment body at all. That asymmetry is the whole point of these tests — a change that
 * swaps the identity wholesale passes the first two and silently empties the third.
 */

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

const ACCOUNT_ID = '61b1f9dcfe9f30006820ceb3';
const DISPLAY_NAME = 'Julian Mesa';

type IssueQuery = { authorLogin?: string; assigneeLogins?: string[]; mentionLogin?: string };

/** A connected Jira whose account carries both an id and a display name, recording every query it receives. */
async function connectedJira(account: { id?: string; username?: string; name?: string }) {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = trackerSession('atlassian.net');
	const queries: IssueQuery[] = [];
	stubApi(jira, {
		getJiraResourcesForCurrentUser: () => Promise.resolve([jiraResource]),
		getCurrentUserForResource: () => Promise.resolve(account),
		getJiraProjectsForResource: () => Promise.resolve({ values: [jiraProject], paging: undefined }),
		getIssuesForProjectPaged: (_token: unknown, _project: unknown, _resourceId: unknown, options: IssueQuery) => {
			queries.push(options);
			return Promise.resolve({ data: [], hasMore: false, nextCursor: undefined });
		},
	});
	return { manager: manager, queries: queries };
}

suite('tracker user-field identity', () => {
	test('scopes the assignee field by account id rather than display name', async () => {
		const { manager, queries } = await connectedJira({
			id: ACCOUNT_ID,
			username: DISPLAY_NAME,
			name: DISPLAY_NAME,
		});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Assignee],
		});

		assert.deepEqual(
			queries.map(q => q.assigneeLogins),
			[[ACCOUNT_ID]],
		);
	});

	test('scopes the creator field by account id rather than display name', async () => {
		const { manager, queries } = await connectedJira({
			id: ACCOUNT_ID,
			username: DISPLAY_NAME,
			name: DISPLAY_NAME,
		});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Author],
		});

		assert.deepEqual(
			queries.map(q => q.authorLogin),
			[ACCOUNT_ID],
		);
	});

	test('keeps the display name for a mention, which is a free-text comment search', async () => {
		const { manager, queries } = await connectedJira({
			id: ACCOUNT_ID,
			username: DISPLAY_NAME,
			name: DISPLAY_NAME,
		});

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Mention],
		});

		// An accountId here would match no comment body at all, so this must NOT follow the two above.
		assert.deepEqual(
			queries.map(q => q.mentionLogin),
			[DISPLAY_NAME],
		);
	});

	test('falls back to the handle when the account carries no id', async () => {
		const { manager, queries } = await connectedJira({ username: DISPLAY_NAME, name: DISPLAY_NAME });

		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Assignee],
		});

		// A provider that resolves no id still has to scope the read; widening it to every assignee would leak
		// other people's issues, which is worse than a handle that may not match.
		assert.deepEqual(
			queries.map(q => q.assigneeLogins),
			[[DISPLAY_NAME]],
		);
	});

	test('falls back to the handle when the account reports an empty id', async () => {
		const { manager, queries } = await connectedJira({
			id: '',
			username: DISPLAY_NAME,
			name: DISPLAY_NAME,
		});

		// `id` is declared as a plain string, so a provider with nothing to report sets `''` rather than omitting
		// it — which would otherwise reach the query as an empty identity and match nothing.
		await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			filters: [IssueFilter.Assignee],
		});

		assert.deepEqual(
			queries.map(q => q.assigneeLogins),
			[[DISPLAY_NAME]],
		);
	});
});
