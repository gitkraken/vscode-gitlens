import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { KeplerService } from '../keplerService.js';

function makeContainer(prereleaseOrDebugging: boolean): Container {
	return { prereleaseOrDebugging: prereleaseOrDebugging } as unknown as Container;
}

suite('KeplerService.channel', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('is production when prereleaseOrDebugging is false, regardless of the setting', () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(false));

		assert.strictEqual(service.channel, 'production');
	});

	test("whitelists 'staging' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'staging');
	});

	test("whitelists 'dev' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'dev');
	});

	test("whitelists 'source' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'source');
	});

	test('degrades an unrecognised value to production', () => {
		sandbox.stub(configuration, 'getAny').returns('not-a-real-channel');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'production');
	});

	test('degrades an unset value to production', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'production');
	});

	test('is memoized — the setting is only read once per instance', () => {
		const getAny = sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.channel, 'dev');
		assert.strictEqual(service.channel, 'dev');
		assert.strictEqual(getAny.callCount, 1);
	});
});

suite('KeplerService.scheme', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	test('production channel keeps the bare scheme', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const service = new KeplerService(makeContainer(false));

		assert.strictEqual(service.scheme, 'kepler://');
	});

	test("'staging' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.scheme, 'kepler-staging://');
	});

	test("'dev' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.scheme, 'kepler-dev://');
	});

	test("'source' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true));

		assert.strictEqual(service.scheme, 'kepler-source://');
	});
});
