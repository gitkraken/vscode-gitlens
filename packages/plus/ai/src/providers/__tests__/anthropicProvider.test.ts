import * as assert from 'assert';
import type { AIChatMessage, AIChatMessageRole } from '../../models/provider.js';
import { AnthropicProvider } from '../anthropicProvider.js';
import type { AIProviderContext } from '../context.js';

const context: AIProviderContext = {
	fetch: () => Promise.reject(new Error('not used by extractSystemPrompt')),
	getApiKey: () => Promise.resolve(undefined),
	getProviderConfig: () => ({ enabled: true }),
	getOrPromptUrl: () => Promise.resolve(undefined),
};

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
