import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import * as sinon from 'sinon';
import type { CancellationToken, Progress } from 'vscode';
import { window } from 'vscode';
// Side-effect only: `keplerService.ts` pulls in `system/-webview/context.js` for `setContext`, which
// loads `system/-webview/command.js`, whose first load is re-entered through container.ts's dependency
// chain before its `registrableCommands` array exists. Loading container.ts first avoids it.
import '../../../container.js';
import type { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import type { KeplerRelease } from '../keplerRelease.js';
import { KeplerService } from '../keplerService.js';

function makeContainer(prereleaseOrDebugging: boolean): Container {
	return { prereleaseOrDebugging: prereleaseOrDebugging } as unknown as Container;
}

// The channel/scheme suites never see an install, so they don't touch the real filesystem
const notInstalled = (): boolean => false;
// Nor do the registry or Launch Services get asked: on a machine with Kepler they would find it
const notLocated = (): Promise<string | undefined> => Promise.resolve(undefined);

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
		const service = new KeplerService(makeContainer(false), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'production');
	});

	test("whitelists 'staging' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'staging');
	});

	test("whitelists 'dev' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'dev');
	});

	test("whitelists 'source' when prereleaseOrDebugging is true", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'source');
	});

	test("maps 'source-debug' to the source channel and scheme", () => {
		sandbox.stub(configuration, 'getAny').returns('source-debug');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'source');
		assert.strictEqual(service.scheme, 'kepler-source://');
		assert.strictEqual(service.debugging, true);
	});

	test("ignores 'source-debug' when prereleaseOrDebugging is false", () => {
		sandbox.stub(configuration, 'getAny').returns('source-debug');
		const service = new KeplerService(makeContainer(false), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'production');
		assert.strictEqual(service.debugging, false);
	});

	test('degrades an unrecognised value to production', () => {
		sandbox.stub(configuration, 'getAny').returns('not-a-real-channel');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'production');
	});

	test('degrades an unset value to production', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.channel, 'production');
	});

	test('is memoized — the setting is only read once per instance', () => {
		const getAny = sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

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
		const service = new KeplerService(makeContainer(false), notInstalled, false, notLocated);

		assert.strictEqual(service.scheme, 'kepler://');
	});

	test("'staging' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('staging');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.scheme, 'kepler-staging://');
	});

	test("'dev' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('dev');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

		assert.strictEqual(service.scheme, 'kepler-dev://');
	});

	test("'source' channel takes the slug suffix", () => {
		sandbox.stub(configuration, 'getAny').returns('source');
		const service = new KeplerService(makeContainer(true), notInstalled, false, notLocated);

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

		const service = new KeplerService(container, probe, false, notLocated);

		// Before `installed` is ever read
		assert.strictEqual(probe.callCount, 1);
		assert.deepStrictEqual(probe.firstCall.args, ['staging']);

		assert.strictEqual(service.installed, false);
		assert.strictEqual(probe.callCount, 2);
	});

	test('picks up a Kepler installed after construction, and Install Kepler then installs nothing but says so', async () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const probe = sandbox.stub().returns(false);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});
		const withProgress = sandbox.spy(window, 'withProgress');
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);

		const service = new KeplerService(container, probe, false, notLocated);
		assert.strictEqual(service.installed, false);

		probe.returns(true);
		assert.strictEqual(service.installed, true);
		assert.deepStrictEqual(track.firstCall.args, ['action:gitlens.kepler.installed:happened']);

		assert.strictEqual(await service.install(), true);
		assert.strictEqual(withProgress.callCount, 0);
		assert.strictEqual(showInformationMessage.callCount, 1);
		assert.strictEqual(showInformationMessage.firstCall.args[0], 'Kepler is installed.');
	});

	test('does not take a half-installed Kepler for installed while an install runs; a second install joins it', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const probe = sandbox.stub().returns(false);
		const container = {
			prereleaseOrDebugging: false,
			usage: { isUsed: () => false, track: sandbox.stub().resolves() },
			telemetry: { sendEvent: sandbox.spy() },
		} as unknown as Container;
		// The install never finishes within the test; only its in-flight state matters
		sandbox.stub(window, 'withProgress').returns(new Promise(() => {}));

		const service = new KeplerService(container, probe, false, notLocated);
		const first = service.install();

		// The Windows setup creates the install folder long before it registers kepler://
		probe.returns(true);
		assert.strictEqual(service.installed, false);
		assert.strictEqual(service.install(), first);
	});

	test('picks up a Kepler that only the registry or Launch Services knows about, outside the probed folders', async () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});
		const located = Promise.resolve('/Users/me/Tools/Kepler.app');
		const locate = sandbox.stub().returns(located);

		const service = new KeplerService(container, () => false, false, locate);
		assert.strictEqual(service.installed, false);
		assert.deepStrictEqual(locate.firstCall.args, ['production']);

		await located;
		assert.strictEqual(service.installed, true);
		assert.deepStrictEqual(track.firstCall.args, ['action:gitlens.kepler.installed:happened']);
	});

	test('tracks the installed usage when Kepler is detected', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: false,
		});

		const service = new KeplerService(container, () => true, false, notLocated);

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

		const service = new KeplerService(container, () => false, false, notLocated);

		assert.strictEqual(service.installed, false);
		assert.strictEqual(track.callCount, 0);
	});

	test('does not re-track an install that is already tracked', () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const { container, track } = makeUsageContainer({
			prereleaseOrDebugging: false,
			alreadyTracked: true,
		});

		const service = new KeplerService(container, () => true, false, notLocated);

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

		const service = new KeplerService(container, probe, false, notLocated);

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

		const service = new KeplerService(container, probe, false, notLocated);

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

		const service = new KeplerService(container, probe, true, notLocated);

		assert.strictEqual(service.installed, undefined);
		assert.strictEqual(probe.callCount, 0);
		assert.strictEqual(track.callCount, 0);
	});
});

// A real install end to end, with the Linux AppImage because it installs into `HOME` and needs no admin
// rights: a local server stands in for Kepler's CDN and a stub `xdg-mime` for the desktop's registration
suite('KeplerService.install — cancel', () => {
	const appImage = Buffer.from('#!/bin/sh\necho kepler\n'.repeat(1024));
	let sandbox: sinon.SinonSandbox;
	let dir: string;
	let server: Server;
	let release: KeplerRelease;
	const originalHome = process.env.HOME;
	const originalPath = process.env.PATH;

	suiteSetup(async function () {
		if (process.platform === 'win32') {
			this.skip();
		}

		server = createServer((_req, res) => {
			res.writeHead(200, { 'content-length': appImage.length });
			res.end(appImage);
		});
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		release = {
			kind: 'linux-appimage',
			url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/kepler-x64.AppImage`,
			fileName: 'kepler-x64.AppImage',
			version: '0.16.0',
			size: appImage.length,
			sha512: createHash('sha512').update(appImage).digest('base64'),
		};
	});

	suiteTeardown(async () => {
		await new Promise<void>(resolve => (server != null ? server.close(() => resolve()) : resolve()));
	});

	setup(async () => {
		sandbox = sinon.createSandbox();
		dir = await mkdtemp(join(tmpdir(), 'gitlens-kepler-service-'));
		process.env.HOME = join(dir, 'home');

		const bin = join(dir, 'bin');
		await mkdir(bin, { recursive: true });
		await writeFile(join(bin, 'xdg-mime'), '#!/bin/sh\nexit 0\n');
		await chmod(join(bin, 'xdg-mime'), 0o755);
		process.env.PATH = `${bin}${delimiter}${originalPath}`;
	});

	teardown(async () => {
		sandbox.restore();
		process.env.HOME = originalHome;
		process.env.PATH = originalPath;
		await rm(dir, { recursive: true, force: true });
	});

	test('a Cancel after the point of no return keeps the install but resolves false, quietly', async () => {
		sandbox.stub(configuration, 'getAny').returns(undefined);
		const sendEvent = sandbox.spy((_event: string) => {});
		const container = {
			prereleaseOrDebugging: false,
			usage: { isUsed: () => false, track: sandbox.stub().resolves() },
			telemetry: { sendEvent: sendEvent },
		} as unknown as Container;
		const showInformationMessage = sandbox.stub(window, 'showInformationMessage').resolves(undefined);
		const showErrorMessage = sandbox.stub(window, 'showErrorMessage').resolves(undefined);

		// The user clicks Cancel as the last step — registering kepler:// — begins; on Linux nothing
		// checks for a cancel after that
		let cancelled = false;
		const listeners: (() => void)[] = [];
		const token = {
			get isCancellationRequested() {
				return cancelled;
			},
			onCancellationRequested: (listener: () => void) => {
				listeners.push(listener);
				return { dispose: () => {} };
			},
		} as unknown as CancellationToken;
		const progress: Progress<{ message?: string; increment?: number }> = {
			report: value => {
				if (value.message === 'Registering kepler:// links…') {
					cancelled = true;
					for (const listener of listeners) {
						listener();
					}
				}
			},
		};
		sandbox.stub(window, 'withProgress').callsFake((_options, task) => task(progress, token));

		const service = new KeplerService(container, () => false, false, notLocated);
		sandbox.stub(service, 'getRelease').resolves(release);

		assert.strictEqual(await service.install(), false);

		assert.strictEqual(cancelled, true);
		assert.strictEqual(service.installed, true);
		assert.strictEqual(showInformationMessage.callCount, 0);
		assert.strictEqual(showErrorMessage.callCount, 0);
		assert.deepStrictEqual(
			sendEvent.getCalls().map(c => c.args[0]),
			['kepler/install/started', 'kepler/install/completed'],
		);
	});
});
