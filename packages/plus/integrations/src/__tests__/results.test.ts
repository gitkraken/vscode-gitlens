import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { GitCloudHostIntegrationId } from '../constants.js';
import type { IncompleteReadCause } from '../reads/warnings.js';
import { incompleteReadWarning, truncationWarning } from '../reads/warnings.js';
import type { ProviderWarning } from '../results.js';
import { appendDedupedWarning, reconcileOmissionsWithFailure, toProviderWarning } from '../results.js';

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

	test('a drain that spent its page budget says the rest can still be read', () => {
		// The one recoverable stop: the provider has more AND handed back a usable cursor, so raising
		// `maxPages` returns the missing items. This is the case a "load more" affordance is FOR.
		const warning = truncationWarning(id, 'github.com', 'c1', 'Pull request', 'page-budget');

		assert.equal(warning.kind, 'other');
		assert.deepEqual(warning.omission, { kind: 'pagination-incomplete', recovery: 'page-budget' });
	});

	test('a read with nothing left to continue from says so, on the same kind', () => {
		// Same `kind` as the case above and the same unread tail, which is exactly why `kind` cannot be the
		// discriminant: nothing the consumer can call returns these items, so offering "load more" would be a
		// button that does nothing.
		const warning = truncationWarning(id, 'github.com', 'c1', 'Pull request', 'exhausted');

		assert.equal(warning.omission?.kind, 'pagination-incomplete', 'the two share a kind on purpose');
		assert.equal(warning.omission?.recovery, 'none');
	});

	test('a read that was interrupted mid-drain reports no omission at all', () => {
		// A third outcome with the same unread tail. It is a failure — it sets `fetchFailed` — so it gets no
		// omission: claiming one would tell a consumer not to retry the one case where retrying is right.
		const warning = truncationWarning(id, 'github.com', 'c1', 'Repository', 'interrupted');

		assert.equal(warning.kind, 'other');
		assert.equal(warning.omission, undefined);
		assert.match(warning.message, /reported a failure/, 'and the prose must say so, not call it a truncation');
	});

	test('each cause gets its own wording, so the message never contradicts the signal', () => {
		const messages = (['page-budget', 'exhausted', 'interrupted'] as const).map(
			cause => truncationWarning(id, 'github.com', 'c1', 'Issue', cause).message,
		);

		const [budget, exhausted, interrupted] = messages;
		assert.equal(new Set(messages).size, 3, 'three distinct causes must not share one sentence');
		// The recoverable one may invite a bigger budget; the other two must not, or the prose contradicts the
		// `recovery` they carry.
		assert.match(budget, /raising it/);
		assert.doesNotMatch(exhausted, /raising it/);
		assert.doesNotMatch(interrupted, /raising it/);
		assert.match(exhausted, /cannot be continued/);
	});

	test('the cause is the whole discriminant, whatever prose a read supplies', () => {
		// Every incompleteness warning the facade raises on its own terms routes through here, so a read with
		// its own wording (the issue-tracker fan-out) cannot drift from the builders above.
		const omissionFor = (cause: IncompleteReadCause) =>
			incompleteReadWarning(id, 'github.com', 'c1', 'partial', cause).omission;

		assert.deepEqual(omissionFor('page-budget'), { kind: 'pagination-incomplete', recovery: 'page-budget' });
		assert.deepEqual(omissionFor('exhausted'), { kind: 'pagination-incomplete', recovery: 'none' });
		assert.equal(omissionFor('interrupted'), undefined);
	});

	test('a facade-raised omission never attributes a scope, having none to name', () => {
		// These apply to the whole read, not to one repository or project — so a consumer acting on `recovery`
		// re-runs the read itself and never mistakes this for a per-scope remedy.
		for (const cause of ['page-budget', 'exhausted'] as const) {
			assert.equal(truncationWarning(id, 'github.com', 'c1', 'Issue', cause).omission?.scope, undefined);
		}
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
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000, recovery: 'none' }));
		appendDedupedWarning(into, warning('incomplete', { kind: 'recovery-budget', limit: 1000, recovery: 'none' }));
		appendDedupedWarning(
			into,
			warning('incomplete', { kind: 'provider-limit', limit: 1000, totalCount: 1393, recovery: 'none' }),
		);
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000, recovery: 'none' }));

		assert.equal(into.length, 3, 'kind and totalCount each discriminate; the exact repeat collapses');
	});

	test('an omission-bearing warning is distinct from an otherwise identical one without it', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('incomplete'));
		appendDedupedWarning(into, warning('incomplete', { kind: 'provider-limit', limit: 1000, recovery: 'none' }));

		assert.equal(into.length, 2, 'the structured signal is part of the warning identity');
	});

	test('a message cannot impersonate the omission segment of the key', () => {
		// `message` is the only free-form segment, so it stays last in the key. Pinned because appending any
		// field after it would let provider prose ending in that field's text collide with a real warning.
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('capped', { kind: 'provider-limit', limit: 1000, recovery: 'none' }));
		appendDedupedWarning(into, warning('provider-limit 1000    capped'));

		assert.equal(into.length, 2, 'a crafted message must not dedup against a structurally different warning');
	});

	test('retracting omissions on a failure re-dedups what the omission used to keep apart', () => {
		// The omission is part of a warning's identity, so two warnings the key separated ONLY there become
		// identical once it is stripped. Reachable because a message can be identical while the structure
		// differs — `collectionOmissionMessage` derives a `pagination-incomplete` message from `scope` alone,
		// so two pages reporting the same scope with different figures arrive as two warnings.
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('more', { kind: 'pagination-incomplete', recovery: 'none' }));
		appendDedupedWarning(
			into,
			warning('more', { kind: 'pagination-incomplete', recovery: 'none', totalCount: 50 }),
		);
		assert.equal(into.length, 2, 'distinct while the structure distinguishes them');

		reconcileOmissionsWithFailure(into, true);

		assert.equal(into.length, 1, 'and one warning once it no longer does');
		assert.equal(into[0].omission, undefined);
	});

	test('reconciling a read that did NOT fail leaves every omission intact', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(into, warning('capped', { kind: 'pagination-incomplete', recovery: 'page-budget' }));

		reconcileOmissionsWithFailure(into, false);

		assert.deepEqual(into[0].omission, { kind: 'pagination-incomplete', recovery: 'page-budget' });
	});

	test('omissions differing only by scope stay separate', () => {
		const into: ProviderWarning[] = [];
		appendDedupedWarning(
			into,
			warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'a' }, recovery: 'none' }),
		);
		appendDedupedWarning(
			into,
			warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'b' }, recovery: 'none' }),
		);
		// A repository id under one provider and a project id under another are different scopes, not one.
		appendDedupedWarning(
			into,
			warning('more', { kind: 'pagination-incomplete', scope: { projectId: 'a' }, recovery: 'none' }),
		);
		appendDedupedWarning(
			into,
			warning('more', { kind: 'pagination-incomplete', scope: { repositoryId: 'a' }, recovery: 'none' }),
		);

		assert.equal(into.length, 3);
	});
});
