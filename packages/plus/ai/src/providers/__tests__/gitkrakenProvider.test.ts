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

/** Exposes the protected failure handler so the backend's error envelope can be asserted directly. */
class TestFailureProvider extends GitKrakenProvider {
	fail(
		status: number,
		envelope: unknown,
		sentTools?: boolean,
	): Promise<{ retry: true; maxInputTokens: number; withoutTools?: boolean }> {
		return this.handleFetchFailure(
			new Response(JSON.stringify(envelope), { status: status }),
			'conflict-resolution',
			model,
			0,
			1024,
			undefined,
			sentTools,
		);
	}

	formatRejection(status: number, body: string): boolean {
		return this.isResponseFormatRejection(status, body);
	}
}

suite('GitKrakenProvider upstream-error envelope', () => {
	const provider = () => new TestFailureProvider(context);

	// The backend reports upstream provider failures in its own envelope, carrying only its own prose
	// ("upstream AI provider error (OpenAI HTTP 400)") plus the provider's real complaint in `data`.
	// Two things went wrong with that: the classification keyed off the envelope's code — which differs
	// between backends (500.1 on prod, 400.1 observed on staging) — and every branch but the entitlement
	// one dropped `data`, leaving nothing that names a cause.

	test('surfaces the upstream provider’s own complaint from error.data', async () => {
		await assert.rejects(
			() =>
				provider().fail(400, {
					error: {
						code: '400.1',
						message: 'upstream AI provider error (OpenAI HTTP 400)',
						data: {
							error: { message: "Unsupported parameter: 'tools' is not supported with this model." },
						},
					},
				}),
			/tools' is not supported with this model/,
			'without the detail the message names no cause and the failure can only be guessed at',
		);
	});

	test('classifies a wrapped upstream rate limit regardless of the envelope code', async () => {
		// Same upstream condition under both envelopes must produce the same recoverable reason — keying
		// off the outer code meant a staging 400.1 became a bare Error with no reason, so no rate-limit
		// handling and no Switch Model action.
		for (const code of ['500.1', '400.1']) {
			const outer = parseInt(code, 10);
			await assert.rejects(
				() =>
					provider().fail(outer, {
						error: { code: code, message: 'upstream AI provider error (Anthropic HTTP 429)' },
					}),
				(ex: unknown) => ex instanceof AIError && ex.reason === AIErrorReason.RateLimitExceeded,
				`${code} should classify as a rate limit`,
			);
		}
	});

	test('leaves a genuine validation 400 unclassified', async () => {
		// No upstream wrapper in the message — this is the backend rejecting our request, not a provider.
		await assert.rejects(
			() => provider().fail(400, { error: { code: '400.1', message: 'model is required' } }),
			(ex: unknown) =>
				ex instanceof Error && !(ex instanceof AIError) && ex.message.includes('model is required'),
		);
	});

	test('treats a wrapped upstream 400 as a response-format rejection under either envelope', () => {
		// Drives the strip-and-resend recovery. Gated on `status === 500`, it stopped firing entirely on a
		// backend that wraps upstream failures as 400.1.
		const body = 'upstream AI provider error (Gemini HTTP 400)';
		assert.strictEqual(provider().formatRejection(500, body), true);
		assert.strictEqual(provider().formatRejection(400, body), true);
	});
});

suite('GitKrakenProvider tools fallback', () => {
	const provider = () => new TestFailureProvider(context);

	test('degrades to a no-tools retry when the backend forwards an upstream 400', async () => {
		// This provider's `handleFetchFailure` owns the 400 case and throws, so it never reaches the base
		// where the retry-without-tools fallback lives — and it wasn't even given `sentTools`. The result
		// was that a tool-using request could only ever hard-fail here, never degrade to single-shot.
		const result = await provider().fail(
			400,
			{ error: { code: '400.1', message: 'upstream AI provider error (OpenAI HTTP 400)' } },
			true,
		);

		assert.deepStrictEqual(result, { retry: true, maxInputTokens: 1024, withoutTools: true });
	});

	test('does not degrade when no tools were sent', async () => {
		// Same response without `tools` on the request is a genuine failure — retrying identically would
		// just burn a request, so it must still throw.
		await assert.rejects(() =>
			provider().fail(400, {
				error: { code: '400.1', message: 'upstream AI provider error (OpenAI HTTP 400)' },
			}),
		);
	});

	test('does not mistake a wrapped upstream 429 for a tools rejection', async () => {
		// Only an upstream 400 is a candidate — a rate limit has its own recoverable reason and must keep it.
		await assert.rejects(
			() =>
				provider().fail(
					500,
					{ error: { code: '500.1', message: 'upstream AI provider error (OpenAI HTTP 429)' } },
					true,
				),
			(ex: unknown) => ex instanceof AIError && ex.reason === AIErrorReason.RateLimitExceeded,
		);
	});

	test('still matches a plainly-worded tools rejection from a direct provider', async () => {
		const result = await provider().fail(
			400,
			{ error: { code: '400.1', message: "Unsupported parameter: 'tools' is not supported" } },
			true,
		);

		assert.strictEqual(result.withoutTools, true);
	});
});
