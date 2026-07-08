import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { PagingMode, resolveProviderScope } from '../models.js';

/**
 * Covers the org/project scope façade (#5435): a single ProviderScope resolves to the provider-appropriate
 * inputs based on the provider's PagingMode.
 */
suite('resolveProviderScope (#5435)', () => {
	test('project-mode providers produce projectInputs from org + project', () => {
		const result = resolveProviderScope({ org: 'my-org', project: 'my-proj' }, PagingMode.Project);
		assert.deepEqual(result, { projectInputs: [{ namespace: 'my-org', project: 'my-proj' }] });
	});

	test('project-mode without org/project yields no inputs', () => {
		assert.deepEqual(resolveProviderScope({ org: 'my-org' }, PagingMode.Project), {});
	});

	test('repo-mode providers produce a repo input list carrying the project', () => {
		const result = resolveProviderScope(
			{ project: 'my-proj', repos: [{ key: 'a', owner: 'o', name: 'r' }] },
			PagingMode.Repo,
		);
		assert.deepEqual(result, { reposInput: [{ namespace: 'o', name: 'r', project: 'my-proj' }] });
	});

	test('repos-mode with no repos yields an undefined repos input', () => {
		assert.deepEqual(resolveProviderScope({ org: 'o' }, PagingMode.Repos), { reposInput: undefined });
	});
});
