import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderAuthenticationSession } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationManager } from '../index.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderIssue } from '../providers/models.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * Verifies the real Trello integration (#5438): boards surface as resources, issues map from the
 * Trello board read, and the appKey from the cloud session is threaded to the client alongside the token.
 */

function trelloSession(appKey: string | undefined): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: 'trello.com',
		appKey: appKey,
	};
}

function stubApi(integration: IssuesIntegration, api: Record<string, unknown>): void {
	(integration as unknown as { getProvidersApi: () => Promise<unknown> }).getProvidersApi = () =>
		Promise.resolve(api);
}

function fakeIssue(): ProviderIssue {
	return {
		id: '1',
		number: '1',
		title: 'Card',
		url: 'https://trello.com/c/1',
		createdDate: new Date(0),
		updatedDate: new Date(0),
		closedDate: null,
		// The Trello SDK maps every card with `author: null` (cards have no creator field), so the test must
		// use the real shape — a non-null author here would mask toIssueShape dropping null-author cards.
		author: null,
		assignees: [],
		labels: [],
	} as unknown as ProviderIssue;
}

suite('Trello integration (#5438)', () => {
	test('getResourcesForUser maps boards to resource descriptors, threading the appKey', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		let capturedAppKey: string | undefined;
		stubApi(trello, {
			getTrelloBoardsForCurrentUser: (_t: unknown, appKey: string) => {
				capturedAppKey = appKey;
				return Promise.resolve([{ id: 'b1', name: 'Board 1' }]);
			},
		});

		const resources = await trello.getResourcesForUser();
		assert.deepEqual(resources, [{ key: 'b1', id: 'b1', name: 'Board 1' }]);
		assert.equal(capturedAppKey, 'my-app-key', 'the session appKey is passed to the Trello client');

		manager.dispose();
	});

	test('getIssuesForProject maps getIssuesForBoard results, scoped by board id', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		let capturedBoardId: string | undefined;
		let capturedAppKey: string | undefined;
		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			getTrelloIssuesForBoard: (_t: unknown, appKey: string, boardId: string) => {
				capturedAppKey = appKey;
				capturedBoardId = boardId;
				return Promise.resolve([fakeIssue()]);
			},
		});

		const issues = await trello.getIssuesForProject({ key: 'b1', id: 'b1', name: 'Board 1' });
		assert.equal(issues?.length, 1, 'the board issues are mapped to issue shapes');
		assert.equal(capturedBoardId, 'b1');
		assert.equal(capturedAppKey, 'my-app-key');

		manager.dispose();
	});

	test('a session without an appKey yields no results instead of calling the client', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession(undefined);

		let called = false;
		stubApi(trello, {
			getTrelloBoardsForCurrentUser: () => {
				called = true;
				return Promise.resolve([]);
			},
		});

		const resources = await trello.getResourcesForUser();
		assert.equal(resources, undefined, 'no appKey → no read');
		assert.equal(called, false);

		manager.dispose();
	});
});
