import * as assert from 'assert';
import * as sinon from 'sinon';
import * as fetchModule from '@env/fetch.js';
import { Logger } from '@gitlens/utils/logger.js';
import { FeatureFlagService } from '../featureFlagService.js';

// Replicate the module-private setFeatureFlagTelemetryGlobalAttributes from extension.ts
// so we can unit test its logic independently.
async function setFeatureFlagTelemetryGlobalAttributes(container: {
	featureFlags: Promise<FeatureFlagService | undefined>;
	telemetry: { setGlobalAttribute(key: string, value: string): void };
}): Promise<void> {
	try {
		const featureFlags = await container.featureFlags;
		if (featureFlags == null) return;
		const flags = await featureFlags.getAllFlags();
		if (Object.keys(flags).length === 0) return;
		container.telemetry.setGlobalAttribute(
			'featureFlags',
			JSON.stringify(Object.fromEntries(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)))),
		);
	} catch (ex) {
		Logger.error(ex, 'setFeatureFlagTelemetryGlobalAttributes');
	}
}

function createMockContainer(): any {
	return {
		urls: { getGkApiUrl: (...segments: string[]) => `https://api.test.com/${segments.join('/')}` },
		env: 'production',
		debugging: false,
		prereleaseOrDebugging: false,
	};
}

function createMockResponse(opts: { ok: boolean; status?: number; statusText?: string; body?: string }): any {
	return {
		ok: opts.ok,
		status: opts.status ?? (opts.ok ? 200 : 500),
		statusText: opts.statusText ?? (opts.ok ? 'OK' : 'Internal Server Error'),
		text: () => Promise.resolve(opts.body ?? ''),
	};
}

suite('FeatureFlagService Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let fetchStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		fetchStub = sandbox.stub(fetchModule, 'fetch' as any);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('loadClient — fetch failure scenarios', () => {
		test('returns undefined client when fetch throws', async () => {
			fetchStub.rejects(new Error('Network error'));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('f', false), false);
			s.dispose();
		});

		test('returns undefined client when response is not ok', async () => {
			fetchStub.resolves(createMockResponse({ ok: false, status: 500 }));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('f', 'def'), 'def');
			s.dispose();
		});

		test('returns undefined client when response body is empty', async () => {
			fetchStub.resolves(createMockResponse({ ok: true, body: '' }));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('f', 42), 42);
			s.dispose();
		});
	});

	suite('getFlag — client unavailable', () => {
		test('returns default boolean value', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('b', true), true);
			assert.strictEqual(await s.getFlag('b', false), false);
			s.dispose();
		});

		test('returns default string value', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('s', 'fallback'), 'fallback');
			s.dispose();
		});

		test('returns default number value', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('n', 99), 99);
			s.dispose();
		});
	});

	suite('getAllFlags — client unavailable', () => {
		test('returns empty object', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			assert.deepStrictEqual(await s.getAllFlags(), {});
			s.dispose();
		});
	});

	suite('dispose', () => {
		test('does not throw when client is unavailable', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			await s.getFlag('any', false);
			assert.doesNotThrow(() => s.dispose());
		});

		test('does not throw when called multiple times', async () => {
			fetchStub.rejects(new Error('no net'));
			const s = new FeatureFlagService(createMockContainer());
			await s.getFlag('any', false);
			assert.doesNotThrow(() => {
				s.dispose();
				s.dispose();
			});
		});
	});

	suite('setFeatureFlagTelemetryGlobalAttributes', () => {
		test('sets sorted flags JSON on telemetry when flags are available', async () => {
			const setGlobalAttribute = sandbox.stub();
			const mockService = {
				getAllFlags: sandbox.stub().resolves({ 'z-flag': true, 'a-flag': 'variant-b', 'm-flag': 42 }),
			} as unknown as FeatureFlagService;
			const container = { featureFlags: Promise.resolve(mockService), telemetry: { setGlobalAttribute } };
			await setFeatureFlagTelemetryGlobalAttributes(container);
			assert.strictEqual(setGlobalAttribute.callCount, 1);
			assert.strictEqual(setGlobalAttribute.firstCall.args[0], 'featureFlags');
			const parsed = JSON.parse(setGlobalAttribute.firstCall.args[1] as string);
			assert.deepStrictEqual(Object.keys(parsed), ['a-flag', 'm-flag', 'z-flag']);
			assert.strictEqual(parsed['a-flag'], 'variant-b');
			assert.strictEqual(parsed['m-flag'], 42);
			assert.strictEqual(parsed['z-flag'], true);
		});

		test('does not set attribute when featureFlags service is undefined', async () => {
			const setGlobalAttribute = sandbox.stub();
			await setFeatureFlagTelemetryGlobalAttributes({
				featureFlags: Promise.resolve(undefined),
				telemetry: { setGlobalAttribute },
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});

		test('does not set attribute when flags are empty', async () => {
			const setGlobalAttribute = sandbox.stub();
			const mockService = { getAllFlags: sandbox.stub().resolves({}) } as unknown as FeatureFlagService;
			await setFeatureFlagTelemetryGlobalAttributes({
				featureFlags: Promise.resolve(mockService),
				telemetry: { setGlobalAttribute },
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});

		test('handles error from getAllFlags gracefully', async () => {
			const setGlobalAttribute = sandbox.stub();
			const mockService = {
				getAllFlags: sandbox.stub().rejects(new Error('flags error')),
			} as unknown as FeatureFlagService;
			await assert.doesNotReject(async () => {
				await setFeatureFlagTelemetryGlobalAttributes({
					featureFlags: Promise.resolve(mockService),
					telemetry: { setGlobalAttribute },
				});
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});

		test('handles error from featureFlags promise gracefully', async () => {
			const setGlobalAttribute = sandbox.stub();
			await assert.doesNotReject(async () => {
				await setFeatureFlagTelemetryGlobalAttributes({
					featureFlags: Promise.reject(new Error('load error')),
					telemetry: { setGlobalAttribute },
				});
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});
	});
});
