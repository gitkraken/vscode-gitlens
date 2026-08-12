import * as assert from 'node:assert/strict';
import { InvalidRequestError, UnsupportedSortError } from '@gitkraken/provider-apis';
import { suite, test } from 'mocha';
import { throwIfCallerContractError } from '../collectionMetadata.js';

/**
 * Pins the set of SDK errors a fan-out must NOT degrade into a per-scope failure.
 *
 * The SDK keeps its own list (`CALLER_CONTRACT_ERROR_CODES`), and the two sides can only drift silently: an SDK
 * bump that adds a code leaves this helper recording N identical `CollectionScopeFailure`s and an empty `partial`
 * page for a call that was invalid before the first request went out. These use the SDK's real classes, so the
 * recognition path under test is the `code` discriminator the helper actually relies on — the classes reached
 * through the root and through `/providers` are different objects, so `instanceof` would not hold.
 */
suite('caller-contract errors', () => {
	test('an unsupported sort is re-thrown rather than degraded', () => {
		const ex = new UnsupportedSortError('jira', 'priority:desc', ['created:desc']);

		assert.throws(
			() => throwIfCallerContractError(ex),
			(thrown: unknown) => thrown === ex,
		);
	});

	test('an invalid request is re-thrown rather than degraded', () => {
		const ex = new InvalidRequestError('jira', 'Jira requires at least one project key for this function.');

		assert.throws(
			() => throwIfCallerContractError(ex),
			(thrown: unknown) => thrown === ex,
		);
	});

	test('an ordinary per-scope failure passes through, so its siblings survive', () => {
		// The other half of the contract: auth, rate limits and a missing project really did happen to one scope,
		// and re-throwing those would discard the scopes that succeeded.
		assert.doesNotThrow(() => throwIfCallerContractError(new Error('Bad credentials')));
		assert.doesNotThrow(() => throwIfCallerContractError(undefined));
	});
});
