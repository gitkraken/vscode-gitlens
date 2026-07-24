import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IssuesIntegration } from '../models/issuesIntegration.js';
import type { ProviderIssue } from '../providers/models.js';
import {
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
	getIssueOwner,
} from '../providers/utils.js';
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

function fakeIssue(overrides?: Partial<ProviderIssue>): ProviderIssue {
	return {
		id: 'card-1',
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
		...overrides,
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
				return Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'complete' } });
			},
		});

		const issues = await trello.getIssuesForProject({ key: 'b1', id: 'b1', name: 'Board 1' });
		assert.equal(issues?.length, 1, 'the board issues are mapped to issue shapes');
		assert.equal(capturedBoardId, 'b1');
		assert.equal(capturedAppKey, 'my-app-key');
		assert.deepEqual(issues?.[0]?.project, {
			id: 'b1',
			name: 'Board 1',
			resourceId: 'b1',
			resourceName: 'Board 1',
		});

		manager.dispose();
	});

	test('Trello issues round-trip through branch association metadata', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			getTrelloIssuesForBoard: () =>
				Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'complete' } }),
		});

		const issue = (await trello.getIssuesForProject({ key: 'b1', id: 'b1', name: 'Board 1' }))?.[0];
		assert.ok(issue != null, 'a Trello issue was mapped');
		if (issue == null) throw new Error('Expected a Trello issue');

		const owner = getIssueOwner(issue);
		assert.ok(owner != null, 'a Trello board owner descriptor can be derived');
		if (owner == null) throw new Error('Expected a Trello owner descriptor');

		const issueWithType = { ...issue, type: 'issue' } satisfies Issue;

		const identifier = encodeIssueOrPullRequestForGitConfig(issueWithType, owner);
		let captured: { resource: { id?: string; key: string; owner?: string; name?: string }; id: string } | undefined;

		const resolved = await getIssueFromGitConfigEntityIdentifier(
			async () => ({
				getIssue: async (resource, id) => {
					captured = {
						resource: resource as { id?: string; key: string; owner?: string; name?: string },
						id: id,
					};
					return issueWithType;
				},
			}),
			identifier,
		);

		assert.equal(identifier.provider, 'trello');
		assert.deepEqual(captured, {
			resource: { id: 'b1', key: 'b1', owner: undefined, name: 'Board 1' },
			id: 'card-1',
		});
		assert.equal(resolved?.id, '1');

		manager.dispose();
	});

	test('cached Trello branch-association lookups fall back from idShort to the stable card id', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			getTrelloIssuesForBoard: () =>
				Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'complete' } }),
		});

		const issue = (await trello.getIssuesForProject({ key: 'b1', id: 'b1', name: 'Board 1' }))?.[0];
		assert.ok(issue != null, 'a Trello issue was mapped');
		if (issue == null) throw new Error('Expected a Trello issue');

		const owner = getIssueOwner(issue);
		assert.ok(owner != null, 'a Trello board owner descriptor can be derived');
		if (owner == null) throw new Error('Expected a Trello owner descriptor');

		const identifier = encodeIssueOrPullRequestForGitConfig({ ...issue, type: 'issue' } satisfies Issue, owner);
		const peekedIds: string[] = [];
		const resolved = await getIssueFromGitConfigEntityIdentifier(async () => undefined, identifier, {
			cached: true,
			peekCachedIssue: (_integration, resource, id) => {
				assert.deepEqual(resource, { id: 'b1', key: 'b1', owner: undefined, name: 'Board 1' });
				peekedIds.push(id);
				return id === 'card-1' ? ({ ...issue, type: 'issue' } satisfies Issue) : undefined;
			},
		});

		assert.deepEqual(peekedIds, ['1', 'card-1']);
		assert.equal(resolved?.id, '1');

		manager.dispose();
	});

	test('branch-associated Trello issues resolve through the real integration read', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		let boardReads = 0;
		let cardReads = 0;
		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			getTrelloIssuesForBoard: () => {
				boardReads++;
				return Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'complete' } });
			},
			getTrelloCard: (_t: unknown, _appKey: string, cardId: string) => {
				cardReads++;
				assert.equal(cardId, 'card-1', 'identifier resolution uses the stable Trello card id');
				return Promise.resolve(fakeIssue());
			},
		});

		const issue = (await trello.getIssuesForProject({ key: 'b1', id: 'b1', name: 'Board 1' }))?.[0];
		assert.ok(issue != null, 'a Trello issue was mapped');
		if (issue == null) throw new Error('Expected a Trello issue');

		const owner = getIssueOwner(issue);
		assert.ok(owner != null, 'a Trello board owner descriptor can be derived');
		if (owner == null) throw new Error('Expected a Trello owner descriptor');

		const identifier = encodeIssueOrPullRequestForGitConfig({ ...issue, type: 'issue' } satisfies Issue, owner);
		const resolved = await getIssueFromGitConfigEntityIdentifier(id => manager.get(id), identifier);

		assert.equal(boardReads, 1, 'only the initial project listing reads the board');
		assert.equal(cardReads, 1, 'the cache miss resolves via a direct Trello card read');
		assert.equal(resolved?.id, '1');
		assert.equal(resolved?.nodeId, 'card-1');
		assert.equal(resolved?.number, '1');
		assert.deepEqual(resolved?.project, {
			id: 'b1',
			name: 'Board 1',
			resourceId: 'b1',
			resourceName: 'Board 1',
		});

		manager.dispose();
	});

	test('numeric Trello issue lookups fall back to a board scan when direct card lookup misses', async () => {
		const runtime = createFakeRuntime();
		const cardReadUrls: string[] = [];
		runtime.http.fetch = url => {
			cardReadUrls.push(url.toString());
			return Promise.resolve(
				new Response(JSON.stringify({ message: 'not found' }), {
					status: 404,
					statusText: 'Not Found',
					headers: { 'content-type': 'application/json' },
				}),
			);
		};

		const manager = createIntegrationManager(runtime);
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		let boardReads = 0;
		const api = await (
			trello as unknown as {
				getProvidersApi: () => Promise<{ providers: Record<string, Record<string, unknown>> }>;
			}
		).getProvidersApi();
		const provider = api.providers[IssuesCloudHostIntegrationId.Trello];
		provider.getTrelloListsForBoardFn = () => Promise.resolve({ data: [{ id: 'l1', name: 'To Do' }] });
		provider.getTrelloIssuesForBoardFn = () => {
			boardReads++;
			return Promise.resolve({
				data: [fakeIssue({ id: 'card-7', number: '7' })],
				metadata: { completeness: 'complete' },
			});
		};

		const issue = await trello.getIssue({ key: 'b1', id: 'b1', name: 'Board 1' }, '7');

		assert.equal(cardReadUrls.length, 1, 'the direct card lookup is attempted first');
		assert.match(cardReadUrls[0], /\/1\/cards\/7\?members=true$/);
		assert.equal(boardReads, 1, 'a numeric id falls back to the board scan for compatibility');
		assert.equal(issue?.id, '7');
		assert.equal(issue?.nodeId, 'card-7');
		assert.equal(issue?.number, '7');
		assert.deepEqual(issue?.project, {
			id: 'b1',
			name: 'Board 1',
			resourceId: 'b1',
			resourceName: 'Board 1',
		});

		manager.dispose();
	});

	test('direct Trello card lookups do not depend on the board-lists SDK function', async () => {
		const runtime = createFakeRuntime();
		const cardReadUrls: string[] = [];
		runtime.http.fetch = url => {
			cardReadUrls.push(url.toString());
			return Promise.resolve(
				new Response(
					JSON.stringify({
						id: '64b5abcd0000000000000000',
						idShort: 7,
						name: 'Card',
						url: 'https://trello.com/c/7',
						dateLastActivity: new Date(0).toISOString(),
						labels: [{ color: null, id: 'label-1', name: 'Uncolored' }],
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			);
		};

		const manager = createIntegrationManager(runtime);
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		const session = trelloSession('my-app-key');
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = session;

		const api = await (
			trello as unknown as {
				getProvidersApi: () => Promise<{
					getTrelloCard: (
						token: TokenWithInfo<IssuesCloudHostIntegrationId.Trello>,
						appKey: string,
						cardId: string,
					) => Promise<ProviderIssue | undefined>;
					providers: Record<string, Record<string, unknown>>;
				}>;
			}
		).getProvidersApi();
		api.providers[IssuesCloudHostIntegrationId.Trello].getTrelloListsForBoardFn = undefined;

		const issue = await api.getTrelloCard(
			toTokenWithInfo(IssuesCloudHostIntegrationId.Trello, session),
			'my-app-key',
			'64b5abcd0000000000000000',
		);

		assert.equal(cardReadUrls.length, 1, 'the direct card lookup uses the custom Trello REST read');
		assert.match(cardReadUrls[0], /\/1\/cards\/64b5abcd0000000000000000\?members=true$/);
		assert.equal(issue?.id, '64b5abcd0000000000000000');
		assert.equal(issue?.number, '7');
		assert.deepEqual(issue?.labels, [{ color: null, description: null, id: 'label-1', name: 'Uncolored' }]);

		manager.dispose();
	});

	test('a complete board result reports no truncation (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			getTrelloIssuesForBoard: () =>
				Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'complete' } }),
		});

		const result = await (
			trello as unknown as {
				getProviderIssuesForProjectWithTruncation: (
					session: ProviderAuthenticationSession,
					p: { key: string; id: string; name: string },
				) => Promise<{ values: unknown[]; truncated: boolean }>;
			}
		).getProviderIssuesForProjectWithTruncation(trelloSession('my-app-key'), {
			key: 'b1',
			id: 'b1',
			name: 'Board 1',
		});

		assert.equal(result.values.length, 1, 'all mapped cards are returned');
		assert.equal(result.truncated, false, 'a complete read is not truncated');

		manager.dispose();
	});

	test('a capped board result (metadata unknown) is terminal-truncated with the cards it did return (#5438)', async () => {
		const manager = createIntegrationManager(createFakeRuntime());
		const trello = await manager.get(IssuesCloudHostIntegrationId.Trello);
		(trello as unknown as { _session: ProviderAuthenticationSession })._session = trelloSession('my-app-key');

		stubApi(trello, {
			getTrelloListsForBoard: () => Promise.resolve([{ id: 'l1', name: 'To Do' }]),
			// Trello's search caps at cards_limit and reports the cap as `unknown` completeness (no cursor).
			getTrelloIssuesForBoard: () =>
				Promise.resolve({ values: [fakeIssue()], metadata: { completeness: 'unknown' } }),
		});

		const result = await (
			trello as unknown as {
				getProviderIssuesForProjectWithTruncation: (
					session: ProviderAuthenticationSession,
					p: { key: string; id: string; name: string },
				) => Promise<{ values: unknown[]; truncated: boolean }>;
			}
		).getProviderIssuesForProjectWithTruncation(trelloSession('my-app-key'), {
			key: 'b1',
			id: 'b1',
			name: 'Board 1',
		});

		assert.equal(result.values.length, 1, 'the capped read still returns the cards it got');
		assert.equal(result.truncated, true, 'a capped read is terminally truncated (no cursor to follow)');

		manager.dispose();
	});

	test('a session without an appKey surfaces an error instead of an empty read (and never calls the client)', async () => {
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

		// A session that authenticated but has no appKey can't read Trello; this must be distinguishable from
		// an empty account. The result-returning core recovers the thrown IntegrationReadUnavailableError into
		// { error } (which the facade surfaces as a warning + fetchFailed), and the client is never called.
		const result = await (
			trello as unknown as { getResourcesForUserResult: () => Promise<{ value?: unknown; error?: unknown }> }
		).getResourcesForUserResult();
		assert.equal(result.value, undefined, 'no appKey → no data');
		assert.ok(result.error != null, 'a missing appKey is surfaced as an error, not an empty account');
		assert.equal(called, false, 'the client is never called without an appKey');

		manager.dispose();
	});
});
