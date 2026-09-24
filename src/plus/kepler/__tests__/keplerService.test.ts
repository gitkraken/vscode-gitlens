import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { KeplerService } from '../keplerService.js';

function makeContainer(prereleaseOrDebugging: boolean): Container {
	return { prereleaseOrDebugging: prereleaseOrDebugging } as unknown as Container;
}

// The channel/scheme suites never see an install, so they don't touch the real filesystem
const notInstalled = (): boolean => false;

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
		const service = new KeplerService(makeContainer(false), notInstalled);

		assert.strictEqual(service.channel, 'production');
	});

	test("whitelists 'staging' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'staging');
	});

	test("whitelists 'dev' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'dev');
	});

	test("whitelists 'source' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'source');
	});

	test("maps 'source-debug' to the source channel and scheme", () => {
		sandbox.stub(configuration, 'getAny').returns('source-debug');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'source');
		assert.strictEqual(service.scheme, 'kepler-source://');
		assert.strictEqual(service.debugging, true);
	});

	test("ignores 'source-debug' when prereleaseOrDebugging is false", () => {
		sandbox.stub(configuration, 'getAny').returns('source-debug');
		const service = new KeplerService(makeContainer(false), notInstalled);

		assert.strictEqual(service.channel, 'production');
		assert.strictEqual(service.debugging, false);
	});

	test('degrades an unrecognised value to production', () => {
		sandbox.stub(configuration, 'getAny').returns('not-a-real-channel');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'production');
	});

	test('degrades an unset value to production', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.channel, 'production');
	});

	test('is memoized — the setting is only read once per instance', () => {
		const getAny = sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled);

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
		const service = new KeplerService(makeContainer(false), notInstalled);

		assert.strictEqual(service.scheme, 'kepler://');
	});

	test("'staging' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.scheme, 'kepler-staging://');
	});

	test("'dev' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.scheme, 'kepler-dev://');
	});

	test("'source' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true), notInstalled);

		assert.strictEqual(service.scheme, 'kepler-source://');
	});
});

suite('KeplerService.installed', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	function makeUsageContainer(options: { prereleaseOrDebugging: boolean; alreadyTracked: boolean }): {
		container: Container;
		track: sinon.SinonStub;
	} {
		const track = sandbox.stub().resolves();
		const container = {
			prereleaseOrDebugging: options.prereleaseOrDebugging,
			usage: { isUsed: () => options.alreadyTracked, track: track },
		} as unknown as Container;
		return { container: container, track: track };
	}

	test('probes eagerly at construction, for the configured channel', () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const probe = sandbox.stub().returns(false);
		const { container } = makeUsageContainer({
			prereleaseOrDebugging: true,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, probe, false);

		// Before `installed` is ever read
		assert.strictEqual(probe.callCount, 1);
		assert.deepStrictEqual(probe.firstCall.args, ['staging']);

		assert.strictEqual(service.installed, false);
		assert.strictEqual(service.installed, false);
		assert.strictEqual(probe.callCount, 1);
	});

	test('tracks the installed usage when Kepler is detected', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, () => true, false);

		assert.strictEqual(service.installed, true);
		assert.strictEqual(track.callCount, 1);
		assert.deepStrictEqual(track.firstCall.args, ['action:gitlens.kepler.installed:happened']);
	});

	test('does not track when Kepler is not detected', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, () => false, false);

		assert.strictEqual(service.installed, false);
		assert.strictEqual(track.callCount, 0);
	});

	test('does not re-track an install that is already tracked', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: true,
		});

		const service = new KeplerService(container, () => true, false);

		assert.strictEqual(service.installed, true);
		assert.strictEqual(track.callCount, 0);
	});

	test("assumes installed under 'source-debug' without probing or tracking", () => {
		sandbox.stub(configuration, 'getAny').returns('source-debug');
		const probe = sandbox.stub().returns(false);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: true,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, probe, false);

		assert.strictEqual(service.installed, true);
		assert.strictEqual(probe.callCount, 0);
		assert.strictEqual(track.callCount, 0);
	});

	test("still probes a packaged 'source' build", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const probe = sandbox.stub().returns(true);
		const { container } = makeUsageContainer({
			prereleaseOrDebugging: true,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, probe, false);

		assert.strictEqual(service.installed, true);
		assert.deepStrictEqual(probe.firstCall.args, ['source']);
	});

	test('is undefined on a remote extension host, the probe is skipped, and nothing is tracked', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		// Would report installed if it were consulted, to prove the probe genuinely isn't
		const probe = sandbox.stub().returns(true);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, probe, true);

		assert.strictEqual(service.installed, undefined);
		assert.strictEqual(probe.callCount, 0);
		assert.strictEqual(track.callCount, 0);
	});
});
