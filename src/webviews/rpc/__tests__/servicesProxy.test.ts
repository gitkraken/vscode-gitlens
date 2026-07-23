/**
 * Covers the service disposal mechanism introduced for #5513 (eager signal-freshness
 * listeners in `SubscriptionService` must be released at webview teardown).
 *
 * `SubscriptionService` itself cannot be imported here: it runtime-imports
 * `system/-webview/context.ts` → `command.ts` → `container.ts`, a chain that cannot
 * initialize in the self-contained test bundle (circular-init on `@command` registration).
 * Its eager-freshness behavior is exercised against the live extension instead.
 */

import * as assert from 'assert';
import * as sinon from 'sinon';
import { disposeServices, proxyServices } from '../services/proxy.js';

suite('RPC services proxy/disposal Test Suite', () => {
	test('disposes collected disposable services exactly once and skips the rest', () => {
		const dispose = sinon.spy();
		const services = proxyServices({
			disposable: { dispose: dispose, other: () => {} },
			plain: { other: () => {} },
			fn: () => {},
			nothing: undefined,
		});

		disposeServices(services);
		assert.strictEqual(dispose.callCount, 1);
	});

	test('is idempotent — disposing twice does not re-dispose services', () => {
		const dispose = sinon.spy();
		const services = proxyServices({ disposable: { dispose: dispose } });

		disposeServices(services);
		disposeServices(services);
		assert.strictEqual(dispose.callCount, 1);
	});

	test('collected disposables are not exposed as an enumerable property', () => {
		const services = proxyServices({ disposable: { dispose: () => {} } });
		assert.deepStrictEqual(Object.keys(services), ['disposable']);
		assert.strictEqual(
			Object.entries(services).every(([, value]) => value != null),
			true,
		);
	});

	test('is a safe no-op for objects without collected disposables', () => {
		assert.doesNotThrow(() => disposeServices({}));
		assert.doesNotThrow(() => disposeServices(undefined));
	});
});
