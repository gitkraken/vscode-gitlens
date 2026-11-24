import * as assert from 'node:assert';
import * as sinon from 'sinon';
import type { StoredKeplerInstall } from '../../../constants.storage.js';
import type { Container } from '../../../container.js';
import {
	keplerInstallCheckMaxDelay,
	keplerInstallHeartbeatInterval,
	KeplerInstallMonitor,
	keplerInstallStaleAfter,
} from '../keplerInstallMonitor.js';

suite('KeplerInstallMonitor', () => {
	let clock: sinon.SinonFakeTimers;
	let random: sinon.SinonStub;
	let stored: Record<string, StoredKeplerInstall> | undefined;
	let sendEvent: sinon.SinonSpy<unknown[], void>;
	let container: Container;
	const windows: KeplerInstallMonitor[] = [];

	function openWindow(): KeplerInstallMonitor {
		const monitor = new KeplerInstallMonitor(container);
		monitor.watchForAbandoned();
		windows.push(monitor);
		return monitor;
	}

	function abandoned(): unknown[] {
		return sendEvent.getCalls().map(c => c.args);
	}

	setup(() => {
		clock = sinon.useFakeTimers({
			now: 1_000_000,
			toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
		});
		random = sinon.stub(Math, 'random').returns(0);
		stored = undefined;
		sendEvent = sinon.spy((..._args: unknown[]) => {});
		container = {
			storage: {
				get: () => stored,
				store: (_key: string, value: Record<string, StoredKeplerInstall> | undefined) => {
					stored = value;
					return Promise.resolve();
				},
			},
			telemetry: { sendEvent: sendEvent },
		} as unknown as Container;
	});

	teardown(() => {
		for (const monitor of windows.splice(0)) {
			monitor.dispose();
		}
		random.restore();
		clock.restore();
	});

	test('an install that ends leaves nothing behind, so nothing is reported', () => {
		const first = openWindow();
		first.start('linux-appimage');
		first.setStep('download');
		clock.tick(45_000);
		first.stop();

		assert.strictEqual(stored, undefined);

		openWindow();
		clock.tick(keplerInstallStaleAfter * 3);
		assert.deepStrictEqual(abandoned(), []);
	});

	test('an install whose window closed is reported by the next window, with its last step and how long it ran', () => {
		const closed = openWindow();
		closed.start('windows-setup');
		closed.setStep('download');
		clock.tick(20_000);
		closed.setStep('install');
		clock.tick(keplerInstallHeartbeatInterval * 2);
		closed.dispose();

		clock.tick(10 * 60_000);
		openWindow();
		clock.tick(0);

		assert.deepStrictEqual(abandoned(), [
			['kepler/install/abandoned', { kind: 'windows-setup', step: 'install', duration: 60_000 }],
		]);
		assert.strictEqual(stored, undefined);

		openWindow();
		clock.tick(keplerInstallStaleAfter * 3);
		assert.strictEqual(sendEvent.callCount, 1);
	});

	test('a window reloaded mid-install reports it once the install has gone quiet, not at startup', () => {
		const reloaded = openWindow();
		reloaded.start('mac-zip');
		clock.tick(5_000);
		reloaded.dispose();

		openWindow();
		clock.tick(keplerInstallStaleAfter - 5_000 - 1);
		assert.deepStrictEqual(abandoned(), []);

		clock.tick(1);
		assert.deepStrictEqual(abandoned(), [
			['kepler/install/abandoned', { kind: 'mac-zip', step: undefined, duration: 0 }],
		]);
	});

	test("another window's running install is never reported, however long it takes", () => {
		const installing = openWindow();
		installing.start('windows-setup');
		installing.setStep('install');

		openWindow();
		clock.tick(30 * 60_000);
		assert.deepStrictEqual(abandoned(), []);

		installing.stop();
		clock.tick(30 * 60_000);
		assert.deepStrictEqual(abandoned(), []);
	});

	test('windows restored together report an abandoned install once', () => {
		const closed = openWindow();
		closed.start('linux-appimage');
		closed.dispose();
		clock.tick(keplerInstallStaleAfter);

		random.returns(0.2);
		openWindow();
		random.returns(0.7);
		openWindow();
		clock.tick(keplerInstallCheckMaxDelay);

		assert.strictEqual(sendEvent.callCount, 1);
	});

	test("an install started while another window's is running is concurrent; after a finished or abandoned one it is not", () => {
		const first = openWindow();
		const second = openWindow();

		assert.deepStrictEqual(first.start('windows-setup'), { concurrent: false });
		clock.tick(60_000);
		assert.deepStrictEqual(second.start('windows-setup'), { concurrent: true });
		second.stop();

		first.stop();
		assert.deepStrictEqual(second.start('windows-setup'), { concurrent: false });
		second.stop();

		first.start('windows-setup');
		first.dispose();
		clock.tick(keplerInstallStaleAfter - 1);
		assert.deepStrictEqual(second.start('windows-setup'), { concurrent: true });
		second.stop();
		clock.tick(1);
		assert.deepStrictEqual(second.start('windows-setup'), { concurrent: false });
	});
});
