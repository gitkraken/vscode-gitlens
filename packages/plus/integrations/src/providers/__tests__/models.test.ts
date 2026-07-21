import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import type { ProviderPullRequest } from '../models.js';
import {
	providerPullRequestMatchesSearch,
	toProviderPullRequestState,
	toProviderPullRequestStates,
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

	test('returns undefined when an empty state list is provided', () => {
		assert.equal(toProviderPullRequestStates([]), undefined);
	});

	test('maps a specific requested state', () => {
		assert.deepEqual(toProviderPullRequestStates('open'), [toProviderPullRequestState('opened')]);
	});

	test('maps all requested states', () => {
		assert.deepEqual(toProviderPullRequestStates('all'), [
			toProviderPullRequestState('opened'),
			toProviderPullRequestState('closed'),
			toProviderPullRequestState('merged'),
		]);
	});
});
