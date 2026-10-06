import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import {
	AuthenticationError,
	AuthenticationErrorReason,
	RequestNotFoundError,
	RequestRateLimitError,
} from '@gitlens/git/errors.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { assessCollectionMetadata, toCollectionFailureError, toCollectionScopeFailure } from '../collectionMetadata.js';
import { GitSelfManagedHostIntegrationId } from '../constants.js';
import { isProviderUnreachableError, ProviderFetchError } from '../errors.js';
import { toProviderWarning } from '../results.js';

const providerId = GitSelfManagedHostIntegrationId.AzureDevOpsServer;

suite('provider unreachable classification', () => {
	for (const code of [
		'ECONNREFUSED',
		'ECONNRESET',
		'ENOTFOUND',
		'EAI_AGAIN',
		'ETIMEDOUT',
		'UND_ERR_CONNECT_TIMEOUT',
		'UND_ERR_SOCKET',
		'ERR_TLS_CERT_ALTNAME_INVALID',
		'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
	]) {
		test(`recognizes a wrapped ${code}`, () => {
			const ex = new Error('Request failed', {
				cause: new TypeError('Transport wrapper', {
					cause: Object.assign(new Error('transport'), { code: code }),
				}),
			});
			assert.equal(isProviderUnreachableError(ex), true);
		});
	}

	test('recognizes timeout and transport abort wrappers, but leaves caller cancellation alone', () => {
		assert.equal(isProviderUnreachableError(new DOMException('Timed out', 'TimeoutError')), true);
		assert.equal(
			isProviderUnreachableError(new CancellationError(new DOMException('Aborted', 'AbortError'))),
			true,
		);
		assert.equal(isProviderUnreachableError(new CancellationError(undefined, 'timeout')), true);
		assert.equal(isProviderUnreachableError(new CancellationError(undefined, 'aborted')), false);
		assert.equal(isProviderUnreachableError(new CancellationError()), false);
	});

	test('recognizes the fetch messages of Node and browsers without classifying arbitrary TypeErrors', () => {
		for (const message of [
			'fetch failed',
			'Failed to fetch',
			'Network request failed',
			'Load failed',
			'NetworkError when attempting to fetch resource.',
		]) {
			assert.equal(isProviderUnreachableError(new TypeError(message)), true);
		}
		assert.equal(isProviderUnreachableError(new TypeError('Cannot read properties of undefined')), false);
		assert.equal(isProviderUnreachableError(new Error('Request failed')), false);
		assert.equal(isProviderUnreachableError(new SyntaxError('Unexpected token')), false);
	});

	test('walks original, cause and aggregate errors without following a cycle forever', () => {
		const ex = Object.assign(new Error('Wrapper'), {
			original: Object.assign(new Error('Wrapper'), { code: 'ENOTFOUND' }),
		});
		assert.equal(isProviderUnreachableError(ex), true);
		assert.equal(isProviderUnreachableError(new AggregateError([new Error('Other'), ex])), true);
		const cycle = new Error('Wrapper', { cause: undefined });
		cycle.cause = cycle;
		assert.equal(isProviderUnreachableError(cycle), false);
	});

	test('preserves the cause when a network error becomes a partial scope failure', () => {
		const scope = { resourceId: 'collection', projectId: 'project' };
		const ex = Object.assign(new Error('Transport failed'), { code: 'ECONNREFUSED' });
		const result = assessCollectionMetadata(providerId, 'server.example.com', 'connection', {
			completeness: 'partial',
			failures: [toCollectionScopeFailure(scope, ex)],
		});
		assert.equal(result.fetchFailed, true);
		assert.deepEqual(
			result.warnings.map(w => ({ kind: w.kind, isAuth: w.isAuth, cause: w.cause, scope: w.scope })),
			[{ kind: 'other', isAuth: false, cause: { reason: 'unreachable' }, scope: scope }],
		);
	});

	test('recovers unreachable from SDK failures that retain only the status or fetch message', () => {
		for (const message of ['(502) Bad Gateway.', '(503) Service Unavailable.', 'fetch failed']) {
			const result = assessCollectionMetadata(providerId, 'server.example.com', 'connection', {
				completeness: 'partial',
				failures: [{ scope: {}, kind: 'provider', message: message }],
			});
			assert.equal(result.fetchFailed, true);
			assert.deepEqual(result.warnings[0].cause, { reason: 'unreachable' });
			assert.match(result.warnings[0].message, /the provider server could not be reached/);
		}
	});

	test('preserves SDK network failures through metadata and promotion back to errors', () => {
		const scope = { resourceId: 'collection', projectId: 'project' };
		const token = {
			accessToken: 'token',
			providerId: providerId,
			cloud: true,
			type: 'pat' as const,
			microHash: 'hash',
			scopes: undefined,
		};
		const failures = [
			toCollectionScopeFailure(scope, Object.assign(new Error('Transport failed'), { code: 'ECONNREFUSED' })),
			{ scope: scope, kind: 'network' as const, message: 'The request timed out' },
			{ scope: scope, kind: 'network' as const },
			{ scope: scope, kind: 'provider' as const, message: '(503) Service Unavailable.' },
		];
		for (const failure of failures) {
			const metadata = assessCollectionMetadata(providerId, undefined, undefined, {
				completeness: 'partial',
				failures: [failure],
			});
			assert.deepEqual(metadata.warnings[0].cause, { reason: 'unreachable' });
			assert.match(metadata.warnings[0].message, /the provider server could not be reached/);
			const warning = toProviderWarning(
				providerId,
				undefined,
				undefined,
				toCollectionFailureError(failure, token),
			);
			assert.equal(warning.kind, 'other');
			assert.equal(warning.isAuth, false);
			assert.deepEqual(warning.cause, { reason: 'unreachable' });
		}
	});

	test('recognizes direct-fetch and SDK server responses while keeping client responses separate', () => {
		for (const status of [500, 502, 503, 504]) {
			assert.equal(
				isProviderUnreachableError(
					new ProviderFetchError('AzureDevOps', new Response(null, { status: status })),
				),
				true,
			);
			assert.equal(
				isProviderUnreachableError(Object.assign(new Error(), { response: { status: status } })),
				true,
			);
		}
		for (const status of [400, 401, 403, 404, 429]) {
			assert.equal(
				isProviderUnreachableError(Object.assign(new Error('fetch failed'), { status: status })),
				false,
			);
		}
	});

	test('keeps auth, rate-limit and not-found classifications even when the original has network-shaped text', () => {
		const original = new TypeError('fetch failed');
		const errors = [
			{
				kind: 'auth',
				ex: new AuthenticationError(
					{ providerId: providerId, cloud: true, type: 'pat', microHash: 'hash' },
					AuthenticationErrorReason.Unauthorized,
					original,
				),
			},
			{ kind: 'rate-limit', ex: new RequestRateLimitError(original, undefined, undefined) },
			{ kind: 'not-found', ex: new RequestNotFoundError(original) },
		];
		for (const { kind, ex } of errors) {
			const warning = toProviderWarning(providerId, 'server.example.com', 'connection', ex);
			assert.equal(warning.kind, kind);
			assert.equal(warning.isAuth, kind === 'auth');
			assert.equal(warning.cause, undefined);
		}
	});
});
