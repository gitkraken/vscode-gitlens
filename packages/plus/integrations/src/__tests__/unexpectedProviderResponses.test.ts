import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { Logger } from '@gitlens/utils/logger.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../authentication/models.js';
import { toTokenWithInfo } from '../authentication/models.js';
import { mergeAssessmentInto, toCollectionScopeFailure } from '../collectionMetadata.js';
import { IssuesCloudHostIntegrationId } from '../constants.js';
import { AuthenticationError, RequestClientError } from '../errors.js';
import { createIntegrationService as createIntegrationManager } from '../integrationService.js';
import type { IntegrationResult } from '../models/integration.js';
import { throwProviderError, UnexpectedResponseError } from '../providers/providerErrors.js';
import { ProvidersApi } from '../providers/providersApi.js';
import type { ProviderWarning } from '../results.js';
import { toProviderWarning } from '../results.js';
import { createFakeRuntime } from './fakeRuntime.js';

/**
 * A tracker answering a read with a 2xx whose JSON isn't the shape the read expects (#6046): provider-apis reads the
 * body unchecked, so the read failed with a `TypeError` whose text (`response.body.map is not a function`) became the
 * warning. Each case answers at the HTTP level and runs the real provider-apis read behind the real core boundary.
 */

type Fetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const unexpectedResponseMessage = 'Expected data but the provider returned an unexpected response';
/** What the warning used to say: the JavaScript error the read raised on the body. */
const internalErrorText = /is not a function|Cannot read properties/;

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { 'content-type': 'application/json' } });
}

const trackers = [
	{
		name: 'Jira Cloud sites',
		providerId: IssuesCloudHostIntegrationId.Jira,
		session: { domain: 'atlassian.net' },
		bodies: [{ message: 'Gateway says no' }, {}, null],
	},
	{
		name: 'Trello boards',
		providerId: IssuesCloudHostIntegrationId.Trello,
		session: { domain: 'trello.com', appKey: 'app-key' },
		bodies: [{ message: 'Gateway says no' }, {}, null],
	},
	{
		name: 'Linear organization',
		providerId: IssuesCloudHostIntegrationId.Linear,
		session: { domain: 'linear.app' },
		// A GraphQL answer with neither the organization nor `errors`, as well as the bodies a gateway sends.
		bodies: [{ data: {} }, {}, null],
	},
] as const;

function session(overrides: Partial<ProviderAuthenticationSession>): ProviderAuthenticationSession {
	return {
		id: 'primary',
		accessToken: 'tok',
		account: { id: 'me', label: 'me' },
		scopes: [],
		cloud: true,
		type: 'oauth',
		domain: '',
		...overrides,
	};
}

async function connect(tracker: (typeof trackers)[number], fetch: Fetch) {
	const runtime = createFakeRuntime();
	runtime.http.fetch = fetch;
	const manager = createIntegrationManager(runtime);
	const integration = await manager.get(tracker.providerId);
	(integration as unknown as { _session: ProviderAuthenticationSession })._session = session(tracker.session);
	return { manager: manager, integration: integration };
}

function assertUnexpectedResponse(warnings: ProviderWarning[], providerId: IssuesCloudHostIntegrationId): void {
	assert.equal(warnings.length, 1, JSON.stringify(warnings));
	const [warning] = warnings;
	assert.equal(warning.providerId, providerId);
	assert.equal(warning.kind, 'other');
	assert.equal(warning.isAuth, false);
	assert.deepEqual(warning.cause, { reason: 'unexpected-response' });
	assert.equal(warning.message, unexpectedResponseMessage);
}

suite('Unexpected JSON responses from a tracker (#6046)', () => {
	for (const tracker of trackers) {
		for (const body of tracker.bodies) {
			test(`${tracker.name}: a 200 of ${JSON.stringify(body)} fails the read with a readable warning`, async () => {
				const { manager } = await connect(tracker, () => Promise.resolve(json(body)));
				try {
					const result = await manager.listOrgs({ providerId: tracker.providerId });

					assert.equal(result.fetchFailed, true);
					assert.deepEqual(result.items, []);
					assertUnexpectedResponse(result.warnings, tracker.providerId);
				} finally {
					manager.dispose();
				}
			});
		}

		test(`${tracker.name}: the error the read raised is kept for the logs`, async () => {
			const { manager, integration } = await connect(tracker, () => Promise.resolve(json({})));
			try {
				const result = await (
					integration as unknown as { getResourcesForUserResult: () => Promise<IntegrationResult<unknown>> }
				).getResourcesForUserResult();

				const error = result?.error;
				assert.ok(UnexpectedResponseError.is(error), String(error));
				assert.ok(error.original instanceof TypeError);
				assert.match(error.original.message, internalErrorText);
				// `Logger.error` prints `String(ex)`, which names the original error too.
				assert.ok(String(error).includes(error.original.message), String(error));
			} finally {
				manager.dispose();
			}
		});
	}

	test('the read still fails with the same page, cursor and retry as any other failed discovery', async () => {
		// Linear's GraphQL error is a plain `Error`, so it takes the path a `TypeError` took before; only the
		// warning differs.
		const read = async (body: unknown) => {
			const { manager } = await connect(trackers[2], () => Promise.resolve(json(body)));
			try {
				return await manager.listIssueTrackerIssuesPage({
					providerId: IssuesCloudHostIntegrationId.Linear,
					itemsPerPage: 5,
				});
			} finally {
				manager.dispose();
			}
		};

		const { warnings: unexpected, ...unexpectedPage } = await read({});
		const { warnings: graphQL, ...graphQLPage } = await read({ errors: [{ message: 'Something went wrong' }] });

		assert.equal(unexpectedPage.fetchFailed, true);
		assert.ok(unexpectedPage.cursor, 'a failed discovery keeps a cursor to retry it');
		assert.deepEqual(unexpectedPage, graphQLPage);
		assertUnexpectedResponse(unexpected, IssuesCloudHostIntegrationId.Linear);
		assert.deepEqual(
			graphQL.map(w => [w.kind, w.cause, w.message]),
			[['other', undefined, 'Linear GraphQL errors: Something went wrong']],
		);
	});

	test('repeated failures never count toward disconnecting, so the next good answer is read', async () => {
		let healthy = false;
		const { manager } = await connect(trackers[0], () =>
			Promise.resolve(
				json(
					healthy
						? [{ id: 'site-1', url: 'https://acme.atlassian.net', name: 'Acme', scopes: [], avatarUrl: '' }]
						: { message: 'Gateway says no' },
				),
			),
		);
		try {
			const target = { providerId: IssuesCloudHostIntegrationId.Jira };
			for (let i = 0; i < 6; i++) {
				assertUnexpectedResponse((await manager.listOrgs(target)).warnings, IssuesCloudHostIntegrationId.Jira);
			}

			healthy = true;
			const result = await manager.listOrgs(target);
			assert.deepEqual(result.warnings, []);
			assert.deepEqual(
				result.items.map(o => o.id),
				['site-1'],
			);
		} finally {
			manager.dispose();
		}
	});
});

suite('Failures other than an unexpected response keep their warnings (#6046)', () => {
	const jiraToken = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, session({ domain: 'atlassian.net' }));
	const linearToken = toTokenWithInfo(IssuesCloudHostIntegrationId.Linear, session({ domain: 'linear.app' }));

	/** The warning a Jira Cloud site list, or a Linear organization read, fails with when `fetch` answers so. */
	async function warningFor(provider: 'jira' | 'linear', fetch: Fetch): Promise<ProviderWarning> {
		const api = new ProvidersApi({
			ctx: { http: { fetch: fetch, userAgent: 'test' } },
		} as unknown as IntegrationAuthenticationService);
		const token = provider === 'jira' ? jiraToken : linearToken;
		try {
			await (provider === 'jira'
				? api.getJiraResourcesForCurrentUser(jiraToken)
				: api.getLinearOrganization(linearToken));
		} catch (ex) {
			return toProviderWarning(token.providerId, undefined, undefined, ex);
		}
		assert.fail('the read should have failed');
	}

	function summary(warning: ProviderWarning) {
		return { kind: warning.kind, isAuth: warning.isAuth, cause: warning.cause, message: warning.message };
	}

	test('an HTML page keeps its own message', async () => {
		const warning = await warningFor('jira', () =>
			Promise.resolve(
				new Response('<html><body>Maintenance</body></html>', {
					status: 200,
					headers: { 'content-type': 'text/html' },
				}),
			),
		);

		assert.deepEqual(summary(warning), {
			kind: 'other',
			isAuth: false,
			cause: undefined,
			message: '(200) Expected data but the provider returned an HTML page (content-type: text/html)',
		});
	});

	test('a Linear GraphQL error keeps its own message', async () => {
		const warning = await warningFor('linear', () =>
			Promise.resolve(json({ errors: [{ message: 'Something went wrong' }] })),
		);

		assert.deepEqual(summary(warning), {
			kind: 'other',
			isAuth: false,
			cause: undefined,
			message: 'Linear GraphQL errors: Something went wrong',
		});
	});

	for (const [status, kind] of [
		[401, 'auth'],
		[429, 'rate-limit'],
		[404, 'not-found'],
	] as const) {
		test(`a ${status} stays ${kind}`, async () => {
			const warning = await warningFor('jira', () => Promise.resolve(json({ message: 'nope' }, status)));

			assert.equal(warning.kind, kind);
			assert.equal(warning.isAuth, kind === 'auth');
			assert.equal(warning.cause, undefined);
		});
	}

	test('a transport failure stays unreachable', async () => {
		const warning = await warningFor('jira', () =>
			Promise.reject(
				new TypeError('fetch failed', { cause: Object.assign(new Error(), { code: 'ECONNREFUSED' }) }),
			),
		);

		assert.deepEqual(summary(warning), {
			kind: 'other',
			isAuth: false,
			cause: { reason: 'unreachable' },
			message: 'fetch failed',
		});
	});

	test('a server error stays unreachable', async () => {
		const warning = await warningFor('jira', () => Promise.resolve(json({ message: 'Server unavailable' }, 503)));

		assert.equal(warning.kind, 'other');
		assert.deepEqual(warning.cause, { reason: 'unreachable' });
	});

	test("a TypeError the request itself threw is not read as the provider's answer", async () => {
		// What a fetch throws for a URL or header it refuses, before any response.
		const warning = await warningFor('jira', () => Promise.reject(new TypeError('Failed to parse URL from nope')));

		assert.deepEqual(summary(warning), {
			kind: 'other',
			isAuth: false,
			cause: undefined,
			message: 'Failed to parse URL from nope',
		});
	});

	test("a TypeError reading the response's body is not read as the provider's answer", async () => {
		// What a fetch rejects the body read with when the connection drops partway through it.
		const warning = await warningFor('jira', () =>
			Promise.resolve(
				new Response(
					new ReadableStream({
						start: controller => controller.error(new TypeError('terminated')),
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				),
			),
		);

		assert.deepEqual(summary(warning), { kind: 'other', isAuth: false, cause: undefined, message: 'terminated' });
	});
});

suite('Unexpected response classification (#6046)', () => {
	const token = toTokenWithInfo(IssuesCloudHostIntegrationId.Jira, session({ domain: 'atlassian.net' }));

	test("neither expires the session nor counts toward disconnecting, and logs the read's own error once", () => {
		const original = new TypeError('s2.body.map is not a function');

		const logged: string[] = [];
		const originalWarn = Logger.warn;
		Logger.warn = (...params: unknown[]) => void logged.push(params.join(' '));
		try {
			assert.throws(
				() => throwProviderError(token, original),
				(ex: unknown) =>
					UnexpectedResponseError.is(ex) &&
					ex.original === original &&
					!(ex instanceof AuthenticationError) &&
					!(ex instanceof RequestClientError),
			);
		} finally {
			Logger.warn = originalWarn;
		}
		assert.equal(logged.length, 1);
		assert.match(logged[0], /^jira: .*TypeError: s2\.body\.map is not a function/);
	});

	test('names its cause on a fan-out scope failure', () => {
		const failure = toCollectionScopeFailure(
			{ providerId: IssuesCloudHostIntegrationId.Jira, resourceId: 'site-1', projectId: 'PROJ' },
			new UnexpectedResponseError(new TypeError('s2.body.map is not a function')),
		);
		assert.deepEqual(failure.cause, { reason: 'unexpected-response' });
		assert.equal(failure.message, unexpectedResponseMessage);

		const warnings: ProviderWarning[] = [];
		mergeAssessmentInto(warnings, IssuesCloudHostIntegrationId.Jira, undefined, undefined, {
			completeness: 'partial',
			failures: [failure],
		});
		assert.deepEqual(
			warnings.map(w => [w.kind, w.cause, w.message, w.scope]),
			[
				[
					'other',
					{ reason: 'unexpected-response' },
					'Failed to read provider scope (resource site-1, project PROJ): the provider returned an unexpected response',
					{ resourceId: 'site-1', projectId: 'PROJ' },
				],
			],
		);
	});
});
