import * as assert from 'assert';
import type { AIModel } from '../../models/model.js';
import { getValidatedTemperature } from '../ai.utils.js';

function model(id: string, temperature?: number | null): AIModel {
	return {
		id: id,
		name: id,
		maxTokens: { input: 1000, output: 1000 },
		...(temperature !== undefined ? { temperature: temperature } : {}),
	} as unknown as AIModel;
}

suite('plus/ai/utils getValidatedTemperature', () => {
	test('a model opting out of temperature beats a caller-supplied value', () => {
		// The regression: callers merge as `modelOptions?.temperature ?? model.temperature`, and
		// `0 ?? null` is `0` — so conflict resolution's explicit 0 defeated the opt-out and got sent to
		// upstreams that reject any non-default temperature (OpenAI GPT-5 answers 400).
		assert.strictEqual(getValidatedTemperature(model('openai:gpt-5.6-luna', null), 0), undefined);
		assert.strictEqual(getValidatedTemperature(model('anthropic:claude-sonnet-5', null), 0), undefined);
		assert.strictEqual(getValidatedTemperature(model('google:gemini-3-pro', null), 0.7), undefined);
	});

	test('honors an opt-out with no caller value, as before', () => {
		assert.strictEqual(getValidatedTemperature(model('openai:gpt-4o', null), undefined), undefined);
	});

	test('a caller passing null opts out too', () => {
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), null), undefined);
	});

	test('drops temperature for BYOK gpt-5 ids, which carry no opt-out flag', () => {
		// These rely solely on the id check — the shared OpenAI catalog leaves `temperature` unset.
		assert.strictEqual(getValidatedTemperature(model('gpt-5.5'), 0), undefined);
		assert.strictEqual(getValidatedTemperature(model('gpt-5.4-mini'), 0.5), undefined);
	});

	test('passes a caller value through for a model that accepts one', () => {
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), 0), 0);
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), 0.3), 0.3);
	});

	test('falls back to the configured default, clamped to 0..2', () => {
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), undefined, 0.5), 0.5);
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), undefined, -1), 0);
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), undefined, 9), 2);
		assert.strictEqual(getValidatedTemperature(model('gpt-4o'), undefined, undefined), 0.7);
	});
});
