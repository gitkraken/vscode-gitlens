import * as assert from 'assert';
import { gitKrakenProviderDescriptor } from '../../constants.js';
import { AIError, AIErrorReason } from '../../errors.js';
import type { AIModel } from '../../models/model.js';
import { GitKrakenProvider } from '../gitkrakenProvider.js';
import { OpenAICompatibleProviderBase } from '../openAICompatibleProviderBase.js';
import { createStubProviderContext } from './fixtures.js';

const context = createStubProviderContext();

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

suite('GitKrakenProvider structured-output support for proxied models', () => {
	function providerReturning(data: Record<string, unknown>[]): GitKrakenProvider {
		return new GitKrakenProvider({
			...context,
			fetch: () => Promise.resolve(new Response(JSON.stringify({ data: data }))),
		});
	}

	function entry(modelId: string, disabledAttributes?: string[]): Record<string, unknown> {
		return {
			providerId: modelId.split(':')[0],
			providerName: 'Upstream',
			modelId: modelId,
			modelName: modelId,
			preferred: false,
			maxInputTokens: 200000,
			maxOutputTokens: 8192,
			...(disabledAttributes != null ? { disabledAttributes: disabledAttributes } : {}),
		};
	}

	test('treats the structured_output opt-out as unsupported and its absence as supported', async () => {
		const models = await providerReturning([
			entry('anthropic:claude-haiku-4-5'),
			entry('anthropic:claude-3-5-sonnet-latest', ['structured_output']),
			entry('openai:gpt-4o', []),
		]).getModels();

		assert.strictEqual(models[0].supportsStructuredOutputs, true);
		assert.strictEqual(models[1].supportsStructuredOutputs, false);
		assert.strictEqual(models[2].supportsStructuredOutputs, true);
	});

	test('ignores unrelated disabled attributes', async () => {
		const models = await providerReturning([entry('openai:gpt-4o', ['some_other_attribute'])]).getModels();

		assert.strictEqual(models[0].supportsStructuredOutputs, true);
	});
});

suite('GitKrakenProvider handleFetchFailure', () => {
	// Widens access to the protected failure handler under test
	interface FetchFailureHook {
		handleFetchFailure(
			rsp: Response,
			action: string,
			model: AIModel,
			retries: number,
			maxInputTokens: number,
			body?: string,
		): Promise<unknown>;
	}

	function fail(message: string): Promise<unknown> {
		const body = JSON.stringify({ error: { code: '500.1', message: message } });
		const rsp = { status: 500, statusText: 'Internal Server Error' } as unknown as Response;
		const provider = new GitKrakenProvider(context) as unknown as FetchFailureHook;
		return provider.handleFetchFailure(rsp, 'review-changes', model, 0, 1024, body);
	}

	test('maps a wrapped upstream 429 to the rate-limit error reason', async () => {
		await assert.rejects(fail('upstream AI provider error (Gemini HTTP 429)'), (ex: unknown) => {
			return ex instanceof AIError && ex.reason === AIErrorReason.RateLimitExceeded;
		});
	});

	test('other wrapped upstream failures stay generic', async () => {
		await assert.rejects(fail('upstream AI provider error (Gemini HTTP 503)'), (ex: unknown) => {
			return ex instanceof Error && !(ex instanceof AIError) && ex.message.includes('500.1');
		});
	});
});
