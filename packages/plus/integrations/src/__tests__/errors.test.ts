import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { isRateLimitResponse, ProviderFetchError } from '../errors.js';

function errorResponse(status: number, statusText: string, body?: string, contentType?: string): Response {
	return new Response(body ?? null, {
		status: status,
		statusText: statusText,
		headers: contentType != null ? { 'content-type': contentType } : undefined,
	});
}

suite('ProviderFetchError body capture', () => {
	// The regression this guards: the direct-fetch clients built the error from the status line alone, so the
	// message read "(403) Forbidden." and the rate-limit check below it could never match — dead code on every
	// provider that does not go through an SDK.
	test('folds the upstream body into the message so a throttle stays distinguishable', async () => {
		const ex = await ProviderFetchError.fromResponse(
			'AzureDevOps',
			errorResponse(
				403,
				'Forbidden',
				JSON.stringify({
					message:
						"TF400733: The request has been canceled: Request was blocked due to exceeding usage of resource 'RateLimit'.",
				}),
				'application/json',
			),
		);

		assert.match(ex.message, /AzureDevOps request failed: \(403\) Forbidden\./);
		assert.match(ex.message, /RateLimit/);
		assert.equal(isRateLimitResponse(ex), true);
	});

	test('reads Bitbucket’s nested error shape', async () => {
		const ex = await ProviderFetchError.fromResponse(
			'Bitbucket',
			errorResponse(
				403,
				'Forbidden',
				JSON.stringify({ error: { message: 'API rate limit exceeded' } }),
				'application/json',
			),
		);

		assert.equal(isRateLimitResponse(ex), true);
	});

	test('reads a bare-text body', async () => {
		// Bitbucket sends the throttle message as plain text, with no JSON envelope at all.
		const ex = await ProviderFetchError.fromResponse(
			'Bitbucket',
			errorResponse(429, 'Too Many Requests', 'Rate limit for this resource has been exceeded'),
		);

		assert.match(ex.message, /Rate limit for this resource has been exceeded/);
	});

	test('reads GitLab’s string-valued error field', async () => {
		const ex = await ProviderFetchError.fromResponse(
			'GitLab',
			errorResponse(403, 'Forbidden', JSON.stringify({ error: 'rate limit exceeded' }), 'application/json'),
		);

		assert.equal(isRateLimitResponse(ex), true);
	});

	test('leaves a genuine permission failure classified as one', async () => {
		const ex = await ProviderFetchError.fromResponse(
			'Bitbucket',
			errorResponse(
				403,
				'Forbidden',
				JSON.stringify({ error: { message: 'Your credentials lack one or more required privilege scopes.' } }),
				'application/json',
			),
		);

		// The whole point of reading the body is that it separates the two; a 403 that is really a permission
		// failure must not start reporting as a retryable throttle.
		assert.equal(isRateLimitResponse(ex), false);
	});

	test('preserves status and statusText accessors', async () => {
		const ex = await ProviderFetchError.fromResponse('GitLab', errorResponse(500, 'Internal Server Error'));

		assert.equal(ex.status, 500);
		assert.equal(ex.statusText, 'Internal Server Error');
	});

	// Best-effort by contract: the body is a nicety, never a reason to lose the error.
	test('degrades to the status line for an empty, unparseable or consumed body', async () => {
		const empty = await ProviderFetchError.fromResponse('GitLab', errorResponse(403, 'Forbidden', ''));
		assert.equal(empty.message, 'GitLab request failed: (403) Forbidden. ');

		const html = await ProviderFetchError.fromResponse(
			'GitLab',
			errorResponse(502, 'Bad Gateway', '<html><body>nope</body></html>', 'text/html'),
		);
		assert.match(html.message, /nope/);

		const consumed = errorResponse(403, 'Forbidden', 'already read');
		await consumed.text();
		const reused = await ProviderFetchError.fromResponse('GitLab', consumed);
		assert.equal(reused.message, 'GitLab request failed: (403) Forbidden. ');
	});

	test('caps an oversized body so an error page cannot become the message', async () => {
		const ex = await ProviderFetchError.fromResponse(
			'GitLab',
			errorResponse(500, 'Internal Server Error', 'x'.repeat(5000)),
		);

		assert.ok(ex.message.length < 700, `message was ${ex.message.length} chars`);
	});
});

suite('isRateLimitResponse', () => {
	test('treats 429 as decisive regardless of message', () => {
		// Azure and Bitbucket Cloud both document 429 for throttling, and Bitbucket's body is bare text that a
		// caller may not have captured — so the status alone has to be enough.
		assert.equal(isRateLimitResponse({ status: 429 }), true);
		assert.equal(isRateLimitResponse({ status: 429, message: 'no useful text' }), true);
	});

	test('matches the wordings hosts actually use on 403', () => {
		for (const message of [
			'API rate limit exceeded for user ID 1',
			'You have exceeded a secondary rate limit',
			'rate limit exceeded',
			"Request was blocked due to exceeding usage of resource 'RateLimit'",
		]) {
			assert.equal(isRateLimitResponse({ status: 403, message: message }), true, message);
		}
	});

	test('does not claim a permission failure is a throttle', () => {
		assert.equal(isRateLimitResponse({ status: 403, message: 'Forbidden' }), false);
		assert.equal(isRateLimitResponse({ status: 403 }), false);
		assert.equal(
			isRateLimitResponse({
				status: 403,
				message: 'Your credentials lack one or more required privilege scopes.',
			}),
			false,
		);
	});
});
