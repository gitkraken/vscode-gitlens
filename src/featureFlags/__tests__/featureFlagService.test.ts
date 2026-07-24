import * as assert from 'assert';
import * as crypto from 'crypto';
import * as http from 'http';
import * as sinon from 'sinon';
import { env as vscodeEnv } from 'vscode';
import type { FeatureFlagMap } from '../featureFlagService.js';
import { ConfigCatFeatureFlagService, FeatureFlagKey } from '../featureFlagService.js';

const testSalt = 'test-salt';
const testMachineId = 'test-machine-id';

/**
 * Computes the same SHA-256 hash that ConfigCat SDK uses for sensitive comparisons.
 * Hash input: utf8(value) + utf8(configJsonSalt) + utf8(settingKey)
 */
function configCatHash(value: string, settingKey: string): string {
	const input = Buffer.concat([
		Buffer.from(value, 'utf8'),
		Buffer.from(testSalt, 'utf8'),
		Buffer.from(settingKey, 'utf8'),
	]);
	return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Computes the hashed-prefix format used by ConfigCat's "starts with" comparator (22).
 * Format: `{prefixByteLength}_{SHA256(value[0:prefixByteLength] + salt + settingKey)}`
 */
function configCatHashPrefix(value: string, prefixByteLen: number, settingKey: string): string {
	const slice = Buffer.from(value, 'utf8').subarray(0, prefixByteLen);
	const input = Buffer.concat([slice, Buffer.from(testSalt, 'utf8'), Buffer.from(settingKey, 'utf8')]);
	return `${prefixByteLen}_${crypto.createHash('sha256').update(input).digest('hex')}`;
}

/** Builds a ConfigCat v6 config JSON string with the real structure from our dev server. */
function makeConfigJson(flags: Record<string, Record<string, unknown>>): string {
	return JSON.stringify({
		p: { u: 'https://cdn-global.configcat.com', r: 0, s: testSalt },
		f: flags,
	});
}

function createMockContainer(flags?: FeatureFlagMap, onStore?: () => void): any {
	let f = flags;
	return {
		urls: { getGkApiUrl: (...segments: string[]) => `https://api.test.com/${segments.join('/')}` },
		env: 'production',
		debugging: false,
		prereleaseOrDebugging: false,
		storage: {
			get: sinon.stub().callsFake(() => f),
			store: sinon.stub().callsFake((_key: string, v: FeatureFlagMap) => {
				f = v;
				onStore?.();
			}),
		},
	};
}

suite('FeatureFlagService Test Suite', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		// Prevent background fetch from running during tests by default
		sandbox.stub(ConfigCatFeatureFlagService.prototype as any, 'fetchAndCacheFlags').resolves();
		// Use a deterministic machine ID so we can pre-compute hashes
		sandbox.stub(vscodeEnv, 'machineId').value(testMachineId);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getFlag', () => {
		test('returns default values when no flags are cached', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, true), true);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, false), false);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'fallback'), 'fallback');
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, 99), 99);
			s.dispose();
		});

		test('returns cached value over default', () => {
			const s = new ConfigCatFeatureFlagService(
				createMockContainer({ [FeatureFlagKey.WelcomeTitleVariant]: 'variant-a' }),
			);
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'control'), 'variant-a');
			s.dispose();
		});
	});

	suite('getAllFlags', () => {
		test('returns empty object when no flags are cached', () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());
			assert.deepStrictEqual(s.getAllFlags(), {});
			s.dispose();
		});

		test('returns cached flag map', () => {
			const flags: FeatureFlagMap = { [FeatureFlagKey.WelcomeTitleVariant]: true };
			const s = new ConfigCatFeatureFlagService(createMockContainer(flags));
			assert.deepStrictEqual(s.getAllFlags(), flags);
			s.dispose();
		});
	});

	suite('evaluateFlags — ConfigCat parsing', () => {
		test('parses boolean, string, and integer flag types', async () => {
			const s = new ConfigCatFeatureFlagService(createMockContainer());

			const cases: { type: number; value: Record<string, unknown>; expected: unknown }[] = [
				{ type: 0, value: { b: true }, expected: true },
				{ type: 1, value: { s: 'variant-b' }, expected: 'variant-b' },
				{ type: 2, value: { i: 42 }, expected: 42 },
			];

			for (const { type, value, expected } of cases) {
				const configJson = makeConfigJson({
					[FeatureFlagKey.WelcomeTitleVariant]: { t: type, v: value, i: 'var-1' },
				});
				const result: FeatureFlagMap | undefined = await (s as any).evaluateFlags(configJson);

				assert.ok(result != null, `evaluateFlags should return a flag map for type ${type}`);
				assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], expected);
			}

			s.dispose();
		});

		test('ignores flags with keys not in FeatureFlagKey', async () => {
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: { t: 0, v: { b: true }, i: 'var-1' },
				unknownFlag: { t: 1, v: { s: 'should-be-ignored' }, i: 'var-x' },
			});

			const s = new ConfigCatFeatureFlagService(createMockContainer());
			const result: FeatureFlagMap | undefined = await (s as any).evaluateFlags(configJson);

			assert.ok(result != null);
			assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], true);
			assert.strictEqual(Object.keys(result).length, 1, 'should only contain known flag keys');
			s.dispose();
		});
	});

	suite('evaluateFlags — targeting rules with hashed comparisons', () => {
		// Comparator 16: Identifier IS ONE OF (hashed)
		test('identifier equals (hashed) — positive match', async () => {
			const hash = configCatHash(testMachineId, FeatureFlagKey.WelcomeTitleVariant);
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: {
					t: 0,
					r: [
						{
							c: [{ u: { a: 'Identifier', c: 16, l: [hash] } }],
							s: { v: { b: true }, i: 'rule-match' },
						},
					],
					v: { b: false },
					i: 'default',
				},
			});

			const s = new ConfigCatFeatureFlagService(createMockContainer());
			const result = await (s as any).evaluateFlags(configJson);

			assert.ok(result != null);
			assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], true, 'should match the targeting rule');
			s.dispose();
		});

		test('identifier equals (hashed) — negative, no match', async () => {
			const wrongHash = configCatHash('some-other-machine-id', FeatureFlagKey.WelcomeTitleVariant);
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: {
					t: 0,
					r: [
						{
							c: [{ u: { a: 'Identifier', c: 16, l: [wrongHash] } }],
							s: { v: { b: true }, i: 'rule-match' },
						},
					],
					v: { b: false },
					i: 'default',
				},
			});

			const s = new ConfigCatFeatureFlagService(createMockContainer());
			const result = await (s as any).evaluateFlags(configJson);

			assert.ok(result != null);
			assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], false, 'should fall through to default');
			s.dispose();
		});

		// Comparator 22: Identifier STARTS WITH ANY OF (hashed)
		// testMachineId = 'test-machine-id', prefix 'test-' = 5 bytes
		test('identifier starts with (hashed) — positive match', async () => {
			const prefixHash = configCatHashPrefix(testMachineId, 5, FeatureFlagKey.WelcomeTitleVariant);
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: {
					t: 0,
					r: [
						{
							c: [{ u: { a: 'Identifier', c: 22, l: [prefixHash] } }],
							s: { v: { b: true }, i: 'rule-match' },
						},
					],
					v: { b: false },
					i: 'default',
				},
			});

			const s = new ConfigCatFeatureFlagService(createMockContainer());
			const result = await (s as any).evaluateFlags(configJson);

			assert.ok(result != null);
			assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], true, 'should match the starts-with rule');
			s.dispose();
		});

		test('identifier starts with (hashed) — negative, no match', async () => {
			const wrongPrefixHash = configCatHashPrefix('other-prefix-id', 6, FeatureFlagKey.WelcomeTitleVariant);
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: {
					t: 0,
					r: [
						{
							c: [{ u: { a: 'Identifier', c: 22, l: [wrongPrefixHash] } }],
							s: { v: { b: true }, i: 'rule-match' },
						},
					],
					v: { b: false },
					i: 'default',
				},
			});

			const s = new ConfigCatFeatureFlagService(createMockContainer());
			const result = await (s as any).evaluateFlags(configJson);

			assert.ok(result != null);
			assert.strictEqual(result[FeatureFlagKey.WelcomeTitleVariant], false, 'should fall through to default');
			s.dispose();
		});
	});

	suite('flags lifecycle', () => {
		test('serves flags from storage immediately, before fetch completes', () => {
			const storedFlags: FeatureFlagMap = { [FeatureFlagKey.WelcomeTitleVariant]: 'cached-value' };
			const s = new ConfigCatFeatureFlagService(createMockContainer(storedFlags));

			// These are available synchronously — no await needed
			assert.strictEqual(s.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'default'), 'cached-value');
			assert.deepStrictEqual(s.getAllFlags(), storedFlags);
			s.dispose();
		});

		test('fetchAndCacheFlags stores evaluated flags to storage', async () => {
			const configJson = makeConfigJson({
				[FeatureFlagKey.WelcomeTitleVariant]: { t: 1, v: { s: 'new-value' }, i: 'var-1' },
			});

			// Spin up a local HTTP server that serves the config JSON
			const server = http.createServer((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(configJson);
			});
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			const port = (server.address() as import('net').AddressInfo).port;

			try {
				// Create a promise that resolves when storage.store is called
				let onStored: () => void;
				const stored = new Promise<void>(resolve => (onStored = resolve));

				const container = createMockContainer({ [FeatureFlagKey.WelcomeTitleVariant]: 'old-value' }, () =>
					onStored(),
				);
				// Point the URL at our local server so the real fetch hits it
				container.urls.getGkApiUrl = () => `http://127.0.0.1:${port}/feature-flags/config`;

				// Let the real fetchAndCacheFlags run
				(ConfigCatFeatureFlagService.prototype as any).fetchAndCacheFlags.restore();

				const s1 = new ConfigCatFeatureFlagService(container);

				// Wait for the background fire-and-forget fetch to complete (bounded to avoid CI stalls)
				const timeout = new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Timed out waiting for storage.store to be called')), 5000),
				);
				await Promise.race([stored, timeout]);

				// Verify storage received the evaluated flags
				assert.ok(container.storage.store.calledOnce, 'storage.store should have been called');
				const storedFlags = container.storage.store.firstCall.args[1] as FeatureFlagMap;
				assert.strictEqual(
					storedFlags[FeatureFlagKey.WelcomeTitleVariant],
					'new-value',
					'should store the evaluated flag value',
				);

				// s1 still serves the old flags — new ones are for the next activation
				assert.strictEqual(s1.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'default'), 'old-value');

				// A new service instance reads the updated storage
				sandbox.stub(ConfigCatFeatureFlagService.prototype as any, 'fetchAndCacheFlags').resolves();
				const s2 = new ConfigCatFeatureFlagService(container);
				assert.strictEqual(s2.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'default'), 'new-value');

				s1.dispose();
				s2.dispose();
			} finally {
				await new Promise<void>(resolve => server.close(() => resolve()));
			}
		});

		test('flags are frozen at construction and unaffected by later storage changes', () => {
			const oldFlags: FeatureFlagMap = { [FeatureFlagKey.WelcomeTitleVariant]: 'old-value' };
			const container = createMockContainer(oldFlags);
			const s = new ConfigCatFeatureFlagService(container);

			// Simulate storage being updated (as fetchAndCacheFlags would do)
			container.storage.store('featureFlags:flags', { [FeatureFlagKey.WelcomeTitleVariant]: 'new-value' });

			// Service still returns the flags it read at construction
			assert.strictEqual(
				s.getFlag(FeatureFlagKey.WelcomeTitleVariant, 'default'),
				'old-value',
				'should still serve flags from initial storage read',
			);
			assert.deepStrictEqual(s.getAllFlags(), oldFlags);
			s.dispose();
		});
	});
});
