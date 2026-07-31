import * as assert from 'assert';
import type { AIModel, AIProviderDescriptor } from '../../models/model.js';
import type { AIChatMessage, AIChatMessageRole, AIToolCall, AIToolDefinition } from '../../models/provider.js';
import type { AIProviderContext } from '../context.js';
import { OpenAICompatibleProviderBase } from '../openAICompatibleProviderBase.js';

const context: AIProviderContext = {
	fetch: () => Promise.reject(new Error('not used by the serialization hooks')),
	getApiKey: () => Promise.resolve(undefined),
	getProviderConfig: () => ({ enabled: true }),
	getOrPromptUrl: () => Promise.resolve(undefined),
};

const descriptor: AIProviderDescriptor<'openai'> = {
	id: 'openai',
	name: 'OpenAI',
	primary: false,
	requiresAccount: false,
	requiresUserKey: true,
};

/** Exposes the protected serialization hooks so the wire shape can be asserted without a network call. */
class TestProvider extends OpenAICompatibleProviderBase<'openai'> {
	readonly id = 'openai' as const;
	readonly name = 'OpenAI';
	protected readonly descriptor = descriptor;
	protected readonly config = {};

	getModels(): Promise<readonly AIModel<'openai'>[]> {
		return Promise.resolve([]);
	}

	protected getUrl(): string {
		return 'https://example.invalid/v1/chat/completions';
	}

	messages(messages: AIChatMessage<AIChatMessageRole>[]): unknown[] {
		return this.serializeMessages(messages);
	}

	tools(tools: readonly AIToolDefinition[]): { tools: unknown[] } {
		return this.serializeTools(tools);
	}

	// biome-ignore lint/suspicious/noExplicitAny: exercising the response parser with wire-shaped fixtures
	calls(data: any): AIToolCall[] | undefined {
		return this.parseToolCalls(data);
	}
}

const provider = () => new TestProvider(context);

suite('OpenAICompatibleProviderBase tool serialization', () => {
	test('wraps tool definitions in the OpenAI function envelope', () => {
		const { tools } = provider().tools([
			{ name: 'grep', description: 'Search the tree', parameters: { type: 'object', properties: {} } },
		]);

		assert.deepStrictEqual(tools, [
			{
				type: 'function',
				function: {
					name: 'grep',
					description: 'Search the tree',
					parameters: { type: 'object', properties: {} },
				},
			},
		]);
	});

	test('JSON-stringifies tool-call arguments on an assistant turn', () => {
		const out = provider().messages([
			{ role: 'assistant', content: 'Checking usages', toolCalls: [{ id: 'c1', name: 'grep', args: { p: 1 } }] },
		]);

		assert.deepStrictEqual(out, [
			{
				role: 'assistant',
				content: 'Checking usages',
				tool_calls: [{ id: 'c1', type: 'function', function: { name: 'grep', arguments: '{"p":1}' } }],
			},
		]);
	});

	test('sends null content for a tool-call-only assistant turn', () => {
		// OpenAI requires `content` to be present but permits null; dropping the turn entirely would
		// leave the following tool result with no matching request.
		const out = provider().messages([
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'grep', args: {} }] },
		]);

		assert.strictEqual((out[0] as { content: unknown }).content, null);
	});

	test('emits a tool result as a tool-role message keyed by tool_call_id', () => {
		const out = provider().messages([{ role: 'tool', content: 'no matches', toolCallId: 'c1', toolName: 'grep' }]);

		assert.deepStrictEqual(out, [{ role: 'tool', tool_call_id: 'c1', content: 'no matches' }]);
	});

	test('round-trips a provider signature only when one is present', () => {
		const withSig = provider().messages([
			{
				role: 'assistant',
				content: '',
				toolCalls: [{ id: 'c1', name: 'grep', args: {}, providerSignature: 'sig' }],
			},
		]);
		assert.strictEqual(
			(withSig[0] as { tool_calls: { thought_signature?: string }[] }).tool_calls[0].thought_signature,
			'sig',
		);

		const withoutSig = provider().messages([
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'grep', args: {} }] },
		]);
		assert.strictEqual(
			'thought_signature' in (withoutSig[0] as { tool_calls: object[] }).tool_calls[0],
			false,
			'the field must be absent for providers that never mint one',
		);
	});

	test('falls back to plain text when a tool result has no call id', () => {
		// `tool_call_id: undefined` is rejected deep in the provider with nothing to trace it back to.
		// Degrading to the shape used for providers without tool support keeps the content in the
		// conversation and the failure diagnosable.
		const out = provider().messages([{ role: 'tool', content: 'no matches', toolName: 'grep' }]);

		assert.deepStrictEqual(out, [{ role: 'user', content: 'no matches' }]);
	});

	test('leaves plain messages untouched', () => {
		const out = provider().messages([
			{ role: 'system', content: 'be terse' },
			{ role: 'user', content: 'hi' },
		]);

		assert.deepStrictEqual(out, [
			{ role: 'system', content: 'be terse' },
			{ role: 'user', content: 'hi' },
		]);
	});
});

suite('OpenAICompatibleProviderBase tool-call parsing', () => {
	test('parses OpenAI tool calls and their JSON arguments', () => {
		const calls = provider().calls({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [{ id: 'c1', type: 'function', function: { name: 'grep', arguments: '{"p":1}' } }],
					},
				},
			],
		});

		assert.deepStrictEqual(calls, [{ id: 'c1', name: 'grep', args: { p: 1 } }]);
	});

	test('reads the GitKraken proxy’s thought_signature', () => {
		const calls = provider().calls({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'c1',
								type: 'function',
								function: { name: 'grep', arguments: '{}' },
								thought_signature: 'sig-abc',
							},
						],
					},
				},
			],
		});

		assert.strictEqual(calls?.[0].providerSignature, 'sig-abc');
	});

	test('tolerates empty or malformed arguments rather than throwing', () => {
		// The tool dispatcher reports the resulting validation error back to the model, which is more
		// recoverable than failing the whole request.
		const calls = provider().calls({
			choices: [
				{
					message: {
						content: null,
						tool_calls: [
							{ id: 'c1', type: 'function', function: { name: 'grep', arguments: '' } },
							{ id: 'c2', type: 'function', function: { name: 'grep', arguments: '{not json' } },
						],
					},
				},
			],
		});

		assert.deepStrictEqual(
			calls?.map(c => c.args),
			[{}, {}],
		);
	});

	test('parses Anthropic tool_use content blocks', () => {
		const calls = provider().calls({
			content: [
				{ type: 'text', text: 'looking' },
				{ type: 'tool_use', id: 'c1', name: 'blame', input: { path: 'a.ts' } },
			],
		});

		assert.deepStrictEqual(calls, [{ id: 'c1', name: 'blame', args: { path: 'a.ts' } }]);
	});

	test('returns undefined when the response has no tool calls', () => {
		assert.strictEqual(provider().calls({ choices: [{ message: { content: 'done' } }] }), undefined);
	});
});
