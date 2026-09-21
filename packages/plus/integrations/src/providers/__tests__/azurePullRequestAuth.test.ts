import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { primarySession, stubApi } from '../../__tests__/sweepHelpers.js';
import type { ProviderAuthenticationSession, TokenWithInfo } from '../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';

type CapturedAzureOptions = {
	token?: string;
	isPAT?: boolean;
	baseUrl?: string;
};

suite('Azure pull request auth (#5529)', () => {
	test('sends the raw OAuth token as a Basic credential for single-project PR reads', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const ado = await manager.get(GitCloudHostIntegrationId.AzureDevOps);

		const api = await (
			ado as unknown as { getProvidersApi(): Promise<{ providers: Record<string, Record<string, unknown>> }> }
		).getProvidersApi();

		let capturedOptions: CapturedAzureOptions | undefined;
		(
			api.providers[GitCloudHostIntegrationId.AzureDevOps] as {
				getPullRequestsForAzureProjectFn: (
					input: unknown,
					options?: CapturedAzureOptions,
				) => Promise<{ data: unknown[]; pageInfo: { hasNextPage: boolean; nextPage: number | null } }>;
			}
		).getPullRequestsForAzureProjectFn = (_input, options) => {
			capturedOptions = options;
			return Promise.resolve({ data: [], pageInfo: { hasNextPage: false, nextPage: null } });
		};

		await (
			api as unknown as {
				getPullRequestsForAzureProject: (
					token: TokenWithInfo<GitCloudHostIntegrationId.AzureDevOps>,
					project: { namespace: string; project: string },
					options: { isPAT: boolean },
				) => Promise<unknown>;
			}
		).getPullRequestsForAzureProject(
			{
				providerId: GitCloudHostIntegrationId.AzureDevOps,
				accessToken: 'oauth-token',
				microHash: undefined,
				cloud: true,
				type: 'oauth',
				scopes: [],
			},
			{ namespace: 'org', project: 'project' },
			{ isPAT: false },
		);

		// The secret must reach provider-apis RAW: `isPAT` makes it encode the Basic credential itself, so a token
		// pre-encoded here would be encoded twice and refused by Azure DevOps.
		assert.equal(capturedOptions?.token, 'oauth-token');
		assert.equal(capturedOptions?.isPAT, true);

		manager.dispose();
	});

	// The test above enters through `ProvidersApi` directly, so it cannot see `getApiOptions` — the seam that
	// actually derives the credential for every SDK-backed Azure read, and the one that used to pre-encode it.
	// A regression reintroducing `convertTokentoPAT` there would leave that test green, so drive a read through
	// the integration itself and assert on what the provider function is handed.
	test('a read entering through the integration hands the provider the raw token, not a pre-encoded one', async () => {
		const runtime = createFakeRuntime();
		const manager = createIntegrationManager(runtime);
		const azure = await manager.get(GitCloudHostIntegrationId.AzureDevOps);
		(azure as unknown as { _session: ProviderAuthenticationSession })._session = {
			...primarySession('oauth-token'),
			domain: 'dev.azure.com',
		};

		let capturedToken: TokenWithInfo | undefined;
		let capturedOptions: CapturedAzureOptions | undefined;
		stubApi(azure, {
			getReposForAzureProject: (
				tokenWithInfo: TokenWithInfo,
				_org: unknown,
				_project: unknown,
				options?: CapturedAzureOptions,
			) => {
				capturedToken = tokenWithInfo;
				capturedOptions = options;
				return Promise.resolve({ values: [] });
			},
		});

		await (
			azure as unknown as {
				getProviderRepositoriesForOrg: (
					session: ProviderAuthenticationSession,
					org: string,
					options?: { project?: string },
				) => Promise<unknown>;
			}
		).getProviderRepositoriesForOrg(primarySession('oauth-token'), 'org', { project: 'project' });

		// `getApiOptions` used to hand this on as `base64('PAT:' + token)`; provider-apis 0.59.0 encodes the Basic
		// credential itself, so a pre-encoded secret would be encoded twice and refused by Azure DevOps.
		assert.equal(capturedToken?.accessToken, 'oauth-token');
		assert.equal(capturedOptions?.isPAT, true);

		manager.dispose();
	});
});
