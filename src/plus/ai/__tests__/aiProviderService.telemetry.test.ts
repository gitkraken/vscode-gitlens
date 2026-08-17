import * as assert from 'assert';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { Container } from '../../../container.js';
import type { AIRequestProvider } from '../aiProviderService.js';
import { AIProviderService } from '../aiProviderService.js';

/**
 * `conversationId` is how conflict-resolution usage is measured (count distinct IDs on `ai/generate`
 * with `type: 'resolveConflicts'`) — but the integration tests stop at the AI port boundary, asserting
 * only that the option is threaded. The assignment that actually puts it on the event lives here, so
 * without these a regression would silently zero out the adoption metric.
 */
suite('AIProviderService — conversationId reaches the ai/generate event', () => {
	function makeFakes(model: AIModel) {
		const sentEvents: { name: string; data: Record<string, unknown> }[] = [];

		const requestProvider: AIRequestProvider = {
			getMessages: () => Promise.resolve([]),
			getProgressTitle: () => 'Resolving conflicts…',
			getTelemetryInfo: (m: AIModel) => ({
				key: 'ai/generate' as const,
				data: {
					type: 'resolveConflicts' as const,
					id: undefined,
					'model.id': m.id,
					'model.provider.id': m.provider.id,
					'model.provider.name': m.provider.name,
					'retry.count': 0,
				},
			}),
		};

		// Prototype-backed so the real `sendRequest` body runs against stubbed collaborators — the
		// alternative is standing up the whole provider/subscription graph for one assignment.
		const fakeThis = Object.assign(Object.create(AIProviderService.prototype) as object, {
			container: {
				telemetry: {
					sendEvent: (name: string, data: Record<string, unknown>) =>
						void sentEvents.push({ name: name, data: data }),
				},
			} as unknown as Container,
			ensureFeatureAccess: () => Promise.resolve(true),
			// No API key, so the request fails out at the "Not authorized" branch — the cheapest failure
			// past the stamp that still reports, and it needs no cancellation timing to hit reliably.
			getProviderForModel: () =>
				Promise.resolve({
					provider: { getApiKey: () => Promise.resolve(undefined) },
					dispose: () => {},
				}),
		});

		return { fakeThis: fakeThis, requestProvider: requestProvider, sentEvents: sentEvents };
	}

	// Not `gitkraken` — that provider takes an all-access notification detour before the branch under test.
	const model = {
		id: 'gpt-4o',
		name: 'GPT-4o',
		provider: { id: 'openai', name: 'OpenAI' },
	} as unknown as AIModel;

	/** Every send in `sendRequest` spreads the one event-data object built at the top, so proving the
	 *  stamp landed on a failure send proves it lands on the success path too. */
	function sendFailing(fakeThis: object, requestProvider: AIRequestProvider, options: { conversationId?: string }) {
		return (AIProviderService.prototype.sendRequest as unknown as (...args: unknown[]) => Promise<unknown>).call(
			fakeThis,
			'conflict-resolution',
			model,
			requestProvider,
			{ source: 'graph' },
			options,
		);
	}

	test('stamps the conversation ID on the failure paths, where an unattributable request costs most', async () => {
		const { fakeThis, requestProvider, sentEvents } = makeFakes(model);

		await sendFailing(fakeThis, requestProvider, { conversationId: 'conv-42' });

		const generated = sentEvents.filter(e => e.name === 'ai/generate');
		assert.strictEqual(generated.length, 1, 'the failed request still reports');
		assert.strictEqual(generated[0].data.conversationId, 'conv-42');
		assert.strictEqual(generated[0].data.failed, true, 'and is marked as a failure');
	});

	test('leaves the conversation ID unset for features that do not drive a session', async () => {
		// Most features are one-shot and pass no ID; a stray default would inflate the distinct-ID
		// count that measures conflict-resolution adoption.
		const { fakeThis, requestProvider, sentEvents } = makeFakes(model);

		await sendFailing(fakeThis, requestProvider, {});

		assert.strictEqual(sentEvents[0].data.conversationId, undefined);
	});
});
