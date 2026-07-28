import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderPullRequest, ProviderRepository } from '../models.js';
import {
	isAzureCloudDomain,
	providerPullRequestMatchesSearch,
	toProviderPullRequestState,
	toProviderPullRequestStates,
	toProviderRepositoryShape,
} from '../models.js';

suite('providerPullRequestMatchesSearch', () => {
	function pr(title: string, description?: string | null): ProviderPullRequest {
		return { title: title, description: description } as unknown as ProviderPullRequest;
	}

	test('matches title and description case-insensitively', () => {
		assert.equal(providerPullRequestMatchesSearch(pr('Fix Authentication Flow'), ' authentication '), true);
		assert.equal(providerPullRequestMatchesSearch(pr('Update docs', 'Cleans up release NOTES'), 'notes'), true);
		assert.equal(providerPullRequestMatchesSearch(pr('Update docs', null), 'authentication'), false);
	});

	test('matches empty search terms', () => {
		assert.equal(providerPullRequestMatchesSearch(pr('Fix Authentication Flow'), '   '), true);
	});
});

suite('toProviderPullRequestStates', () => {
	test('returns undefined when no filter is provided', () => {
		assert.equal(toProviderPullRequestStates(undefined), undefined);
	});

	test('returns undefined when an empty include/state list is provided', () => {
		assert.equal(toProviderPullRequestStates([]), undefined);
	});

	test('maps a specific requested state filter', () => {
		assert.deepEqual(toProviderPullRequestStates('open'), [toProviderPullRequestState('opened')]);
	});

	test('maps the item-state vocabulary for search include', () => {
		assert.deepEqual(toProviderPullRequestStates('opened'), [toProviderPullRequestState('opened')]);
	});

	test('maps all requested state filters', () => {
		assert.deepEqual(toProviderPullRequestStates('all'), [
			toProviderPullRequestState('opened'),
			toProviderPullRequestState('closed'),
			toProviderPullRequestState('merged'),
		]);
	});

	test('maps include arrays', () => {
		assert.deepEqual(toProviderPullRequestStates(['opened', 'merged']), [
			toProviderPullRequestState('opened'),
			toProviderPullRequestState('merged'),
		]);
	});

	test('dedupes mixed open/opened vocabulary inputs', () => {
		assert.deepEqual(toProviderPullRequestStates(['open', 'opened', 'merged']), [
			toProviderPullRequestState('opened'),
			toProviderPullRequestState('merged'),
		]);
	});
});

suite('toProviderRepositoryShape', () => {
	function repo(overrides?: Partial<ProviderRepository>): ProviderRepository {
		return {
			id: 'r1',
			namespace: 'octocat',
			name: 'hello',
			webUrl: 'https://github.com/octocat/hello',
			httpsUrl: 'https://github.com/octocat/hello.git',
			sshUrl: 'git@github.com:octocat/hello.git',
			defaultBranch: { name: 'main' },
			permissions: null,
			...overrides,
		};
	}

	test('maps identity, URLs, and default branch from the SDK repo', () => {
		assert.deepEqual(toProviderRepositoryShape(repo({ project: 'proj' })), {
			id: 'r1',
			namespace: 'octocat',
			name: 'hello',
			project: 'proj',
			url: 'https://github.com/octocat/hello',
			cloneUrlHttps: 'https://github.com/octocat/hello.git',
			cloneUrlSsh: 'git@github.com:octocat/hello.git',
			defaultBranch: 'main',
		});
	});

	test('collapses the SDK nullable fields to undefined', () => {
		const shape = toProviderRepositoryShape(
			repo({ webUrl: null, httpsUrl: null, sshUrl: null, defaultBranch: null }),
		);
		assert.equal(shape.url, undefined);
		assert.equal(shape.cloneUrlHttps, undefined);
		assert.equal(shape.cloneUrlSsh, undefined);
		assert.equal(shape.defaultBranch, undefined);
		// A repo with no project layer (non-Azure) leaves `project` absent rather than empty-string.
		assert.equal(shape.project, undefined);
	});
});

/**
 * `\bvisualstudio\.com$` treated a hyphen as a word boundary, so an arbitrary attacker-controlled host
 * (`evil-visualstudio.com`) was classified as Azure cloud, which changes its auth/URL handling. Match only on
 * a real label boundary. The predicate is imported by `utils/integration.utils.ts` rather than duplicated, so
 * both consumers share this behavior.
 */
suite('isAzureCloudDomain', () => {
	test('accepts dev.azure.com and real visualstudio.com labels', () => {
		assert.equal(isAzureCloudDomain('dev.azure.com'), true);
		assert.equal(isAzureCloudDomain('DEV.AZURE.COM'), true);
		assert.equal(isAzureCloudDomain('visualstudio.com'), true);
		assert.equal(isAzureCloudDomain('contoso.visualstudio.com'), true);
	});

	test('rejects hosts that merely end with the suffix across a non-label boundary', () => {
		assert.equal(isAzureCloudDomain('evil-visualstudio.com'), false);
		assert.equal(isAzureCloudDomain('myvisualstudio.com'), false);
		assert.equal(isAzureCloudDomain('notdev.azure.com'), false);
		assert.equal(isAzureCloudDomain('dev.azure.com.evil.test'), false);
		assert.equal(isAzureCloudDomain(undefined), false);
	});
});
