import * as assert from 'assert';
import * as sinon from 'sinon';
import type { FeatureFlagMap } from '../featureFlagService.js';
import { ConfigCatFeatureFlagService, FeatureFlagKey } from '../featureFlagService.js';

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

	setup(() => {
		sandbox = sinon.createSandbox();
		// Prevent background fetch from running during tests
		sandbox.stub(ConfigCatFeatureFlagService.prototype as any, 'fetchAndCacheFlags').resolves();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getFlag — no cached flags', () => {
		test('returns default value for each type', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, true), true);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, false), false);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitle, 'fallback'), 'fallback');
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
});
