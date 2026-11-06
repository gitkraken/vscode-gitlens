import * as assert from 'assert';
import type { LanguageModelChat } from 'vscode';
import { LanguageModelError, LanguageModelTextPart } from 'vscode';
import { isAIUnavailableError } from '@gitlens/ai/errors.js';
import type { AIChatMessage, AIChatMessageRole } from '@gitlens/ai/models/provider.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { AIError, AIErrorReason } from '../../../errors.js';
import { VSCodeAIProvider } from '../vscodeProvider.js';

/**
 * Callers that loop over many requests (conflict resolution across files) stop on `isAIUnavailableError`.
 * That only works if the Language Model provider turns Copilot's failures into typed `AIError`s — a plain
 * `Error` is invisible to it, so every remaining file keeps sending a request that fails identically.
 */
suite('VSCodeAIProvider.sendRequest — Language Model errors', () => {
	type ModelArg = Parameters<VSCodeAIProvider['sendRequest']>[1];

	const model = {
		id: 'copilot:gpt-4o',
		name: 'GPT-4o',
		vendor: 'copilot',
		selector: { vendor: 'copilot', family: 'gpt-4o' },
		maxTokens: { input: 1000, output: undefined },
		provider: { id: 'vscode', name: 'Copilot' },
	} as unknown as ModelArg;

	type ChatModelBehavior = () => Promise<{ stream: AsyncIterable<unknown> }>;

	/** A response whose stream yields the given text, or throws `error` once consumed. */
	function respond(options: { text?: string; streamError?: Error } = {}): ChatModelBehavior {
		return () =>
			Promise.resolve({
				stream: (async function* () {
					if (options.streamError != null) throw options.streamError;
					yield new LanguageModelTextPart(options.text ?? 'resolved');
				})(),
			});
	}

	function reject(error: Error): ChatModelBehavior {
		return () => Promise.reject(error);
	}

	function makeProvider(behaviors: ChatModelBehavior[]) {
		const requests: number[] = [];
		const chatModel = {
			sendRequest: () => {
				const behavior = behaviors[Math.min(requests.length, behaviors.length - 1)];
				requests.push(requests.length);
				return behavior();
			},
		} as unknown as LanguageModelChat;

		// Prototype-backed so the real `sendRequest` runs without a Language Model to select — the only
		// collaborator replaced is the lookup of the chat model itself.
		const provider = Object.assign(Object.create(VSCodeAIProvider.prototype) as VSCodeAIProvider, {
			context: { defaultTemperature: 0.7 },
			getChatModel: () => Promise.resolve(chatModel),
		});

		const messageRequests: { maxInputTokens: number; retries: number }[] = [];
		const getMessages = (maxInputTokens: number, retries: number): Promise<AIChatMessage<AIChatMessageRole>[]> => {
			messageRequests.push({ maxInputTokens: maxInputTokens, retries: retries });
			return Promise.resolve([{ role: 'user', content: 'resolve this' }]);
		};

		return { provider: provider, getMessages: getMessages, requests: requests, messageRequests: messageRequests };
	}

	async function send(
		provider: VSCodeAIProvider,
		getMessages: Parameters<VSCodeAIProvider['sendRequest']>[3],
		signal: AbortSignal = new AbortController().signal,
	): Promise<unknown> {
		try {
			return await provider.sendRequest('conflict-resolution', model, '<not applicable>', getMessages, {
				signal: signal,
			});
		} catch (ex) {
			return ex;
		}
	}

	function assertAIError(result: unknown, reason: AIErrorReason, original: unknown): void {
		assert.ok(result instanceof AIError, `expected an AIError, got ${String(result)}`);
		assert.strictEqual(result.reason, reason);
		assert.strictEqual(result.original, original, 'the original Language Model error is retained');
		assert.ok(isAIUnavailableError(result), 'callers looping over requests can recognise it and stop');
	}

	for (const [where, failWith] of [
		['when sendRequest rejects', (error: Error) => reject(error)],
		['when the response stream throws', (error: Error) => respond({ streamError: error })],
	] as const) {
		suite(where, () => {
			// Copilot raises `Blocked` for temporary extension throttling (“too many requests”), not for missing
			// access, so it is a rate limit rather than an authorization failure. Text is a synthetic stand-in.
			test('Blocked is classified as a rate limit, once', async () => {
				const blocked = LanguageModelError.Blocked(
					'synthetic: temporarily blocked for making too many requests',
				);
				const { provider, getMessages, requests } = makeProvider([failWith(blocked)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.RateLimitExceeded, blocked);
				assert.strictEqual(requests.length, 1, 'a throttle is not retried');
			});

			test('NotFound is classified as model not supported', async () => {
				const notFound = LanguageModelError.NotFound('Model not found');
				const { provider, getMessages } = makeProvider([failWith(notFound)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.ModelNotSupported, notFound);
			});

			// Copilot throws this as a plain Error (no code, no special name) when the selected model has left its list.
			test('Copilot’s "Endpoint not found for model" error is classified as model unavailable, once', async () => {
				const gone = new Error('Endpoint not found for model copilot:gpt-4o');
				const { provider, getMessages, requests } = makeProvider([failWith(gone)]);

				const result = await send(provider, getMessages);

				assertAIError(result, AIErrorReason.ModelUnavailable, gone);
				assert.deepStrictEqual((result as AIError).provider, { id: 'vscode', name: 'Copilot' });
				assert.ok(isAIUnavailableError(result));
				assert.match((result as AIError).message, /no longer available from Copilot/);
				assert.strictEqual(requests.length, 1, 'a missing model is not retried');
			});

			test('the same error wrapped as the cause of another error is still model unavailable', async () => {
				const gone = new Error('Endpoint not found for model copilot:gpt-4o');
				const wrapper = Object.assign(new Error('Unknown', { cause: gone }), { code: 'Unknown' });
				const { provider, getMessages, requests } = makeProvider([failWith(wrapper)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.ModelUnavailable, wrapper);
				assert.strictEqual(requests.length, 1);
			});

			test('NoPermissions is still classified as denied by the user', async () => {
				const denied = LanguageModelError.NoPermissions('Permission denied');
				const { provider, getMessages } = makeProvider([failWith(denied)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.DeniedByUser, denied);
			});

			// Synthetic fixtures shaped after the Copilot Chat extension (built-in v0.71): its quota branch creates a
			// `LanguageModelError(message)` renamed `ChatQuotaExceeded`, its rate-limit branch raises
			// `LanguageModelError.RateLimited(...)`, and older builds named that error `ChatRateLimited`. The
			// messages here are made up.
			test('a quota error is classified as the provider’s user quota, once, with the provider named', async () => {
				const quota = Object.assign(new Error('synthetic quota exhausted: message exceeds token limit'), {
					name: 'ChatQuotaExceeded',
				});
				const { provider, getMessages, requests } = makeProvider([failWith(quota)]);

				const result = await send(provider, getMessages);

				assertAIError(result, AIErrorReason.UserQuotaExceeded, quota);
				assert.deepStrictEqual((result as AIError).provider, { id: 'vscode', name: 'Copilot' });
				assert.strictEqual(requests.length, 1, 'an exhausted quota is not retried');
				assert.match((result as AIError).message, /usage limit for Copilot/);
				assert.doesNotMatch((result as AIError).message, /credits|GitKraken/);
			});

			test('a quota error wrapped as the cause of an Unknown-code error is still a quota error', async () => {
				const quota = Object.assign(new Error('synthetic quota exhausted: message exceeds token limit'), {
					name: 'ChatQuotaExceeded',
				});
				const wrapper = Object.assign(new Error('Unknown', { cause: quota }), { code: 'Unknown' });
				const { provider, getMessages, requests } = makeProvider([failWith(wrapper)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.UserQuotaExceeded, wrapper);
				assert.strictEqual(requests.length, 1);
			});

			test('a legacy ChatRateLimited error is classified as a rate limit, once', async () => {
				const limited = Object.assign(new Error('synthetic legacy rate limit'), { name: 'ChatRateLimited' });
				const { provider, getMessages, requests } = makeProvider([failWith(limited)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.RateLimitExceeded, limited);
				assert.strictEqual(requests.length, 1);
			});

			test('a RateLimited error is classified as a rate limit, once', async () => {
				const limited = Object.assign(new Error('synthetic rate limit'), { code: 'RateLimited' });
				const { provider, getMessages, requests } = makeProvider([failWith(limited)]);

				assertAIError(await send(provider, getMessages), AIErrorReason.RateLimitExceeded, limited);
				assert.strictEqual(requests.length, 1, 'a rate limit is not retried');
			});

			test('an Unknown-code error stays an ordinary error, so one-off failures do not stop a run', async () => {
				const unknown = Object.assign(new Error('Something went sideways'), { code: 'Unknown' });
				const { provider, getMessages } = makeProvider([failWith(unknown)]);

				const result = await send(provider, getMessages);

				assert.ok(result instanceof Error);
				assert.ok(!(result instanceof AIError), 'not promoted to a typed error');
				assert.strictEqual(result.cause, unknown, 'the original error is still attached as the cause');
				assert.ok(!isAIUnavailableError(result));
			});

			test('a cancellation passes through unmodified', async () => {
				const cancelled = new CancellationError();
				const { provider, getMessages } = makeProvider([failWith(cancelled)]);

				assert.strictEqual(await send(provider, getMessages), cancelled);
			});
		});
	}

	suite('token limit', () => {
		const tooLarge = () => new Error('Message exceeds token limit.');

		test('retries with a reduced input budget, then returns the response', async () => {
			const { provider, getMessages, requests, messageRequests } = makeProvider([
				reject(tooLarge()),
				respond({ text: 'fits now' }),
			]);

			const result = (await send(provider, getMessages)) as { content: string };

			assert.strictEqual(result.content, 'fits now');
			assert.strictEqual(requests.length, 2);
			assert.deepStrictEqual(
				messageRequests.map(r => r.retries),
				[0, 1],
			);
			assert.ok(
				messageRequests[1].maxInputTokens < messageRequests[0].maxInputTokens,
				'the second attempt asks for fewer input tokens',
			);
		});

		test('gives up after three retries as request too large, which does not stop a run', async () => {
			const failure = tooLarge();
			const { provider, getMessages, requests } = makeProvider([reject(failure)]);

			const result = await send(provider, getMessages);

			assert.ok(result instanceof AIError);
			assert.strictEqual(result.reason, AIErrorReason.RequestTooLarge);
			assert.strictEqual(result.original, failure);
			assert.strictEqual(requests.length, 4, 'the initial attempt plus three retries');
			assert.ok(!isAIUnavailableError(result), 'a request-shaped failure may succeed on the next file');
		});
	});

	test('a request aborted before it starts is cancelled rather than classified', async () => {
		const controller = new AbortController();
		controller.abort();
		const { provider, getMessages } = makeProvider([respond()]);

		const result = await send(provider, getMessages, controller.signal);

		assert.ok(result instanceof Error);
		assert.ok(!(result instanceof AIError));
		assert.ok(!isAIUnavailableError(result));
	});
});
