import * as assert from 'assert';
import * as sinon from 'sinon';
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

function createMockClient(overrides?: Partial<Record<string, sinon.SinonStub>>): any {
	return {
		getValueDetailsAsync: sinon.stub().resolves({ value: true, isDefaultValue: false }),
		getAllValuesAsync: sinon.stub().resolves([]),
		dispose: sinon.stub(),
		waitForReady: sinon.stub().resolves(),
		forceRefreshAsync: sinon.stub().resolves(),
		...overrides,
	};
}

suite('FeatureFlagService Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let loadClientStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		loadClientStub = sandbox.stub(FeatureFlagService.prototype as any, 'loadClient');
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getFlag — client unavailable', () => {
		test('returns default boolean value', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('b', true), true);
			assert.strictEqual(await s.getFlag('b', false), false);
			s.dispose();
		});

		test('returns default string value', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('s', 'fallback'), 'fallback');
			s.dispose();
		});

		test('returns default number value', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('n', 99), 99);
			s.dispose();
		});
	});

	suite('getFlag — client available', () => {
		test('returns evaluated value from client', async () => {
			const mockClient = createMockClient({
				getValueDetailsAsync: sinon.stub().resolves({ value: 'variant-a', isDefaultValue: false }),
			});
			loadClientStub.resolves(mockClient);
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('experiment', 'control'), 'variant-a');
			s.dispose();
		});

		test('returns default when getValueDetailsAsync throws', async () => {
			const mockClient = createMockClient({
				getValueDetailsAsync: sinon.stub().rejects(new Error('eval error')),
			});
			loadClientStub.resolves(mockClient);
			const s = new FeatureFlagService(createMockContainer());
			assert.strictEqual(await s.getFlag('broken', 'safe-default'), 'safe-default');
			s.dispose();
		});
	});

	suite('getAllFlags — client unavailable', () => {
		test('returns empty object', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			assert.deepStrictEqual(await s.getAllFlags(), {});
			s.dispose();
		});
	});

	suite('getAllFlags — client available', () => {
		test('returns filtered map with only boolean/string/number values', async () => {
			const mockClient = createMockClient({
				getAllValuesAsync: sinon.stub().resolves([
					{ settingKey: 'bool-flag', settingValue: true },
					{ settingKey: 'str-flag', settingValue: 'on' },
					{ settingKey: 'num-flag', settingValue: 7 },
					{ settingKey: 'obj-flag', settingValue: { nested: true } },
					{ settingKey: 'null-flag', settingValue: null },
				]),
			});
			loadClientStub.resolves(mockClient);
			const s = new FeatureFlagService(createMockContainer());
			const flags = await s.getAllFlags();
			assert.deepStrictEqual(flags, { 'bool-flag': true, 'str-flag': 'on', 'num-flag': 7 });
			s.dispose();
		});

		test('returns empty object when getAllValuesAsync throws', async () => {
			const mockClient = createMockClient({
				getAllValuesAsync: sinon.stub().rejects(new Error('all values error')),
			});
			loadClientStub.resolves(mockClient);
			const s = new FeatureFlagService(createMockContainer());
			assert.deepStrictEqual(await s.getAllFlags(), {});
			s.dispose();
		});
	});

	suite('dispose', () => {
		test('does not throw when client is unavailable', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			await s.getFlag('any', false);
			assert.doesNotThrow(() => s.dispose());
		});

		test('does not throw when called multiple times', async () => {
			loadClientStub.resolves(undefined);
			const s = new FeatureFlagService(createMockContainer());
			await s.getFlag('any', false);
			assert.doesNotThrow(() => {
				s.dispose();
				s.dispose();
			});
		});

		test('disposes the underlying client', async () => {
			const mockClient = createMockClient();
			loadClientStub.resolves(mockClient);
			const s = new FeatureFlagService(createMockContainer());
			await s.getFlag('any', false);
			s.dispose();
			// Give the then() callback a tick to run
			await new Promise(resolve => setTimeout(resolve, 10));
			assert.strictEqual(mockClient.dispose.callCount, 1);
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
