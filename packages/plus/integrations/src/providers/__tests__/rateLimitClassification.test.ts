import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { AuthenticationError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { Provider } from '@gitlens/git/models/remoteProvider.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';
import type { ProviderApiConfig } from '../apiConfig.js';
import { AzureDevOpsApi } from '../azure/azure.js';
import { BitbucketApi } from '../bitbucket/bitbucket.js';

/**
 * Guard for the rate-limit branches in the direct-`fetch` clients.
 *
 * Those branches existed but could never fire: the clients built their `ProviderFetchError` from the status line
 * alone, so `isRateLimitResponse` inspected a message that read "(403) Forbidden." and never contained the host's
 * wording. Dead code — and the reason a throttle reached the user as `auth`, prompting them to reconnect a
 * perfectly healthy account.
 *
 * Exercised through each client's private `request`, which is the boundary where the classification happens and
 * the last point at which it is observable: every public method on these clients deliberately catches and returns
 * `undefined`, so the error type is erased above this layer. The classification still matters there, because the
 * facade's `runCaptured` recovers whatever propagates out of the read paths that do rethrow, and `kind` is derived
 * from the error's TYPE.
 */

const provider = {
	id: 'bitbucket',
	name: 'Bitbucket',
	domain: 'bitbucket.org',
	icon: 'bitbucket',
	getIgnoreSSLErrors: () => false,
	reauthenticate: () => Promise.resolve(),
	trackRequestException: () => {},
} as unknown as Provider;

const token = {
	providerId: 'bitbucket',
	accessToken: 'token',
	microHash: 'hash',
	cloud: true,
	type: undefined,
} as unknown as TokenWithInfo;

function respondWith(status: number, statusText: string, body: string, contentType?: string): ProviderApiConfig {
	return {
		fetch: () =>
			Promise.resolve(
				new Response(body, {
					status: status,
					statusText: statusText,
					headers: contentType != null ? { 'content-type': contentType } : undefined,
				}),
			),
		wrapForForcedInsecureSSL: (_ignore, fn) => Promise.resolve(fn()),
	};
}

async function captureError(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		await fn();
		return undefined;
	} catch (ex) {
		return ex;
	}
}

suite('Bitbucket rate limit classification', () => {
	function read(config: ProviderApiConfig): Promise<unknown> {
		const api = new BitbucketApi(config) as unknown as {
			request: (
				provider: Provider,
				token: TokenWithInfo,
				baseUrl: string,
				route: string,
				options: { method: string },
				cancellation: AbortSignal | undefined,
				scope: undefined,
			) => Promise<unknown>;
		};
		return api.request(
			provider,
			token,
			'https://api.bitbucket.org/2.0',
			'repositories/acme',
			{ method: 'GET' },
			undefined,
			undefined,
		);
	}

	test('classifies a throttled 403 as a rate limit, not an auth failure', async () => {
		const ex = await captureError(() =>
			read(
				respondWith(
					403,
					'Forbidden',
					JSON.stringify({ error: { message: 'API rate limit exceeded' } }),
					'application/json',
				),
			),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('classifies a 429 with a bare-text body as a rate limit', async () => {
		// Bitbucket's documented throttle status, whose body is plain text with no JSON envelope.
		const ex = await captureError(() =>
			read(respondWith(429, 'Too Many Requests', 'Rate limit for this resource has been exceeded')),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('still reports a genuine permission failure as an auth failure', async () => {
		const ex = await captureError(() =>
			read(
				respondWith(
					403,
					'Forbidden',
					JSON.stringify({
						error: { message: 'Your credentials lack one or more required privilege scopes.' },
					}),
					'application/json',
				),
			),
		);

		assert.ok(ex instanceof AuthenticationError, `expected AuthenticationError, got ${String(ex)}`);
	});
});

suite('Azure DevOps rate limit classification', () => {
	const azureProvider = { ...provider, id: 'azure', name: 'Azure DevOps' } as unknown as Provider;

	function read(config: ProviderApiConfig): Promise<unknown> {
		const api = new AzureDevOpsApi(config) as unknown as {
			request: (
				provider: Provider,
				token: TokenWithInfo,
				baseUrl: string,
				route: string,
				options: { method: string },
				scope: undefined,
				cancellation?: AbortSignal,
			) => Promise<unknown>;
		};
		return api.request(
			azureProvider,
			token,
			'https://dev.azure.com',
			'acme/Payments/_apis/wit/workItems/1',
			{ method: 'GET' },
			undefined,
		);
	}

	test('classifies a TF400733 throttle as a rate limit, not an auth failure', async () => {
		const ex = await captureError(() =>
			read(
				respondWith(
					403,
					'Forbidden',
					JSON.stringify({
						message:
							"TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource 'RateLimit' in namespace ''.",
					}),
					'application/json',
				),
			),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('classifies the documented 429 form as a rate limit', async () => {
		const ex = await captureError(() =>
			read(respondWith(429, 'Too Many Requests', JSON.stringify({ message: 'TF400733' }), 'application/json')),
		);

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('still reports a genuine permission failure as an auth failure', async () => {
		const ex = await captureError(() =>
			read(
				respondWith(
					403,
					'Forbidden',
					JSON.stringify({ message: 'TF401027: You need the Git "GenericRead" permission.' }),
					'application/json',
				),
			),
		);

		assert.ok(ex instanceof AuthenticationError, `expected AuthenticationError, got ${String(ex)}`);
	});
});

suite('provider-apis fetch adapter rate limit classification', () => {
	async function read(body: string): Promise<unknown> {
		const runtime = createFakeRuntime();
		runtime.http.fetch = () =>
			Promise.resolve(
				new Response(body, {
					status: 403,
					statusText: 'Forbidden',
					headers: { 'content-type': 'application/json' },
				}),
			);
		const manager = createIntegrationManager(runtime);
		const gh = await manager.get(GitCloudHostIntegrationId.GitHub);
		const api = await (
			gh as unknown as {
				getProvidersApi(): Promise<{
					getCurrentUser(token: {
						providerId: GitCloudHostIntegrationId;
						accessToken: string;
					}): Promise<unknown>;
				}>;
			}
		).getProvidersApi();

		const ex = await captureError(() =>
			api.getCurrentUser({ providerId: GitCloudHostIntegrationId.GitHub, accessToken: 'token' }),
		);
		manager.dispose();
		return ex;
	}

	test('retains a throttled 403 body so the SDK path reports rate-limit', async () => {
		const ex = await read(JSON.stringify({ message: 'API rate limit exceeded for this installation' }));

		assert.ok(ex instanceof RequestRateLimitError, `expected RequestRateLimitError, got ${String(ex)}`);
	});

	test('still classifies a genuine SDK permission failure as auth', async () => {
		const ex = await read(JSON.stringify({ message: 'Resource not accessible by this token' }));

		assert.ok(ex instanceof AuthenticationError, `expected AuthenticationError, got ${String(ex)}`);
	});
});
