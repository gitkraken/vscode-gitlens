import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { TokenWithInfo } from '../../authentication/models.js';
import {
	GitCloudHostIntegrationId,
	GitSelfManagedHostIntegrationId,
	IssuesCloudHostIntegrationId,
	IssuesSelfManagedHostIntegrationId,
} from '../../constants.js';
import { AuthenticationError, RequestClientError } from '../../errors.js';
import { parseFetchResponseForApi } from '../providerApiClient.js';
import {
	AnonymousResponseError,
	isProviderIssueNotFoundError,
	throwProviderError,
	UnexpectedHtmlResponseError,
} from '../providerErrors.js';

const signInPage = '<!DOCTYPE html><html><body>Sign in to Azure DevOps</body></html>';

const tokenWithInfo = {
	providerId: GitCloudHostIntegrationId.AzureDevOps,
	accessToken: 'token',
	microHash: undefined,
	cloud: true,
	type: 'oauth',
	scopes: [],
} as unknown as TokenWithInfo;

// Azure DevOps answers a rejected credential by redirecting to its sign-in page, which returns `203 text/html`.
// `response.ok` spans 200-299, so that page used to be handed to provider code as a successful body — a bad
// credential looked like a successful write on a route returning `void` (GKDEV-3617).
suite('HTML responses on a 2xx (GKDEV-3617)', () => {
	test('a 203 sign-in page is rejected instead of being returned as data', async () => {
		const response = new Response(signInPage, {
			status: 203,
			headers: { 'content-type': 'text/html; charset=utf-8' },
		});

		await assert.rejects(() => parseFetchResponseForApi(response), UnexpectedHtmlResponseError);
	});

	test('a page mislabelled as JSON is recognized too', async () => {
		const response = new Response(signInPage, {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});

		// Left to JSON.parse this threw a bare SyntaxError carrying neither the status nor the body.
		await assert.rejects(() => parseFetchResponseForApi(response), UnexpectedHtmlResponseError);
	});

	test('the content-type is matched case-insensitively', async () => {
		const response = new Response(signInPage, {
			status: 200,
			headers: { 'content-type': 'TEXT/HTML' },
		});

		await assert.rejects(() => parseFetchResponseForApi(response), UnexpectedHtmlResponseError);
	});

	test('a non-2xx HTML response keeps its own status error, which says more', async () => {
		const response = new Response(signInPage, {
			status: 500,
			headers: { 'content-type': 'text/html' },
		});

		await assert.rejects(
			() => parseFetchResponseForApi(response),
			(ex: unknown) => ex instanceof Error && !(ex instanceof UnexpectedHtmlResponseError),
		);
	});

	test('an empty body is not mistaken for a page, so a 204 write still succeeds', async () => {
		// A write answering `204` can carry a stale `text/html` from whatever its endpoint usually returns, and a
		// sign-in page is never empty — rejecting this would fail every such write.
		const response = new Response(null, { status: 204, headers: { 'content-type': 'text/html' } });

		const result = await parseFetchResponseForApi(response);
		assert.equal(result.status, 204);
	});

	test('the attached response drops credential-bearing headers and cuts the page', async () => {
		// An error is something a consumer may reasonably log or forward, and the response it is built from is a
		// sign-in page that sets a session cookie and advertises the tenant.
		const page = `<html>${'x'.repeat(20000)}</html>`;
		const error = new UnexpectedHtmlResponseError(203, 'text/html', {
			body: page,
			headers: {
				'Set-Cookie': 'VstsSession=secret-session-value; secure; HttpOnly',
				'WWW-Authenticate': 'Bearer authorization_uri=https://login.microsoftonline.com/tenant-id',
				'X-TFS-ProcessId': 'kept-for-diagnostics',
			},
			status: 203,
		});

		assert.equal(error.response.headers['Set-Cookie'], undefined);
		assert.equal(error.response.headers['WWW-Authenticate'], undefined);
		assert.equal(error.response.headers['X-TFS-ProcessId'], 'kept-for-diagnostics');
		assert.ok((error.response.body?.length ?? 0) < 1000, 'the page body must be cut to a diagnostic prefix');
		assert.equal(JSON.stringify(error.response).includes('secret-session-value'), false);
	});

	test('real data on a 2xx is untouched', async () => {
		const response = new Response(JSON.stringify({ value: [1, 2] }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});

		const result = await parseFetchResponseForApi<{ value: number[] }>(response);
		assert.deepEqual(result.body, { value: [1, 2] });
	});

	for (const providerId of [
		GitCloudHostIntegrationId.AzureDevOps,
		GitSelfManagedHostIntegrationId.AzureDevOpsServer,
	]) {
		test(`on ${providerId} the page is classified as an authentication failure`, () => {
			assert.throws(
				() =>
					throwProviderError(
						{ ...tokenWithInfo, providerId: providerId },
						new UnexpectedHtmlResponseError(203, 'text/html', undefined),
					),
				AuthenticationError,
			);
		});
	}

	test('on any other provider it stays a request failure, so a valid session is not expired', () => {
		// `handleProviderException` expires a cloud session on an AuthenticationError and counts it against the
		// budget that disconnects the integration. Only Azure is known to answer a rejected credential with a
		// page; elsewhere a 2xx page is far more likely a maintenance or WAF interstitial, and treating that as
		// a credential failure would sign the user out of a perfectly good connection.
		for (const providerId of [GitCloudHostIntegrationId.GitHub, IssuesCloudHostIntegrationId.Jira]) {
			assert.throws(
				() =>
					throwProviderError(
						{ ...tokenWithInfo, providerId: providerId },
						new UnexpectedHtmlResponseError(200, 'text/html', undefined),
					),
				(ex: unknown) => ex instanceof RequestClientError && !(ex instanceof AuthenticationError),
				`${providerId} must not be reported as an auth failure`,
			);
		}
	});
});

// Jira Data Center serves a token it rejects as the anonymous user, answering `200 []` for its project list rather
// than refusing the credential, so an account looked like it had no projects (#6014).
suite('responses served as the anonymous user', () => {
	const sentCredential = () => true;
	const anonymousProjects = () =>
		new Response('[]', {
			status: 200,
			headers: { 'content-type': 'application/json', 'x-ausername': 'anonymous' },
		});

	test('a request sent with a credential is rejected instead of being returned as data', async () => {
		await assert.rejects(
			() => parseFetchResponseForApi(anonymousProjects(), sentCredential),
			AnonymousResponseError,
		);
	});

	test('a refusal naming the anonymous user is the credential rejected too, in any casing', async () => {
		const response = new Response(JSON.stringify({ errorMessages: ['Forbidden'] }), {
			status: 403,
			headers: { 'content-type': 'application/json', 'x-ausername': 'Anonymous' },
		});

		await assert.rejects(() => parseFetchResponseForApi(response, sentCredential), AnonymousResponseError);
	});

	test('a throttle or a server failure keeps its own error', async () => {
		for (const status of [429, 503]) {
			const response = new Response('{}', {
				status: status,
				headers: { 'content-type': 'application/json', 'x-ausername': 'anonymous' },
			});

			await assert.rejects(
				() => parseFetchResponseForApi(response, sentCredential),
				(ex: unknown) => ex instanceof Error && !(ex instanceof AnonymousResponseError),
				String(status),
			);
		}
	});

	test('a 401 keeps its own error and its body, which already refuses the credential', async () => {
		const response = new Response(JSON.stringify({ message: 'The user is not currently licensed' }), {
			status: 401,
			statusText: 'Unauthorized',
			headers: { 'content-type': 'application/json', 'x-ausername': 'anonymous' },
		});

		await assert.rejects(
			() => parseFetchResponseForApi(response, sentCredential),
			(ex: unknown) =>
				ex instanceof Error &&
				!(ex instanceof AnonymousResponseError) &&
				ex.message === '(401) Unauthorized. The user is not currently licensed',
		);
	});

	test('it is never a missing issue, whatever its status', () => {
		assert.equal(
			isProviderIssueNotFoundError(
				IssuesSelfManagedHostIntegrationId.JiraServer,
				new AnonymousResponseError(404, undefined),
			),
			false,
		);
	});

	test('a request sent without a credential keeps its answer, which is the anonymous user', async () => {
		const result = await parseFetchResponseForApi<unknown[]>(anonymousProjects());
		assert.deepEqual(result.body, []);
	});

	test('a response naming the authenticated user is untouched', async () => {
		const response = new Response('[]', {
			status: 200,
			headers: { 'content-type': 'application/json', 'x-ausername': 'julian' },
		});

		const result = await parseFetchResponseForApi<unknown[]>(response, sentCredential);
		assert.deepEqual(result.body, []);
	});

	test('it is classified as an authentication failure on every provider', () => {
		for (const providerId of [
			IssuesSelfManagedHostIntegrationId.JiraServer,
			GitSelfManagedHostIntegrationId.BitbucketServer,
		]) {
			assert.throws(
				() =>
					throwProviderError(
						{ ...tokenWithInfo, providerId: providerId },
						new AnonymousResponseError(200, undefined),
					),
				AuthenticationError,
			);
		}
	});
});
