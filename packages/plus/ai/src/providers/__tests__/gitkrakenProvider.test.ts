import * as assert from 'assert';
import { gitKrakenProviderDescriptor } from '../../constants.js';
import type { AIModel } from '../../models/model.js';
import type { AIProviderContext } from '../context.js';
import { GitKrakenProvider } from '../gitkrakenProvider.js';
import { OpenAICompatibleProviderBase } from '../openAICompatibleProviderBase.js';

const context: AIProviderContext = {
	fetch: () => Promise.reject(new Error('not used by getHeaders')),
	getApiKey: () => Promise.resolve(undefined),
	getProviderConfig: () => ({ enabled: true }),
	getOrPromptUrl: () => Promise.resolve(undefined),
};

const model: AIModel<typeof gitKrakenProviderDescriptor.id> = {
	id: 'test-model',
	name: 'Test Model',
	maxTokens: { input: 1024, output: undefined },
	provider: { id: gitKrakenProviderDescriptor.id, name: gitKrakenProviderDescriptor.name },
};

class TestGitKrakenProvider extends GitKrakenProvider {
	headers(conversationId?: string): Record<string, string> {
		return this.getHeaders('conflict-resolution', 'test-token', model, 'chat/completions', conversationId);
	}
}

class TestBaseProvider extends OpenAICompatibleProviderBase<typeof gitKrakenProviderDescriptor.id> {
	readonly id = gitKrakenProviderDescriptor.id;
	readonly name = 'Test Base';
	protected readonly descriptor = gitKrakenProviderDescriptor;
	protected readonly config = {};

	getModels(): Promise<readonly AIModel<typeof gitKrakenProviderDescriptor.id>[]> {
		return Promise.resolve([]);
	}

	protected getUrl(_model: AIModel<typeof gitKrakenProviderDescriptor.id>): string | undefined {
		return undefined;
	}

	headers(conversationId?: string): Record<string, string> | Promise<Record<string, string>> {
		return this.getHeaders('conflict-resolution', 'test-token', model, 'https://example.com', conversationId);
	}
}

suite('GitKrakenProvider getHeaders', () => {
	test('includes GK-Conversation-ID when a conversation ID is provided', () => {
		const headers = new TestGitKrakenProvider(context).headers('11111111-2222-3333-4444-555555555555');
		assert.strictEqual(headers['GK-Conversation-ID'], '11111111-2222-3333-4444-555555555555');
		assert.strictEqual(headers['GK-Action'], 'conflict-resolution');
		assert.strictEqual(headers.Authorization, 'Bearer test-token');
	});

	test('omits GK-Conversation-ID when no conversation ID is provided', () => {
		const headers = new TestGitKrakenProvider(context).headers();
		assert.strictEqual('GK-Conversation-ID' in headers, false);
		assert.strictEqual(headers['GK-Action'], 'conflict-resolution');
	});
});

suite('OpenAICompatibleProviderBase getHeaders', () => {
	test('never emits GK-Conversation-ID — the ID must not reach third-party APIs', async () => {
		const headers = await new TestBaseProvider(context).headers('11111111-2222-3333-4444-555555555555');
		assert.strictEqual('GK-Conversation-ID' in headers, false);
		assert.strictEqual(headers.Authorization, 'Bearer test-token');
	});
});
