import * as assert from 'node:assert';
import type { AIModel } from '../../models/model.js';
import type { AIFinishReason, AIResponseFormat } from '../../models/provider.js';
import { AnthropicProvider } from '../anthropicProvider.js';
import { DeepSeekProvider } from '../deepSeekProvider.js';
import { GitKrakenProvider } from '../gitkrakenProvider.js';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../openAICompatibleProviderBase.js';
import { OpenAIProvider } from '../openaiProvider.js';
import { OpenRouterProvider } from '../openRouterProvider.js';
import { XAIProvider } from '../xaiProvider.js';
import { createStubProviderContext } from './fixtures.js';

const context = createStubProviderContext();

const responseFormat: AIResponseFormat = {
	name: 'test_schema',
	schema: {
		type: 'object',
		additionalProperties: false,
		required: ['value'],
		properties: { value: { type: 'string' } },
	},
};

// Widens access to the protected translation hooks under test
interface ResponseFormatHooks {
	supportsResponseFormat(model: AIModel): boolean;
	applyResponseFormat(request: ChatCompletionRequest, model: AIModel, responseFormat: AIResponseFormat): void;
	isResponseFormatRejection(status: number, body: string): boolean;
	extractContent(data: ChatCompletionResponse): string;
	extractFinishReason(data: ChatCompletionResponse): AIFinishReason | undefined;
}

function hooks(provider: unknown): ResponseFormatHooks {
	return provider as ResponseFormatHooks;
}

function model(id: string, overrides?: Partial<AIModel>): AIModel {
	return {
		id: id,
		name: id,
		maxTokens: { input: 100000, output: 8192 },
		provider: { id: 'openai', name: 'OpenAI' },
		...overrides,
	};
}

function request(): ChatCompletionRequest {
	return { model: 'test', messages: [] };
}

async function registryModel(provider: { getModels(): Promise<readonly AIModel[]> }, id: string): Promise<AIModel> {
	const m = (await provider.getModels()).find(m => m.id === id);
	assert.ok(m, `model '${id}' not found in the registry`);
	return m;
}

suite('OpenAI-flavor response format translation', () => {
	const openai = new OpenAIProvider(context);
	const provider = hooks(openai);

	test('sets the OpenAI json_schema envelope, always strict', () => {
		const rq = request();
		provider.applyResponseFormat(rq, model('gpt-4o'), responseFormat);

		assert.deepStrictEqual(rq.response_format, {
			type: 'json_schema',
			json_schema: { name: 'test_schema', strict: true, schema: responseFormat.schema },
		});
		assert.strictEqual(rq.output_config, undefined);
	});

	test('gates off legacy registry models that reject json_schema', async () => {
		for (const id of [
			'gpt-3.5-turbo',
			'gpt-4',
			'gpt-4-turbo',
			'gpt-4-0613',
			'gpt-4o-2024-05-13',
			'chatgpt-4o-latest',
			'o1-preview',
			'o1-mini',
		]) {
			assert.strictEqual(provider.supportsResponseFormat(await registryModel(openai, id)), false, id);
		}
	});

	test('supports modern registry models', async () => {
		for (const id of [
			'gpt-4o',
			'gpt-4o-mini',
			'gpt-4.1',
			'gpt-5',
			'gpt-5.5',
			'gpt-5.6',
			'gpt-5.6-terra',
			'gpt-5.6-luna',
			'o1',
			'o3-mini',
			'o4-mini',
		]) {
			assert.strictEqual(provider.supportsResponseFormat(await registryModel(openai, id)), true, id);
		}
	});

	test('normalizes finish reasons from the OpenAI response shape', () => {
		const rsp = (finish_reason: string, refusal: string | null = null): ChatCompletionResponse =>
			({
				id: '1',
				model: 'test',
				choices: [
					{
						index: 0,
						message: { role: 'assistant', content: '{}', refusal: refusal },
						finish_reason: finish_reason,
					},
				],
				usage: {},
			}) as unknown as ChatCompletionResponse;

		assert.strictEqual(provider.extractFinishReason(rsp('stop')), undefined);
		assert.strictEqual(provider.extractFinishReason(rsp('length')), 'length');
		assert.strictEqual(provider.extractFinishReason(rsp('content_filter')), 'content_filter');
		assert.strictEqual(provider.extractFinishReason(rsp('stop', 'declined')), 'refusal');
		// Some OpenAI-compatible servers serialize an empty refusal on every normal reply
		assert.strictEqual(provider.extractFinishReason(rsp('stop', '')), undefined);
	});

	test('extracts empty content without throwing when choices is empty', () => {
		const data = { id: '1', model: 'test', choices: [], usage: {} } as unknown as ChatCompletionResponse;
		assert.strictEqual(provider.extractContent(data), '');
	});
});

suite('Anthropic response format translation', () => {
	const anthropic = new AnthropicProvider(context);
	const provider = hooks(anthropic);

	test('sets output_config and never the OpenAI envelope', () => {
		const rq = request();
		provider.applyResponseFormat(rq, model('claude-haiku-4-5'), responseFormat);

		assert.deepStrictEqual(rq.output_config, {
			format: { type: 'json_schema', schema: responseFormat.schema },
		});

		const body = JSON.stringify(rq);
		assert.ok(body.includes('output_config'));
		assert.ok(!body.includes('response_format'));
	});

	test('supports the 4.5 generation and newer', async () => {
		for (const id of [
			'claude-opus-5',
			'claude-fable-5',
			'claude-opus-4-8',
			'claude-sonnet-5',
			'claude-haiku-4-5',
			'claude-haiku-4-5-20251001',
			'claude-opus-4-7',
			'claude-sonnet-4-6',
			'claude-opus-4-6',
			'claude-sonnet-4-5-20250929',
			'claude-opus-4-5',
		]) {
			assert.strictEqual(provider.supportsResponseFormat(await registryModel(anthropic, id)), true, id);
		}
	});

	test('gates off pre-4.5 registry models', async () => {
		for (const id of [
			'claude-opus-4-1',
			'claude-opus-4-1-20250805',
			'claude-opus-4-0',
			'claude-opus-4-20250514',
			'claude-sonnet-4-0',
			'claude-sonnet-4-20250514',
			'claude-3-7-sonnet-latest',
			'claude-3-5-haiku-20241022',
			'claude-2.1',
		]) {
			assert.strictEqual(provider.supportsResponseFormat(await registryModel(anthropic, id)), false, id);
		}
	});

	test('finds the text block by type, not position', () => {
		const data = {
			id: '1',
			model: 'test',
			content: [{ type: 'thinking' }, { type: 'text', text: ' {"value":"x"} ' }],
			usage: {},
		} as unknown as ChatCompletionResponse;

		assert.strictEqual(provider.extractContent(data), '{"value":"x"}');
	});

	test('normalizes finish reasons from the Anthropic response shape', () => {
		const rsp = (stop_reason: string): ChatCompletionResponse =>
			({
				id: '1',
				model: 'test',
				content: [{ type: 'text', text: '{}' }],
				stop_reason: stop_reason,
				usage: {},
			}) as unknown as ChatCompletionResponse;

		assert.strictEqual(provider.extractFinishReason(rsp('end_turn')), undefined);
		assert.strictEqual(provider.extractFinishReason(rsp('max_tokens')), 'length');
		assert.strictEqual(provider.extractFinishReason(rsp('refusal')), 'refusal');
	});
});

suite('capability gates for dynamic and constrained providers', () => {
	test('the base gate honors the dynamic-catalog capability flag, defaulting on when absent', () => {
		// GitKraken/OpenRouter getModels always populate the flag (GitKraken fails closed for
		// non-OpenAI/Gemini upstreams there); static registries flag only legacy entries
		const provider = hooks(new GitKrakenProvider(context));

		assert.strictEqual(provider.supportsResponseFormat(model('gpt-4o', { supportsStructuredOutputs: true })), true);
		assert.strictEqual(
			provider.supportsResponseFormat(model('claude-haiku-4-5', { supportsStructuredOutputs: false })),
			false,
		);
		assert.strictEqual(provider.supportsResponseFormat(model('unflagged')), true);
	});

	test('OpenRouter gates per model and restricts routing when attaching', () => {
		const provider = hooks(new OpenRouterProvider(context));

		const supported = model('openai/gpt-4o', { supportsStructuredOutputs: true });
		assert.strictEqual(provider.supportsResponseFormat(supported), true);

		const rq = request();
		provider.applyResponseFormat(rq, supported, responseFormat);
		assert.ok(rq.response_format != null);
		assert.deepStrictEqual(rq.provider, { require_parameters: true });

		const unsupported = model('some/legacy-model', { supportsStructuredOutputs: false });
		assert.strictEqual(provider.supportsResponseFormat(unsupported), false);
	});

	test('DeepSeek never supports json_schema', () => {
		const provider = hooks(new DeepSeekProvider(context));
		assert.strictEqual(provider.supportsResponseFormat(model('deepseek-v4-pro')), false);
	});

	test('xAI gates off only the legacy grok-beta', async () => {
		const xai = new XAIProvider(context);
		const provider = hooks(xai);
		assert.strictEqual(provider.supportsResponseFormat(await registryModel(xai, 'grok-4.3')), true);
		assert.strictEqual(provider.supportsResponseFormat(await registryModel(xai, 'grok-beta')), false);
	});
});

suite('native-format rejection detection (strip-and-retry trigger)', () => {
	test('the base detects 400 wording variants and the OpenRouter no-endpoints 404', () => {
		const provider = hooks(new OpenAIProvider(context));

		assert.strictEqual(
			provider.isResponseFormatRejection(400, "response_format 'json_schema' not supported"),
			true,
		);
		assert.strictEqual(provider.isResponseFormatRejection(400, 'Json mode is not enabled for this model'), true);
		assert.strictEqual(provider.isResponseFormatRejection(400, 'context_length_exceeded'), false);
		assert.strictEqual(provider.isResponseFormatRejection(404, 'No endpoints found matching your request'), true);
		assert.strictEqual(provider.isResponseFormatRejection(500, 'internal error'), false);
	});

	test('GitKraken also detects its 500.1 wrapper around an upstream 400 (e.g. the Gemini schema converter)', () => {
		const provider = hooks(new GitKrakenProvider(context));

		assert.strictEqual(
			provider.isResponseFormatRejection(
				500,
				'{"error":{"code":"500.1","message":"upstream AI provider error (Gemini HTTP 400)"}}',
			),
			true,
		);
		// Transient upstream failures are not format rejections
		assert.strictEqual(
			provider.isResponseFormatRejection(500, 'upstream AI provider error (Gemini HTTP 503)'),
			false,
		);
		// Still honors the base's own 400 detection
		assert.strictEqual(provider.isResponseFormatRejection(400, 'invalid response_format'), true);
	});
});
