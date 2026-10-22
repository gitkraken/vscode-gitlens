import * as assert from 'node:assert/strict';
import { suite, test } from 'mocha';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { createFakeRuntime } from '../../__tests__/fakeRuntime.js';
import { createIntegrationService } from '../../integrationService.js';
import type { ProvidersApi } from '../providersApi.js';

suite('ProvidersApi lifecycle', () => {
	for (const disposeBeforeLoad of [false, true]) {
		test(`manager disposal retires facade subscriptions ${disposeBeforeLoad ? 'during' : 'after'} construction`, async () => {
			const runtime = createFakeRuntime();
			const onDidChange = runtime.config.onDidChange;
			let active = 0;
			const ctx = {
				...runtime,
				config: {
					...runtime.config,
					onDidChange: (...args: Parameters<typeof onDidChange>) => {
						active++;
						const subscription = onDidChange(...args);
						return createDisposable(
							() => {
								active--;
								subscription.dispose();
							},
							{ once: true },
						);
					},
				},
			};
			const manager = createIntegrationService(ctx);
			const pending = (manager as unknown as { getProvidersApi(): Promise<ProvidersApi> }).getProvidersApi();
			if (disposeBeforeLoad) {
				manager.dispose();
				await assert.rejects(pending, isCancellationError);
			} else {
				await pending;
				manager.dispose();
			}

			assert.equal(active, 0);
		});
	}
});
