import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { PullRequestMergeMethod } from '@gitlens/git/models/pullRequest.js';
import type { IntegrationAuthenticationService } from '../authentication/integrationAuthenticationService.js';
import { toTokenWithInfo } from '../authentication/models.js';
import type { IntegrationIds } from '../constants.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../constants.js';
import { ProvidersApi } from '../providers/providersApi.js';
import { primarySession } from './sweepHelpers.js';

/**
 * The merge method a caller chose reaches the host's merge request (#6126): `mergePullRequest` used to hand
 * provider-apis a `mergeMethod` it doesn't read, so squash and rebase merges used the host's default. Each case runs
 * the real provider-apis merge against a fake `fetch` and asserts what went over the wire.
 */

type Sent = { url: string; body: any };

async function merge(
	providerId: IntegrationIds,
	method: PullRequestMergeMethod | undefined,
	baseUrl?: string,
): Promise<Sent> {
	let sent: Sent | undefined;
	const api = new ProvidersApi({
		ctx: {
			http: {
				fetch: (input: string | URL, init?: RequestInit) => {
					sent = { url: String(input), body: JSON.parse(init?.body as string) };
					return Promise.resolve(
						new Response(
							JSON.stringify({
								title: 'merged',
								status: 'completed',
								data: { mergeRequestAccept: { mergeRequest: { id: '1' }, errors: [] } },
							}),
							{ status: 200, headers: { 'content-type': 'application/json' } },
						),
					);
				},
				userAgent: 'test',
			},
		},
	} as unknown as IntegrationAuthenticationService);

	const merged = await api.mergePullRequest(
		toTokenWithInfo(providerId, { ...primarySession('tok'), domain: 'host.test' }),
		{
			id: '7',
			repository: { owner: 'owner', repo: 'repo' },
			project: { name: 'project' },
			refs: { head: { sha: 'abc123' } },
			version: 3,
		} as unknown as PullRequest,
		{ mergeMethod: method, baseUrl: baseUrl },
	);
	assert.equal(merged, true);
	assert.ok(sent != null);
	return sent;
}

const gitlabSquashed = (sent: Sent): unknown => sent.body.variables.squash;

suite('Merge method reaches the host (#6126)', () => {
	for (const [name, id, baseUrl] of [
		['GitLab', GitCloudHostIntegrationId.GitLab, undefined],
		['GitLab self-managed', GitSelfManagedHostIntegrationId.CloudGitLabSelfHosted, 'https://gitlab.test'],
	] as const) {
		test(`${name} squashes only when asked`, async () => {
			assert.equal(gitlabSquashed(await merge(id, PullRequestMergeMethod.Squash, baseUrl)), true);
			assert.equal(gitlabSquashed(await merge(id, PullRequestMergeMethod.Merge, baseUrl)), false);
			assert.equal(gitlabSquashed(await merge(id, undefined, baseUrl)), false);
		});

		test(`${name} leaves a rebase to the project's merge method`, async () => {
			assert.equal(gitlabSquashed(await merge(id, PullRequestMergeMethod.Rebase, baseUrl)), false);
		});
	}

	test('Bitbucket Cloud sends the strategy and leaves merge to its default', async () => {
		const id = GitCloudHostIntegrationId.Bitbucket;
		assert.equal((await merge(id, PullRequestMergeMethod.Squash)).body.merge_strategy, 'squash');
		assert.equal((await merge(id, PullRequestMergeMethod.Rebase)).body.merge_strategy, 'fast_forward');
		assert.equal((await merge(id, PullRequestMergeMethod.Merge)).body.merge_strategy, undefined);
		assert.equal((await merge(id, undefined)).body.merge_strategy, undefined);
	});

	test('Bitbucket Server sends no strategy for any method', async () => {
		const id = GitSelfManagedHostIntegrationId.BitbucketServer;
		for (const method of [
			PullRequestMergeMethod.Merge,
			PullRequestMergeMethod.Squash,
			PullRequestMergeMethod.Rebase,
			undefined,
		]) {
			const { body } = await merge(id, method, 'https://bitbucket.test');
			assert.equal(body.strategyId, undefined);
			assert.equal(body.version, 3);
		}
	});

	for (const [name, id, baseUrl] of [
		['Azure DevOps', GitCloudHostIntegrationId.AzureDevOps, undefined],
		['Azure DevOps Server', GitSelfManagedHostIntegrationId.AzureDevOpsServer, 'https://azure.test/collection'],
	] as const) {
		test(`${name} sends the chosen merge type`, async () => {
			const strategy = async (method: PullRequestMergeMethod | undefined): Promise<unknown> =>
				(await merge(id, method, baseUrl)).body.completionOptions.mergeStrategy;
			assert.equal(await strategy(PullRequestMergeMethod.Merge), 'noFastForward');
			assert.equal(await strategy(PullRequestMergeMethod.Squash), 'squash');
			assert.equal(await strategy(PullRequestMergeMethod.Rebase), 'rebase');
			assert.equal(await strategy(undefined), undefined);
		});
	}
});
