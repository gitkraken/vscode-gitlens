import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId } from '../constants.js';
import { incompleteReadWarning, truncationWarning } from '../reads/warnings.js';
import type { ProviderWarning } from '../results.js';
import { appendDedupedWarning, toProviderWarning } from '../results.js';

suite('provider warning messages', () => {
	test('replaces an HTML gateway response with its status', () => {
		const ex = Object.assign(new Error('<html><body><h1>502 Bad Gateway</h1></body></html>'), {
			status: 502,
		});

		const warning = toProviderWarning(GitCloudHostIntegrationId.GitHub, undefined, 'connection-1', ex);

		assert.equal(warning.message, 'Provider request failed with status 502.');
		assert.doesNotMatch(warning.message, /html|body/i);
	});

	test('caps an oversized provider message', () => {
		const warning = toProviderWarning(
			GitCloudHostIntegrationId.GitLab,
			undefined,
			undefined,
			new Error('x'.repeat(1000)),
		);

		assert.equal(warning.message.length, 500);
		assert.match(warning.message, /\.\.\.$/);
	});

	test('an exception-derived warning never carries an omission', () => {
		// `omission` asserts the request SUCCEEDED. Everything `toProviderWarning` builds comes from a caught
		// exception, so the field must stay absent — including on `other`, which it shares with omissions.
		const warning = toProviderWarning(GitCloudHostIntegrationId.GitHub, undefined, 'c1', new Error('boom'));

		assert.equal(warning.kind, 'other');
		assert.equal(warning.omission, undefined);
	});
});

suite('facade-raised incompleteness warnings', () => {
	const id = GitCloudHostIntegrationId.GitHub;

	test('a read that stopped at its own backstop reports an omission', () => {
		// The facade proves "succeeded but incomplete" from its own paging state here, not from SDK metadata.
		// A consumer must not have to care which layer noticed, so the structured signal has to match.
		const warning = truncationWarning(id, 'github.com', 'c1', 'Pull request', false);

		assert.equal(warning.kind, 'other');
		assert.deepEqual(warning.omission, { kind: 'pagination-incomplete' });
	});

	test('a read that was interrupted mid-drain reports no omission', () => {
		// Both leave an unread tail, but only the backstop is the read CHOOSING to stop. An interruption is a
		// failure that also sets `fetchFailed`, and claiming an omission there would tell a consumer not to
		// retry the one case where retrying is exactly the right move.
		const warning = truncationWarning(id, 'github.com', 'c1', 'Repository', true);

		assert.equal(warning.kind, 'other');
		assert.equal(warning.omission, undefined);
		assert.match(warning.message, /interrupted/, 'and the prose must not call an interruption a truncation');
	});

	test('`failed` is the whole discriminant, whatever the read phrases its message as', () => {
		// Every incompleteness warning the facade raises on its own terms routes through here, so a read with
		// its own prose (the issue-tracker fan-out) cannot drift from the builders above.
		assert.deepEqual(incompleteReadWarning(id, 'github.com', 'c1', 'partial', false).omission, {
			kind: 'pagination-incomplete',
		});
		assert.equal(incompleteReadWarning(id, 'github.com', 'c1', 'partial', true).omission, undefined);
	});
});

suite('provider warning dedup', () => {
	function warning(message: string, omission?: ProviderWarning['omission']): ProviderWarning {
		return {
			providerId: GitCloudHostIntegrationId.GitHub,
			domain: 'github.com',
			connectionId: 'c1',
			message: message,
			kind: 'other',
			isAuth: false,
			omission: omission,
		};
	}

	test('warnings without an omission dedup exactly as they did before the field existed', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('same'));
		appendDedupedWarning(into, warning('same'));
		appendDedupedWarning(into, warning('different'));

		assert.equal(into.length, 2);
	});

	test('two omissions that differ only structurally stay two warnings', () => {
		// The premise of `omission` is that consumers must not depend on prose carrying the distinguishing
		// fact — so neither may the dedup key. Same message on purpose: today's messages happen to differ per
		// kind, and this pins that the key does not rely on that accident.
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000 }));
		appendDedupedWarning(into, warning('incomplete', { kind: 'recovery-budget', limit: 1000 }));
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000, totalCount: 1393 }));
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000 }));

		assert.equal(into.length, 3, 'kind and totalCount each discriminate; the exact repeat collapses');
	});

	test('an omission-bearing warning is distinct from an otherwise identical one without it', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('incomplete'));
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000 }));

		assert.equal(into.length, 2, 'the structured signal is part of the warning identity');
	});

	test('a message cannot impersonate the omission segment of the key', () => {
		// `message` is the only free-form segment, so it stays last in the key. Pinned because appending any
		// field after it would let provider prose ending in that field's text collide with a real warning.
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('capped', { kind: 'provider-limit', limit: 1000 }));
		appendDedupedWarning(into, warning('provider-limit 1000    capped'));

		assert.equal(into.length, 2, 'a crafted message must not dedup against a structurally different warning');
	});

	test('omissions differing only by scope stay separate', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'a' } }));
		appendDedupedWarning(into, warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'b' } }));
		// A repository id under one provider and a project id under another are different scopes, not one.
		appendDedupedWarning(into, warning('more', { kind: 'pagination-incomplete', scope: { projectId: 'a' } }));
		appendDedupedWarning(into, warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'a' } }));

		assert.equal(into.length, 3);
	});
});
