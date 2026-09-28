import * as assert from 'assert';
import * as sinon from 'sinon';
import type { ConfigurationChangeEvent } from 'vscode';
import { EventEmitter } from 'vscode';
import { configuration } from '../../../system/-webview/configuration.js';
import type { WebviewHostEnvironment } from '../../hostEnvironment.js';
import { EventVisibilityBuffer } from '../eventVisibilityBuffer.js';
import type { WebviewViewServiceHost } from '../webviewViewService.js';
import { WebviewViewService } from '../webviewViewService.js';

function createHost(): WebviewViewServiceHost {
	const never = new EventEmitter<boolean>().event;
	return {
		onDidChangeVisibility: never,
		onDidChangeFocus: never,
		onDidChangeWindowFocus: never,
		focusChanged: () => {},
		connect: () => Promise.resolve(),
	};
}

function changeEvent(...sections: string[]): ConfigurationChangeEvent {
	return { affectsConfiguration: (section: string) => sections.includes(section) };
}

suite('WebviewViewService Test Suite', () => {
	suite('onHostEnvironmentChanged', () => {
		let sandbox: sinon.SinonSandbox;
		let configChanged: EventEmitter<ConfigurationChangeEvent>;
		let settings: Record<string, unknown>;

		setup(() => {
			sandbox = sinon.createSandbox();
			configChanged = new EventEmitter<ConfigurationChangeEvent>();
			settings = {};
			sandbox.stub(configuration, 'onDidChangeAny').get(() => configChanged.event);
			(sandbox.stub(configuration, 'getCore') as sinon.SinonStub).callsFake(
				(section: string) => settings[section],
			);
		});

		teardown(() => {
			configChanged.dispose();
			sandbox.restore();
		});

		test('pushes the complete effective state when a Modern UI setting changes', () => {
			const service = new WebviewViewService(createHost());
			const received: WebviewHostEnvironment[] = [];
			const unsubscribe = service.onHostEnvironmentChanged(env => received.push(env)) as () => void;

			settings = { 'workbench.experimental.modernUI': true, 'window.density.layout': 'compact' };
			configChanged.fire(changeEvent('window.density.layout'));

			assert.deepStrictEqual(received, [{ modernUI: true, compact: true, uppercaseViewHeaders: false }]);
			unsubscribe();
		});

		test('ignores unrelated configuration changes', () => {
			const service = new WebviewViewService(createHost());
			const handler = sinon.spy();
			const unsubscribe = service.onHostEnvironmentChanged(handler) as () => void;

			configChanged.fire(changeEvent('workbench.tree.indent'));

			assert.strictEqual(handler.callCount, 0);
			unsubscribe();
		});

		test('replays only the latest state to a hidden webview once it is shown', () => {
			const buffer = new EventVisibilityBuffer();
			const service = new WebviewViewService(createHost(), buffer);
			const received: WebviewHostEnvironment[] = [];
			const unsubscribe = service.onHostEnvironmentChanged(env => received.push(env)) as () => void;

			buffer.setVisible(false);
			settings = { 'workbench.experimental.modernUI': true };
			configChanged.fire(changeEvent('workbench.experimental.modernUI'));
			settings = { 'workbench.experimental.modernUI': false };
			configChanged.fire(changeEvent('workbench.experimental.modernUI'));
			assert.deepStrictEqual(received, [], 'nothing is delivered while hidden');

			buffer.setVisible(true);
			assert.deepStrictEqual(received, [{ modernUI: false, compact: false, uppercaseViewHeaders: false }]);
			unsubscribe();
		});

		test('stops pushing after unsubscribe', () => {
			const service = new WebviewViewService(createHost());
			const handler = sinon.spy();
			(service.onHostEnvironmentChanged(handler) as () => void)();

			configChanged.fire(changeEvent('workbench.experimental.modernUI'));

			assert.strictEqual(handler.callCount, 0);
		});
	});
});
