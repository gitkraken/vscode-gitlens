import * as assert from 'assert';
import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import type { AIModel } from '@gitlens/ai/models/model.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { Container } from '../../../container.js';
import type { AIRequestProvider } from '../aiProviderService.js';
import { AIProviderService } from '../aiProviderService.js';

/**
 * #5781: `sendRequest`'s error handler used to `await` the notification it showed. A VS Code notification that
 * carries buttons never auto-dismisses, so an un-actioned one parked the request — and everything driving it —
 * while the operation's own surface kept reporting progress. These tests pin that a terminal failure ends the
 * request on its own, so the notification is deliberately a promise that NEVER settles: nothing here dismisses,
 * clicks or clears it, because a test that did would pass against exactly the regression it exists to catch.
 */
suite('AIProviderService — a terminal failure ends the request without waiting for its notification', () => {
	const copilot = { id: 'vscode', name: 'Copilot' } as const;
	const gitkraken = { id: 'gitkraken', name: 'GitKraken AI' } as const;
	const unpaid = { plan: { actual: { id: 'community' }, effective: { id: 'community' } } };
	const paid = { plan: { actual: { id: 'pro' }, effective: { id: 'pro' } } };

	/** Generous next to the microtask-only path a passing run takes, trivial next to the never-settling one */
	const promptMs = 250;

	type Outcome = { state: 'rejected'; error: unknown } | { state: 'resolved'; value: unknown } | { state: 'pending' };

	function makeModel(provider: { id: string; name: string }) {
		return { id: 'model-1', name: 'Model 1', provider: provider } as unknown as AIModel;
	}

	const requestProvider: AIRequestProvider = {
		getMessages: () => Promise.resolve([]),
		getProgressTitle: () => 'Reviewing changes…',
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

	/** Drives the real `sendRequest` against stubbed collaborators and a notification that never settles */
	async function drive(
		failure: Error,
		model: AIModel,
		options: { silent?: boolean; throwAIErrors?: boolean },
		subscription: object = {},
	) {
		const shown: { message: string; buttons: string[] }[] = [];

		const fakeThis = Object.assign(Object.create(AIProviderService.prototype) as object, {
			container: {
				telemetry: { sendEvent: () => {} },
				subscription: { getSubscription: () => Promise.resolve(subscription) },
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

		const original = window.showErrorMessage;
		Object.defineProperty(window, 'showErrorMessage', {
			configurable: true,
			value: (message: string, ...items: (MessageItem | string)[]) => {
				shown.push({ message: message, buttons: items.map(i => (typeof i === 'string' ? i : i.title)) });
				return new Promise<undefined>(() => {});
			},
		});
		try {
			const result = await (
				AIProviderService.prototype.sendRequest as unknown as (...args: unknown[]) => Promise<{
					promise: Promise<unknown>;
				}>
			).call(fakeThis, 'review-changes', model, requestProvider, { source: 'graph' }, options);

			let timer: ReturnType<typeof setTimeout> | undefined;
			const outcome = await Promise.race([
				result.promise.then(
					(value): Outcome => ({ state: 'resolved', value: value }),
					(error: unknown): Outcome => ({ state: 'rejected', error: error }),
				),
				new Promise<Outcome>(resolve => {
					timer = setTimeout(resolve, promptMs, { state: 'pending' });
				}),
			]);
			clearTimeout(timer);

			// The notification is detached from the request, so it (and the subscription read some arms make
			// first) lands on a later turn than the settlement
			await new Promise(resolve => setTimeout(resolve, 0));

			return { outcome: outcome, shown: shown };
		} finally {
			Object.defineProperty(window, 'showErrorMessage', { configurable: true, value: original });
		}
	}

	const terminalCases: { name: string; error: AIError; model: AIModel; subscription?: object }[] = [
		{
			name: 'RateLimitExceeded',
			error: new AIError(AIErrorReason.RateLimitExceeded),
			model: makeModel(gitkraken),
		},
		{
			name: 'RateLimitOrFundsExceeded',
			error: new AIError(AIErrorReason.RateLimitOrFundsExceeded),
			model: makeModel(gitkraken),
		},
		{
			name: 'UserQuotaExceeded (GitKraken credits)',
			error: new AIError(AIErrorReason.UserQuotaExceeded),
			model: makeModel(gitkraken),
		},
		{
			name: 'UserQuotaExceeded (external provider)',
			error: new AIError(AIErrorReason.UserQuotaExceeded, undefined, copilot),
			model: makeModel(copilot),
		},
		{
			name: 'NoEntitlement (paid plan)',
			error: new AIError(AIErrorReason.NoEntitlement),
			model: makeModel(gitkraken),
			subscription: paid,
		},
		{
			name: 'NoEntitlement (unpaid)',
			error: new AIError(AIErrorReason.NoEntitlement),
			model: makeModel(gitkraken),
			subscription: unpaid,
		},
		{
			name: 'RequestTooLarge',
			error: new AIError(AIErrorReason.RequestTooLarge),
			model: makeModel(gitkraken),
		},
		{
			name: 'ModelNotSupported',
			error: new AIError(AIErrorReason.ModelNotSupported),
			model: makeModel(gitkraken),
		},
		{ name: 'Unauthorized', error: new AIError(AIErrorReason.Unauthorized), model: makeModel(gitkraken) },
		{ name: 'DeniedByUser', error: new AIError(AIErrorReason.DeniedByUser), model: makeModel(gitkraken) },
		{
			name: 'ModelUnavailable',
			error: new AIError(AIErrorReason.ModelUnavailable, undefined, copilot),
			model: makeModel(copilot),
		},
		{
			name: 'ServiceCapacityExceeded',
			error: new AIError(AIErrorReason.ServiceCapacityExceeded),
			model: makeModel(gitkraken),
		},
	];

	for (const { name, error, model, subscription } of terminalCases) {
		test(`${name}: a driven caller gets the real reason promptly and the notification is still shown`, async () => {
			const { outcome, shown } = await drive(error, model, { throwAIErrors: true }, subscription);

			assert.strictEqual(outcome.state, 'rejected', 'the request must end without the notification settling');
			assert.strictEqual((outcome as { error: unknown }).error, error, 'with the real reason, not a cancel');
			assert.strictEqual(shown.length, 1, 'the offer is still made — it just no longer gates completion');
		});

		test(`${name}: without throwAIErrors the request resolves undefined promptly and the notification is still shown`, async () => {
			const { outcome, shown } = await drive(error, model, {}, subscription);

			assert.deepStrictEqual(outcome, { state: 'resolved', value: undefined });
			assert.strictEqual(shown.length, 1);
		});

		test(`${name}: a silent caller gets the reason and no notification at all`, async () => {
			const { outcome, shown } = await drive(error, model, { silent: true, throwAIErrors: true }, subscription);

			assert.strictEqual(outcome.state, 'rejected');
			assert.strictEqual((outcome as { error: unknown }).error, error);
			assert.strictEqual(shown.length, 0, 'silent suppresses the whole interactive tier');
		});
	}

	test('a genuine cancellation resolves as cancelled, shows no notification, and is not an error', async () => {
		const { outcome, shown } = await drive(new CancellationError(), makeModel(gitkraken), { throwAIErrors: true });

		assert.deepStrictEqual(outcome, { state: 'resolved', value: 'cancelled' });
		assert.strictEqual(shown.length, 0);
	});

	// The control that proves the table above measures something: these two arms `await` their notification on
	// purpose, because the answer (Retry) drives `continue` in the retry loop and so needs the request alive.
	for (const [name, reason] of [
		['NoNetwork', AIErrorReason.NoNetwork],
		['Unreachable', AIErrorReason.Unreachable],
	] as const) {
		test(`${name} intentionally keeps the request pending on its Retry prompt`, async () => {
			const { outcome, shown } = await drive(new AIError(reason), makeModel(gitkraken), { throwAIErrors: true });

			assert.strictEqual(outcome.state, 'pending');
			assert.deepStrictEqual(shown[0]?.buttons, ['Retry']);
		});
	}
});
