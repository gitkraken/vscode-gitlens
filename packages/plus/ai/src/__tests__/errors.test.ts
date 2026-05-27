import * as assert from 'assert';
import { AIErrorReason, classifyNetworkError } from '../errors.js';

function withCause(message: string, cause: unknown, name = 'Error'): Error {
	const err = new Error(message, { cause: cause });
	err.name = name;
	return err;
}

function withCode(code: string): Error & { code: string } {
	const err = new Error(code) as Error & { code: string };
	err.code = code;
	return err;
}

suite('classifyNetworkError', () => {
	test('returns undefined for non-Error inputs', () => {
		assert.strictEqual(classifyNetworkError(undefined), undefined);
		assert.strictEqual(classifyNetworkError(null), undefined);
		assert.strictEqual(classifyNetworkError('boom'), undefined);
		assert.strictEqual(classifyNetworkError({ code: 'ENOTFOUND' }), undefined);
		assert.strictEqual(classifyNetworkError(42), undefined);
	});

	test('returns undefined for unrelated Errors', () => {
		assert.strictEqual(classifyNetworkError(new Error('boom')), undefined);
		assert.strictEqual(classifyNetworkError(new TypeError('something else')), undefined);
		assert.strictEqual(classifyNetworkError(withCode('EACCES')), undefined);
	});

	test('classifies known no-network codes as NoNetwork', () => {
		for (const code of ['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN']) {
			assert.strictEqual(classifyNetworkError(withCode(code)), AIErrorReason.NoNetwork, code);
		}
	});

	test('classifies UND_ERR_CONNECT_TIMEOUT as NoNetwork', () => {
		assert.strictEqual(classifyNetworkError(withCode('UND_ERR_CONNECT_TIMEOUT')), AIErrorReason.NoNetwork);
	});

	test('classifies known mid-request failure codes as Unreachable', () => {
		for (const code of ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET']) {
			assert.strictEqual(classifyNetworkError(withCode(code)), AIErrorReason.Unreachable, code);
		}
	});

	test('falls back to NoNetwork for `TypeError: fetch failed` with no recognizable cause code', () => {
		const err = new TypeError('fetch failed');
		assert.strictEqual(classifyNetworkError(err), AIErrorReason.NoNetwork);
	});

	test('walks the cause chain — outer wrapper, network code on cause', () => {
		const inner = withCode('ENOTFOUND');
		const outer = withCause('Unable to do thing', inner);
		assert.strictEqual(classifyNetworkError(outer), AIErrorReason.NoNetwork);
	});

	test('walks the cause chain — undici-style TypeError with coded cause', () => {
		const cause = withCode('ECONNRESET');
		const top = new TypeError('fetch failed', { cause: cause });
		assert.strictEqual(classifyNetworkError(top), AIErrorReason.Unreachable);
	});

	test('a specific code on cause wins over the fetch-failed fallback', () => {
		const cause = withCode('ECONNRESET');
		const top = new TypeError('fetch failed', { cause: cause });
		// fallback would say NoNetwork, but ECONNRESET on cause is Unreachable
		assert.strictEqual(classifyNetworkError(top), AIErrorReason.Unreachable);
	});

	test('stops at depth 5 — code at depth 6 returns undefined', () => {
		let current: Error = withCode('ENOTFOUND');
		// depth 5 (the 6th link): build 5 wrappers, so the ENOTFOUND error is at depth 5
		for (let i = 0; i < 5; i++) {
			current = withCause('wrap', current);
		}
		assert.strictEqual(classifyNetworkError(current), undefined);
	});

	test('code at depth 4 (within window) is detected', () => {
		let current: Error = withCode('ENOTFOUND');
		// 4 wrappers, ENOTFOUND ends up at depth 4
		for (let i = 0; i < 4; i++) {
			current = withCause('wrap', current);
		}
		assert.strictEqual(classifyNetworkError(current), AIErrorReason.NoNetwork);
	});

	test('does not loop on self-referencing cause', () => {
		const err = new Error('cycle') as Error & { cause?: unknown };
		err.cause = err;
		// Should terminate (depth limit), and return undefined since no match
		assert.strictEqual(classifyNetworkError(err), undefined);
	});

	test('breaks on non-Error in cause chain', () => {
		const err = withCause('top', { code: 'ENOTFOUND' });
		// Cause is a plain object, not an Error — loop should break and return undefined.
		assert.strictEqual(classifyNetworkError(err), undefined);
	});

	test('non-string code on Error is ignored', () => {
		const err = new Error('weird') as Error & { code: unknown };
		(err as { code: unknown }).code = 42;
		assert.strictEqual(classifyNetworkError(err), undefined);
	});
});
