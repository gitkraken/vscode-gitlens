import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { RequestNotFoundError, RequestRateLimitError } from '@gitlens/git/errors.js';
import type { TokenWithInfo } from '../../authentication/models.js';
import { GitCloudHostIntegrationId, GitSelfManagedHostIntegrationId } from '../../constants.js';
import { toProviderWarning } from '../../results.js';
import { throwProviderError } from '../providerErrors.js';

function tokenFor(providerId: string): TokenWithInfo {
	return {
		providerId: providerId,
		accessToken: 'token',
		microHash: undefined,
		cloud: true,
		type: 'oauth',
		scopes: [],
	} as unknown as TokenWithInfo;
}

// Shaped like provider-apis' `GraphQLErrors`: an Error carrying `graphQLErrors`, with no `response`.
function graphQLErrors(...types: string[]): Error {
	const ex = new Error('Could not search pull requests: API rate limit exceeded for user ID 1.');
	(ex as unknown as { graphQLErrors: unknown }).graphQLErrors = types.map(type => ({
		type: type,
		message: 'API rate limit exceeded for user ID 1.',
	}));
	return ex;
}

function capture(providerId: string, error: unknown): unknown {
	try {
		throwProviderError(tokenFor(providerId), error);
	} catch (ex) {
		return ex;
	}
}

suite('GitHub GraphQL rate limit classification (SDK path)', () => {
	for (const providerId of [
		GitCloudHostIntegrationId.GitHub,
		GitSelfManagedHostIntegrationId.CloudGitHubEnterprise,
	]) {
		for (const type of ['RATE_LIMITED', 'RATE_LIMIT']) {
			test(`${type} graphQLErrors on ${providerId} classify as a rate limit`, () => {
				const ex = capture(providerId, graphQLErrors(type));

				assert.ok(ex instanceof RequestRateLimitError);
				assert.equal(toProviderWarning(providerId, undefined, undefined, ex).kind, 'rate-limit');
			});
		}

		test(`a RATE_LIMITED that is not first on ${providerId} still classifies as a rate limit`, () => {
			assert.ok(capture(providerId, graphQLErrors('NOT_FOUND', 'RATE_LIMITED')) instanceof RequestRateLimitError);
		});

		test(`NOT_FOUND-only graphQLErrors on ${providerId} are not a rate limit`, () => {
			const error = graphQLErrors('NOT_FOUND');
			const ex = capture(providerId, error);

			assert.ok(!(ex instanceof RequestRateLimitError));
			assert.ok(!(ex instanceof RequestNotFoundError));
			assert.equal(ex, error);
			assert.equal(toProviderWarning(providerId, undefined, undefined, ex).kind, 'other');
		});
	}

	test('the same shape on a non-GitHub provider is unchanged', () => {
		const error = graphQLErrors('RATE_LIMITED');
		const ex = capture(GitCloudHostIntegrationId.GitLab, error);

		assert.equal(ex, error);
	});
});
