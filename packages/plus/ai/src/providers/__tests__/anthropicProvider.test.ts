import * as assert from 'assert';
import type { AIChatMessage, AIChatMessageRole, AIToolDefinition } from '../../models/provider.js';
import { AnthropicProvider } from '../anthropicProvider.js';
import { createStubProviderContext } from './fixtures.js';

const context = createStubProviderContext();

class TestAnthropicProvider extends AnthropicProvider {
	split(messages: AIChatMessage<AIChatMessageRole>[]): {
		messages: AIChatMessage<AIChatMessageRole>[];
		system?: string;
	} {
		return this.extractSystemPrompt(messages);
	}
}

suite('AnthropicProvider extractSystemPrompt', () => {
	test('hoists a system-role message into the top-level `system` field', () => {
		const { system, messages } = new TestAnthropicProvider(context).split([
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'Hello' },
		]);

		assert.strictEqual(system, 'You are a helpful assistant.');
		assert.deepStrictEqual(messages, [{ role: 'user', content: 'Hello' }]);
	});

	test('joins multiple system-role messages with a blank line', () => {
		const { system, messages } = new TestAnthropicProvider(context).split([
			{ role: 'system', content: 'First.' },
			{ role: 'user', content: 'Hi' },
			{ role: 'system', content: 'Second.' },
		]);

		assert.strictEqual(system, 'First.\n\nSecond.');
		assert.deepStrictEqual(messages, [{ role: 'user', content: 'Hi' }]);
	});

	test('leaves messages without a system role untouched and sets no system prompt', () => {
		const { system, messages } = new TestAnthropicProvider(context).split([{ role: 'user', content: 'Hello' }]);

		assert.strictEqual(system, undefined);
		assert.deepStrictEqual(messages, [{ role: 'user', content: 'Hello' }]);
	});
});

/** Exposes the Anthropic tool-encoding overrides, which diverge from the OpenAI base. */
class TestAnthropicToolProvider extends AnthropicProvider {
	tools(tools: readonly AIToolDefinition[]): { tools: unknown[] } {
		return this.serializeTools(tools);
	}

	messages(messages: AIChatMessage<AIChatMessageRole>[]): unknown[] {
		return this.serializeMessages(messages);
	}
}

const anthropic = () => new TestAnthropicToolProvider(context);

suite('AnthropicProvider tool serialization', () => {
	test('names the schema field input_schema and drops the function envelope', () => {
		const { tools } = anthropic().tools([{ name: 'grep', description: 'Search', parameters: { type: 'object' } }]);

		assert.deepStrictEqual(tools, [{ name: 'grep', description: 'Search', input_schema: { type: 'object' } }]);
	});

	test('encodes an assistant tool call as text + tool_use content blocks', () => {
		const out = anthropic().messages([
			{ role: 'assistant', content: 'Checking', toolCalls: [{ id: 'c1', name: 'grep', args: { p: 1 } }] },
		]);

		assert.deepStrictEqual(out, [
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Checking' },
					{ type: 'tool_use', id: 'c1', name: 'grep', input: { p: 1 } },
				],
			},
		]);
	});

	test('omits the text block when the assistant turn is tool calls only', () => {
		const out = anthropic().messages([
			{ role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'grep', args: {} }] },
		]);

		assert.deepStrictEqual((out[0] as { content: unknown[] }).content, [
			{ type: 'tool_use', id: 'c1', name: 'grep', input: {} },
		]);
	});

	test('carries a tool result as a tool_result block on a user message', () => {
		// Anthropic has no `tool` role — results arrive as user-message content blocks.
		const out = anthropic().messages([{ role: 'tool', content: 'none', toolCallId: 'c1', toolName: 'grep' }]);

		assert.deepStrictEqual(out, [
			{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'none' }] },
		]);
	});

	test('falls back to plain text when a tool result has no call id', () => {
		// A `tool_use_id: undefined` block is rejected by the Messages API; see the base provider.
		const out = anthropic().messages([{ role: 'tool', content: 'none', toolName: 'grep' }]);

		assert.deepStrictEqual(out, [{ role: 'user', content: 'none' }]);
	});

	test('batches consecutive tool results into a single user turn', () => {
		// A multi-tool-call round must be answered by one user message holding every result.
		const out = anthropic().messages([
			{ role: 'tool', content: 'a', toolCallId: 'c1', toolName: 'grep' },
			{ role: 'tool', content: 'b', toolCallId: 'c2', toolName: 'blame' },
		]);

		assert.strictEqual(out.length, 1);
		assert.deepStrictEqual((out[0] as { content: unknown[] }).content, [
			{ type: 'tool_result', tool_use_id: 'c1', content: 'a' },
			{ type: 'tool_result', tool_use_id: 'c2', content: 'b' },
		]);
	});

	test('does not append a tool result onto an unrelated user turn', () => {
		const out = anthropic().messages([
			{ role: 'user', content: 'hello' },
			{ role: 'tool', content: 'a', toolCallId: 'c1', toolName: 'grep' },
		]);

		assert.strictEqual(out.length, 2);
		assert.deepStrictEqual(out[0], { role: 'user', content: 'hello' });
	});
});
