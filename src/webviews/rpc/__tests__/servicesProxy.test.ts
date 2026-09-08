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
import { BranchError } from '@gitlens/git/errors.js';
import { disposeServices, presentServiceErrors, proxyServices } from '../services/proxy.js';

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

suite('presentServiceErrors', () => {
	test('maps an async method rejection carrying a GitCommandError to its localizedMessage', async () => {
		const services = {
			fail: async (): Promise<never> => {
				throw new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
			},
		};
		const expected = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });

		const wrapped = presentServiceErrors(services);
		await assert.rejects(
			async () => wrapped.fail(),
			(err: Error) => {
				assert.strictEqual(err.name, expected.name);
				assert.strictEqual(err.message, expected.localizedMessage);
				return true;
			},
		);
	});

	test('maps a sync method throw carrying a GitCommandError to its localizedMessage', () => {
		const services = {
			fail: (): never => {
				throw new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
			},
		};
		const expected = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });

		const wrapped = presentServiceErrors(services);
		assert.throws(
			() => wrapped.fail(),
			(err: Error) => {
				assert.strictEqual(err.name, expected.name);
				assert.strictEqual(err.message, expected.localizedMessage);
				return true;
			},
		);
	});

	test('leaves a plain Error thrown by a method completely unchanged', () => {
		const original = new Error('x');
		const services = {
			fail: (): never => {
				throw original;
			},
		};

		const wrapped = presentServiceErrors(services);
		assert.throws(
			() => wrapped.fail(),
			(err: Error) => {
				assert.strictEqual(err, original);
				return true;
			},
		);
	});

	test('maps errors thrown by a method on a nested service object', () => {
		const services = {
			graph: {
				fail: (): never => {
					throw new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
				},
			},
		};
		const expected = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });

		const wrapped = presentServiceErrors(services);
		assert.throws(
			() => wrapped.graph.fail(),
			(err: Error) => {
				assert.strictEqual(err.name, expected.name);
				assert.strictEqual(err.message, expected.localizedMessage);
				return true;
			},
		);
	});

	test('calls the wrapped method with the real target as `this`, not the proxy', () => {
		class Svc {
			#x = 42;

			getX(): number {
				return this.#x;
			}
		}

		const wrapped = presentServiceErrors(new Svc());
		assert.strictEqual(wrapped.getX(), 42);
	});

	test('passes non-function properties through unchanged and leaves resolved values untouched', async () => {
		const services = {
			label: 'a label',
			count: 5,
			ok: async (): Promise<string> => 'resolved value',
		};

		const wrapped = presentServiceErrors(services);
		assert.strictEqual(wrapped.label, 'a label');
		assert.strictEqual(wrapped.count, 5);
		assert.strictEqual(await wrapped.ok(), 'resolved value');
	});

	test('returns the identical wrapper function on repeated property access', () => {
		const services = { foo: (): string => 'bar' };

		const wrapped = presentServiceErrors(services);
		assert.strictEqual(wrapped.foo, wrapped.foo);
	});

	test('returns a Map-valued property unwrapped so it remains iterable', () => {
		const map = new Map<string, number>([
			['a', 1],
			['b', 2],
		]);
		const services = { data: map };

		const wrapped = presentServiceErrors(services);
		assert.strictEqual(wrapped.data, map);

		const entries: Array<[string, number]> = [];
		for (const entry of wrapped.data) {
			entries.push(entry);
		}
		assert.deepStrictEqual(entries, [
			['a', 1],
			['b', 2],
		]);
		assert.deepStrictEqual(
			[...wrapped.data.entries()],
			[
				['a', 1],
				['b', 2],
			],
		);
	});

	test('re-reads a reassigned method instead of serving a stale cached wrapper', () => {
		const services: { foo: () => string } = { foo: (): string => 'old' };

		const wrapped = presentServiceErrors(services);
		assert.strictEqual(wrapped.foo(), 'old');

		services.foo = (): string => 'new';
		assert.strictEqual(wrapped.foo(), 'new');
	});

	test('proxyServices wraps a service so a thrown GitCommandError reaches the marker with its localized message', async () => {
		const services = proxyServices({
			svc: {
				fail: async (): Promise<never> => {
					throw new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });
				},
			},
		});
		const expected = new BranchError({ action: 'create', branch: 'main', reason: 'alreadyExists' });

		await assert.rejects(
			async () => services.svc.fail(),
			(err: Error) => {
				assert.strictEqual(err.name, expected.name);
				assert.strictEqual(err.message, expected.localizedMessage);
				return true;
			},
		);
	});
});
