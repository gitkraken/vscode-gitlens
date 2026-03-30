import * as assert from 'assert';
import * as sinon from 'sinon';
import { Logger } from '@gitlens/utils/logger.js';
import type { FeatureFlagMap, FeatureFlagService } from '../featureFlagService.js';
import { ConfigCatFeatureFlagService, FeatureFlagKey } from '../featureFlagService.js';

// Replicate the module-private setFeatureFlagTelemetryGlobalAttributes from extension.ts
// so we can unit test its logic independently.
async function setFeatureFlagTelemetryGlobalAttributes(container: {
	featureFlags: Promise<FeatureFlagService | undefined>;
	telemetry: { setGlobalAttribute(key: string, value: string): void };
}): Promise<void> {
	try {
		const featureFlags = await container.featureFlags;
		if (featureFlags == null) return;
		const flags = featureFlags.getAllFlags();
		if (Object.keys(flags).length === 0) return;
		container.telemetry.setGlobalAttribute(
			'featureFlags',
			JSON.stringify(Object.fromEntries(Object.entries(flags).sort(([a], [b]) => a.localeCompare(b)))),
		);
	} catch (ex) {
		Logger.error(ex, 'setFeatureFlagTelemetryGlobalAttributes');
	}
}

function createMockContainer(flags?: FeatureFlagMap): any {
	return {
		urls: { getGkApiUrl: (...segments: string[]) => `https://api.test.com/${segments.join('/')}` },
		env: 'production',
		debugging: false,
		prereleaseOrDebugging: false,
		storage: {
			get: sinon.stub().returns(flags),
			store: sinon.stub().resolves(),
		},
	};
}

suite('FeatureFlagService Test Suite', () => {
	let sandbox: sinon.SinonSandbox;
	let fetchAndCacheFlagsStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		// Prevent background fetch from running during tests
		fetchAndCacheFlagsStub = sandbox
			.stub(ConfigCatFeatureFlagService.prototype as any, 'fetchAndCacheFlags')
			.resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getFlag — no cached flags', () => {
		test('returns default boolean value', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, true), true);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, false), false);
			s.dispose();
		});

		test('returns default string value', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, 'fallback'), 'fallback');
			s.dispose();
		});

		test('returns default number value', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, 99), 99);
			s.dispose();
		});
	});

	suite('getFlag — cached flags available', () => {
		test('returns cached value over default', () => {
			const s = new ConfigCatFeatureFlagService(
				createMockContainer({ [FeatureFlagKey.WelcomeTitle]: 'variant-a' }),
			);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, 'control'), 'variant-a');
			s.dispose();
		});
	});

	suite('getAllFlags — no cached flags', () => {
		test('returns empty object', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.deepStrictEqual(s.getAllFlags(), {});
			s.dispose();
		});
	});

	suite('getAllFlags — cached flags available', () => {
		test('returns cached flag map', () => {
			const flags: FeatureFlagMap = { [FeatureFlagKey.WelcomeTitle]: true };
			const s = new ConfigCatFeatureFlagService(createMockContainer(flags));
			assert.deepStrictEqual(s.getAllFlags(), flags);
			s.dispose();
		});
	});

	suite('constructor', () => {
		test('fires background fetch on construction', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(fetchAndCacheFlagsStub.callCount, 1);
			s.dispose();
		});
	});

	suite('dispose', () => {
		test('does not throw when called', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.doesNotThrow(() => s.dispose());
		});

		test('does not throw when called multiple times', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
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
				getAllFlags: sandbox.stub().returns({ 'z-flag': true, 'a-flag': 'variant-b', 'm-flag': 42 }),
			} as unknown as FeatureFlagService;
			const container = {
				featureFlags: Promise.resolve(mockService),
				telemetry: { setGlobalAttribute: setGlobalAttribute },
			};
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
				telemetry: { setGlobalAttribute: setGlobalAttribute },
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});

		test('does not set attribute when flags are empty', async () => {
			const setGlobalAttribute = sandbox.stub();
			const mockService = { getAllFlags: sandbox.stub().returns({}) } as unknown as FeatureFlagService;
			await setFeatureFlagTelemetryGlobalAttributes({
				featureFlags: Promise.resolve(mockService),
				telemetry: { setGlobalAttribute: setGlobalAttribute },
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});

		test('handles error from featureFlags promise gracefully', async () => {
			const setGlobalAttribute = sandbox.stub();
			await assert.doesNotReject(async () => {
				await setFeatureFlagTelemetryGlobalAttributes({
					featureFlags: Promise.reject(new Error('load error')),
					telemetry: { setGlobalAttribute: setGlobalAttribute },
				});
			});
			assert.strictEqual(setGlobalAttribute.callCount, 0);
		});
	});
});
