import * as assert from 'assert';
import type { BYOKUsage } from '../byokUsage.utils.js';
import { aggregateBYOKUsage } from '../byokUsage.utils.js';

function usage(overrides: Partial<BYOKUsage>): BYOKUsage {
	return {
		provider: 'openai',
		model: 'test-model',
		action: 'conflict-resolution',
		totalTokens: 0,
		inputTokens: 0,
		...overrides,
	};
}

suite('aggregateBYOKUsage', () => {
	test('returns undefined for no buckets', () => {
		assert.strictEqual(aggregateBYOKUsage([]), undefined);
	});

	test('returns undefined when the summed total is below the API minimum of 1', () => {
		assert.strictEqual(aggregateBYOKUsage([usage({ totalTokens: 0, inputTokens: 0 })]), undefined);
	});

	test('passes a single bucket through unchanged', () => {
		const result = aggregateBYOKUsage([usage({ totalTokens: 100, inputTokens: 60 })]);
		assert.deepStrictEqual(result, usage({ totalTokens: 100, inputTokens: 60 }));
	});

	test('sums tokens across buckets and attributes to the dominant model', () => {
		const result = aggregateBYOKUsage([
			usage({ provider: 'openai', model: 'small', totalTokens: 100, inputTokens: 70 }),
			usage({ provider: 'anthropic', model: 'large', totalTokens: 900, inputTokens: 500 }),
			usage({ provider: 'openai', model: 'medium', totalTokens: 300, inputTokens: 200 }),
		]);
		assert.deepStrictEqual(result, {
			provider: 'anthropic',
			model: 'large',
			action: 'conflict-resolution',
			totalTokens: 1300,
			inputTokens: 770,
		});
	});

	test('keeps a zero-usage bucket from masking reportable usage', () => {
		const result = aggregateBYOKUsage([
			usage({ totalTokens: 0, inputTokens: 0 }),
			usage({ model: 'used', totalTokens: 5, inputTokens: 2 }),
		]);
		assert.deepStrictEqual(result, usage({ model: 'used', totalTokens: 5, inputTokens: 2 }));
	});
});
