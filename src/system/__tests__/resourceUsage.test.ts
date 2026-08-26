import * as assert from 'node:assert';
import * as sinon from 'sinon';
import { Logger } from '@gitlens/utils/logger.js';
import { ResourceUsageRegistry } from '../resourceUsage.js';

suite('ResourceUsageRegistry', () => {
	let registry: ResourceUsageRegistry;
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		registry = new ResourceUsageRegistry();
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		registry.dispose();
		sandbox.restore();
	});

	test('collects providers lazily and owns their namespaces', () => {
		const provider = sandbox.stub().returns({ 'entries.total.count': 2 });
		registry.register('cache', provider);

		assert.strictEqual(provider.callCount, 0);
		assert.deepStrictEqual(registry.collect(), { 'cache.entries.total.count': 2 });
		assert.strictEqual(provider.callCount, 1);
	});

	test('removes a provider when its registration is disposed', () => {
		const registration = registry.register('cache', () => ({ 'entries.total.count': 2 }));
		registration.dispose();

		assert.deepStrictEqual(registry.collect(), {});
	});

	test('rejects duplicate provider namespaces', () => {
		registry.register('cache', () => ({}));

		assert.throws(
			() => registry.register('cache', () => ({})),
			/Resource usage provider 'cache' is already registered/,
		);
	});

	test('isolates provider failures', () => {
		const error = new Error('failed');
		const logger = sandbox.stub(Logger, 'error');
		registry.register('broken', () => {
			throw error;
		});
		registry.register('cache', () => ({ 'entries.total.count': 2 }));

		assert.deepStrictEqual(registry.collect(), { 'cache.entries.total.count': 2 });
		sinon.assert.calledOnce(logger);
		assert.strictEqual(logger.firstCall.args[0], error);
		assert.strictEqual(logger.firstCall.args[1], 'ResourceUsageRegistry.collect(broken)');
	});
});
