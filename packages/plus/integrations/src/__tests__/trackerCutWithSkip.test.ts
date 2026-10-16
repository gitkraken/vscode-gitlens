import * as assert from 'node:assert/strict';
import type { CollectionMetadata } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import { IssueFilter } from '../providerFilters.js';
import type { JiraUserScope } from '../providers/utils/jiraIssueDrains.js';
import type { ProviderWarning } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Pins that a Jira tracker read cut short still says so when it also skipped an unreadable issue
 * (gitkraken/vscode-gitlens#6011). The skip fails the read and marks it truncated, so the cut's own warning is the
 * only evidence a consumer has that more than the skipped issues is missing.
 */

const resource = { key: 'site-1', id: 'site-1', name: 'Site One' };
const big = {
	key: 'BIG',
	id: '10001',
	name: 'Big project',
	resourceId: 'site-1',
	resourceName: 'Site One',
};
const broken = {
	key: 'BRK',
	id: '10002',
	name: 'Broken project',
	resourceId: 'site-1',
	resourceName: 'Site One',
};

function skipped(keys: string): CollectionMetadata {
	return {
		completeness: 'partial',
		failures: [
			{
				scope: { providerId: 'jira', resourceId: 'site-1' },
				kind: 'provider',
				message: `Skipped Jira issues that could not be read: ${keys}.`,
			},
		],
	};
}

type Page = {
	data: unknown[];
	hasMore: boolean;
	nextCursor?: string;
	metadata?: CollectionMetadata;
};

async function connectedJira(readPage: (projectKey: string, scope: JiraUserScope, cursor: string | undefined) => Page) {
	const manager = createIntegrationManager(createFakeRuntime());
	const jira = await manager.get(IssuesCloudHostIntegrationId.Jira);
	(jira as unknown as { _session: ProviderAuthenticationSession })._session = {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'atlassian.net',
	};
	(jira as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve({
			getJiraResourcesForCurrentUser: () => Promise.resolve([resource]),
			getCurrentUserForResource: () => Promise.resolve({ id: 'acc-me', name: 'Me', username: 'me' }),
			getJiraProjectsForResource: () => Promise.resolve({ values: [big, broken], paging: undefined }),
			getIssuesForProjectPaged: (
				_token: unknown,
				projectKey: string,
				_resourceId: string,
				options: JiraUserScope & { cursor?: string },
			) => Promise.resolve(readPage(projectKey, options, options.cursor)),
			getIssuesForProjectsPaged: () => Promise.resolve(undefined),
		});
	return manager;
}

/** A page of the endless project: always one more, so its drain stops at the page backstop. */
function endless(cursor: string | undefined): Page {
	return {
		data: [],
		hasMore: true,
		nextCursor: `c${Number(cursor?.slice(1) ?? 0) + 1}`,
	};
}

const unreadable = (warning: ProviderWarning) => warning.kind === 'unreadable-items';

suite('Tracker read cut short beside a skipped issue', () => {
	test('reports one project stopped at the backstop beside another that skipped an issue', async () => {
		const manager = await connectedJira((projectKey, _scope, cursor) =>
			projectKey === big.key ? endless(cursor) : { data: [], hasMore: false, metadata: skipped('BRK-7 (boom)') },
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(result.page.truncated, true);
		const skip = result.warnings.filter(unreadable);
		assert.equal(skip.length, 1);
		assert.deepEqual(skip[0].scope, { resourceId: 'site-1', projectId: 'BRK' });
		assert.deepEqual(skip[0].unreadableItems, {
			keys: ['BRK-7'],
			complete: true,
		});
		const cut = result.warnings.filter(warning => !unreadable(warning));
		assert.equal(cut.length, 1);
		assert.equal(cut[0].kind, 'other');
		// An issue left unread fails no request, so the cut keeps its recovery and the project it names.
		assert.equal(cut[0].omission?.recovery, 'narrow-scope');
		assert.deepEqual(cut[0].omission?.scope, { providerId: 'jira', resourceId: 'site-1', projectId: 'BIG' });
		assert.match(cut[0].message, /Big project/);

		manager.dispose();
	});

	test('reports a "Mine" read whose assignee search stopped at the backstop while its mention search skipped', async () => {
		const manager = await connectedJira((projectKey, scope, cursor) => {
			if (projectKey !== big.key) return { data: [], hasMore: false };
			if (scope.assigneeLogins != null) return endless(cursor);

			return { data: [], hasMore: false, metadata: skipped('BIG-3 (boom)') };
		});

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			project: big.key,
			filters: [IssueFilter.Assignee, IssueFilter.Mention],
		});

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.filter(unreadable).map(warning => warning.unreadableItems),
			[{ keys: ['BIG-3'], complete: true }],
		);
		const cut = result.warnings.filter(warning => !unreadable(warning));
		assert.equal(cut.length, 1);
		assert.equal(cut[0].kind, 'other');
		assert.equal(cut[0].omission?.recovery, 'none');
		assert.deepEqual(cut[0].omission?.scope, { providerId: 'jira', resourceId: 'site-1', projectId: 'BIG' });

		manager.dispose();
	});

	test('reports a read that only skipped issues with nothing but the skip', async () => {
		const manager = await connectedJira((projectKey, _scope, cursor) =>
			projectKey === big.key
				? cursor == null
					? {
							data: [],
							hasMore: true,
							nextCursor: 'c1',
							metadata: skipped('BIG-1 (boom), BIG-2 (boom)'),
						}
					: {
							data: [],
							hasMore: false,
							metadata: skipped('BIG-9 (boom) and 3 more'),
						}
				: { data: [], hasMore: false },
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(result.warnings.length, 1);
		assert.equal(result.warnings[0].kind, 'unreadable-items');
		assert.equal(result.warnings[0].isAuth, false);
		assert.deepEqual(result.warnings[0].unreadableItems, {
			keys: ['BIG-1', 'BIG-2', 'BIG-9'],
			complete: false,
		});

		manager.dispose();
	});

	test('a project that skipped an issue and then stopped at the backstop says both, and fails no request', async () => {
		const manager = await connectedJira((projectKey, _scope, cursor) =>
			projectKey === big.key
				? endless(cursor)
				: { ...endless(cursor), ...(cursor == null ? { metadata: skipped('BRK-1 (boom)') } : {}) },
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(warning => [
				warning.kind,
				warning.omission?.recovery,
				warning.omission?.scope?.projectId,
			]),
			[
				['unreadable-items', undefined, undefined],
				['other', 'none', 'BRK'],
				['other', 'narrow-scope', 'BIG'],
			],
		);

		manager.dispose();
	});

	test('a request that failed retracts the omissions, and the cut it reported still says so', async () => {
		const manager = await connectedJira((projectKey, _scope, cursor) =>
			projectKey === big.key ? endless(cursor) : { data: [], hasMore: true, nextCursor: 'stuck' },
		);

		const result = await manager.listIssueTrackerIssuesPage({
			providerId: IssuesCloudHostIntegrationId.Jira,
			includeAllAssignees: true,
		});

		assert.equal(result.fetchFailed, true);
		assert.equal(
			result.warnings.every(warning => warning.omission == null && warning.kind === 'other'),
			true,
		);
		assert.equal(result.warnings.filter(warning => warning.message.includes("Project 'Big project'")).length, 1);

		manager.dispose();
	});
});
