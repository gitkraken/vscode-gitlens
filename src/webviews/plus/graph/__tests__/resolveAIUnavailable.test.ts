import * as assert from 'assert';
import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import { classifyResolveRunErrors } from '../resolveAIUnavailable.js';

const aiResolution = { descriptionKind: undefined };
const bothDeleted = { descriptionKind: 'automatic-both-deleted' };

function quota(filePath: string) {
	return { filePath: filePath, error: new AIError(AIErrorReason.UserQuotaExceeded) };
}

function unreachable(filePath: string) {
	return { filePath: filePath, error: new AIError(AIErrorReason.Unreachable) };
}

suite('resolveAIUnavailable — classifyResolveRunErrors', () => {
	test('leaves ordinary per-file failures alone', () => {
		// `RequestTooLarge` belongs to the one request — another file may well succeed, so each row keeps its text.
		const result = classifyResolveRunErrors(
			[],
			[{ filePath: 'a.ts', error: new AIError(AIErrorReason.RequestTooLarge) }],
			false,
		);

		assert.deepStrictEqual(result, { errors: [{ filePath: 'a.ts', message: 'The request is too large' }] });
	});

	test('reports one run-level error when AI was unavailable and resolved nothing', () => {
		const result = classifyResolveRunErrors([], [quota('a.ts'), quota('b.ts'), quota('c.ts')], true);

		assert.ok('error' in result, 'a run AI resolved nothing in must surface as a single error');
		assert.match(result.error.message, /3 files weren’t resolved/);
		assert.match(result.error.message, /weekly AI usage included in your plan/);
		assert.doesNotMatch(result.error.message, /token limit/, 'the stale quota text must not reach the user');
		assert.strictEqual(result.error.action, 'purchase-credits');
	});

	test('automatic both-deleted resolutions are not AI work, so they don’t keep the run alive', () => {
		const result = classifyResolveRunErrors([bothDeleted], [unreachable('a.ts'), unreachable('b.ts')], false);

		assert.ok('error' in result);
		assert.strictEqual(result.error.action, undefined);
		assert.match(result.error.message, /temporarily unreachable/);
	});

	test('keeps resolved work and moves the shared reason to one run-level notice', () => {
		const result = classifyResolveRunErrors(
			[aiResolution],
			[
				{ filePath: 'big.ts', error: new AIError(AIErrorReason.RequestTooLarge) },
				unreachable('a.ts'),
				// In-flight files fail with their own instance of the same reason — each must still be recognized.
				unreachable('b.ts'),
			],
			false,
		);

		assert.ok('errors' in result, 'a run with AI resolutions must not be thrown away');
		assert.deepStrictEqual(result.aiUnavailable, { message: 'The AI service is temporarily unreachable.' });
		assert.deepStrictEqual(result.errors, [
			{ filePath: 'big.ts', message: 'The request is too large' },
			{ filePath: 'a.ts' },
			{ filePath: 'b.ts' },
		]);
	});

	test('quota: offers Get More Credits only to users who may buy them', () => {
		const buyer = classifyResolveRunErrors([aiResolution], [quota('a.ts')], true);
		assert.ok('errors' in buyer);
		assert.strictEqual(buyer.aiUnavailable?.action, 'purchase-credits');
		assert.match(buyer.aiUnavailable.message, /Purchase more AI credits/);

		const member = classifyResolveRunErrors([aiResolution], [quota('a.ts')], false);
		assert.ok('errors' in member);
		assert.strictEqual(member.aiUnavailable?.action, undefined);
		assert.match(member.aiUnavailable!.message, /Contact your organization admin or owner/);
	});

	test('a non-quota reason never offers credits, even to a buyer', () => {
		const result = classifyResolveRunErrors([aiResolution], [unreachable('a.ts')], true);

		assert.ok('errors' in result);
		assert.strictEqual(result.aiUnavailable?.action, undefined);
	});
});
