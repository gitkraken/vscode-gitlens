import * as assert from 'assert';
import type { AIResponseFormat } from '@gitlens/ai/models/provider.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { createAiModelPort } from '../integration.js';
import type { AiGenerateParams } from '../types.js';

const source: Source = { source: 'commandPalette' };

const responseFormat: AIResponseFormat = {
	name: 'compose_group_result',
	schema: {
		type: 'object',
		additionalProperties: false,
		required: ['branches'],
		properties: { branches: { type: 'array', items: { type: 'string' } } },
	},
};

/**
 * Records the options `createAiModelPort` forwards to `sendRequest` and replies with `response`.
 * Only the members the adapter touches are stubbed.
 */
function makeContainer(response: Record<string, unknown>): {
	container: Container;
	sent: () => Record<string, unknown> | undefined;
} {
	let sent: Record<string, unknown> | undefined;
	const container = {
		ai: {
			sendRequest: (
				_action: string,
				_model: undefined,
				_provider: unknown,
				_source: Source,
				options: Record<string, unknown>,
			) => {
				sent = options;
				return Promise.resolve({ promise: Promise.resolve(response) });
			},
		},
	} as unknown as Container;

	return { container: container, sent: () => sent };
}

function params(): AiGenerateParams {
	return { messages: [{ role: 'user', content: 'go' }] };
}

suite('compose createAiModelPort', () => {
	test('forwards the advisory response format to sendRequest', async () => {
		const { container, sent } = makeContainer({ content: '{}' });

		// The published @gitkraken/shared-tools port doesn't carry `responseFormat` yet, so the
		// adapter reads it through a cast — mirror that here until the dependency ships the field
		const withFormat: AiGenerateParams & { responseFormat?: AIResponseFormat } = params();
		withFormat.responseFormat = responseFormat;

		await createAiModelPort(container, source).generate(withFormat);

		assert.deepStrictEqual(sent()?.responseFormat, responseFormat);
	});

	test('omits the response format when the caller supplies none', async () => {
		const { container, sent } = makeContainer({ content: '{}' });

		await createAiModelPort(container, source).generate(params());

		assert.strictEqual(sent()?.responseFormat, undefined);
	});

	test('surfaces an abnormal finish reason so the caller can retry or fail fast', async () => {
		const { container } = makeContainer({ content: 'cut off', finishReason: 'length' });

		const result = await createAiModelPort(container, source).generate(params());

		assert.strictEqual((result as { finishReason?: string }).finishReason, 'length');
		assert.strictEqual(result.text, 'cut off');
	});

	test('omits finishReason on a normal completion', async () => {
		const { container } = makeContainer({ content: 'done' });

		const result = await createAiModelPort(container, source).generate(params());

		assert.strictEqual('finishReason' in result, false);
	});

	test('maps token usage from the provider response', async () => {
		const { container } = makeContainer({
			content: '{}',
			usage: { promptTokens: 12, completionTokens: 34 },
		});

		const result = await createAiModelPort(container, source).generate(params());

		assert.deepStrictEqual(result.usage, { inputTokens: 12, outputTokens: 34 });
	});
});
