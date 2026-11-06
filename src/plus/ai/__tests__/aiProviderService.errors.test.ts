import * as assert from 'assert';
import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import type { AIModel } from '@gitlens/ai/models/model.js';
import type { Container } from '../../../container.js';
import type { AIRequestProvider } from '../aiProviderService.js';
import { AIProviderService } from '../aiProviderService.js';

/**
 * A quota failure's call to action depends on who ran out. GitKraken AI's weekly allowance is fixed by buying
 * credits — a path that makes no sense to a Copilot user, whose limit is Copilot's own. These drive the real
 * `sendRequest` notification switch and watch what it shows and whether it consults the GitKraken subscription.
 */
suite('AIProviderService — a quota error notification', () => {
	const copilot = { id: 'vscode', name: 'Copilot' } as const;
	const gitkraken = { id: 'gitkraken', name: 'GitKraken AI' } as const;

	function makeModel(provider: { id: string; name: string }) {
		return { id: 'model-1', name: 'Model 1', provider: provider } as unknown as AIModel;
	}

	function makeFakes(failure: Error, role?: 'member') {
		const subscriptionReads: number[] = [];
		const shown: { message: string; buttons: string[] }[] = [];

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

		// Prototype-backed so the real `sendRequest` loop and its notification switch run against stubbed
		// collaborators, instead of standing up the provider/subscription graph for one branch.
		const fakeThis = Object.assign(Object.create(AIProviderService.prototype) as object, {
			container: {
				telemetry: { sendEvent: () => {} },
				subscription: {
					getSubscription: () => {
						subscriptionReads.push(subscriptionReads.length);
						return Promise.resolve({ activeOrganization: role == null ? undefined : { role: role } });
					},
				},
			} as unknown as Container,
			ensureFeatureAccess: () => Promise.resolve(true),
			showAiAllAccessNotificationIfNeeded: () => Promise.resolve(),
			getProviderForModel: () =>
				Promise.resolve({
					provider: {
						getApiKey: () => Promise.resolve('<not applicable>'),
						sendRequest: () => Promise.reject(failure),
						supportsTools: false,
					},
					dispose: () => {},
				}),
		});

		return {
			fakeThis: fakeThis,
			requestProvider: requestProvider,
			shown: shown,
			subscriptionReads: subscriptionReads,
		};
	}

	/** Drives the request, capturing what the notification switch shows. The notification is detached from the
	 *  request, so it settles on a later turn than the rejection. */
	async function run(failure: Error, model: AIModel, role?: 'member') {
		const fakes = makeFakes(failure, role);

		const original = window.showErrorMessage;
		Object.defineProperty(window, 'showErrorMessage', {
			configurable: true,
			value: (message: string, ...items: MessageItem[]) => {
				fakes.shown.push({ message: message, buttons: items.map(i => i.title) });
				return Promise.resolve(undefined);
			},
		});
		try {
			const result = await (
				AIProviderService.prototype.sendRequest as unknown as (...args: unknown[]) => Promise<{
					promise: Promise<unknown>;
				}>
			).call(
				fakes.fakeThis,
				'conflict-resolution',
				model,
				fakes.requestProvider,
				{ source: 'graph' },
				{
					throwAIErrors: true,
				},
			);

			const thrown = await result.promise.then(
				() => undefined,
				(ex: unknown) => ex,
			);
			await new Promise(resolve => setTimeout(resolve, 0));

			return { thrown: thrown, shown: fakes.shown, subscriptionReads: fakes.subscriptionReads };
		} finally {
			Object.defineProperty(window, 'showErrorMessage', { configurable: true, value: original });
		}
	}

	test('names the external provider, offers Switch Model, and never reads the GitKraken subscription', async () => {
		const error = new AIError(AIErrorReason.UserQuotaExceeded, undefined, copilot);

		const { thrown, shown, subscriptionReads } = await run(error, makeModel(copilot));

		assert.strictEqual(thrown, error, 'the reason still reaches a driven caller');
		assert.deepStrictEqual(shown, [{ message: error.message, buttons: ['Switch Model'] }]);
		assert.match(shown[0].message, /usage limit for Copilot/);
		assert.doesNotMatch(shown[0].message, /credits|GitKraken/);
		assert.strictEqual(subscriptionReads.length, 0, 'a Copilot limit has nothing to do with the GK subscription');
	});

	test('a model that is no longer available shows its own message with only Switch Model', async () => {
		const error = new AIError(AIErrorReason.ModelUnavailable, undefined, copilot);

		const { thrown, shown, subscriptionReads } = await run(error, makeModel(copilot));

		assert.strictEqual(thrown, error, 'the reason still reaches a driven caller');
		assert.deepStrictEqual(shown, [{ message: error.message, buttons: ['Switch Model'] }]);
		assert.match(shown[0].message, /no longer available from Copilot/);
		assert.strictEqual(subscriptionReads.length, 0);
	});

	test('keeps offering GitKraken credits to a GitKraken quota error', async () => {
		const error = new AIError(AIErrorReason.UserQuotaExceeded);

		const { thrown, shown, subscriptionReads } = await run(error, makeModel(gitkraken));

		assert.strictEqual(thrown, error);
		assert.strictEqual(subscriptionReads.length, 1);
		assert.strictEqual(shown.length, 1);
		assert.match(shown[0].message, /Purchase additional AI credits/);
		assert.deepStrictEqual(shown[0].buttons, ['Get More Credits', 'Dismiss']);
	});

	test('tells a GitKraken member who cannot buy credits to contact an admin, as before', async () => {
		const error = new AIError(AIErrorReason.UserQuotaExceeded, undefined, gitkraken);

		const { shown, subscriptionReads } = await run(error, makeModel(gitkraken), 'member');

		assert.strictEqual(subscriptionReads.length, 1);
		assert.match(shown[0].message, /Contact your organization admin or owner/);
		assert.deepStrictEqual(shown[0].buttons, ['OK']);
	});
});
