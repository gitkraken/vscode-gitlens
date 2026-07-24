import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { base64 } from '@gitlens/utils/base64.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import { GitCloudHostIntegrationId } from '../../constants.js';
import { createIntegrationService as createIntegrationManager } from '../../integrationService.js';

type CapturedAzureOptions = {
	token?: string;
	isPAT?: boolean;
	baseUrl?: string;
};

suite('Azure pull request auth (#5529)', () => {
	test('sends the PAT-converted OAuth token as PAT for single-project PR reads', async () => {
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

		assert.equal(capturedOptions?.token, base64('PAT:oauth-token'));
		assert.equal(capturedOptions?.isPAT, true);

		manager.dispose();
	});
});
