import * as assert from 'assert';
import * as sinon from 'sinon';
import type { ConfigurationChangeEvent } from 'vscode';
import { configuration } from '../../system/-webview/configuration.js';
import {
	getWebviewHostEnvironment,
	getWebviewHostEnvironmentAttributes,
	hostEnvironmentChanged,
} from '../hostEnvironment.js';

function stubCoreSettings(sandbox: sinon.SinonSandbox, values: Record<string, unknown>): void {
	(sandbox.stub(configuration, 'getCore') as sinon.SinonStub).callsFake((section: string) => values[section]);
}

function changeEvent(...sections: string[]): ConfigurationChangeEvent {
	return { affectsConfiguration: (section: string) => sections.includes(section) };
}

suite('Webview host environment', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
	});

	teardown(() => {
		sandbox.restore();
	});

	suite('getWebviewHostEnvironment', () => {
		test('is all off when the settings are undefined (older VS Code)', () => {
			stubCoreSettings(sandbox, {});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: false,
				compact: false,
				uppercaseViewHeaders: false,
			});
		});

		test('is all off when Modern UI is off, even with compact density and uppercase headers set', () => {
			stubCoreSettings(sandbox, {
				'workbench.experimental.modernUI': false,
				'window.density.layout': 'compact',
				'workbench.experimental.modernUIUppercaseViewHeaders': true,
			});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: false,
				compact: false,
				uppercaseViewHeaders: false,
			});
		});

		test('reports only Modern UI when it is on with default density and no uppercase headers', () => {
			stubCoreSettings(sandbox, {
				'workbench.experimental.modernUI': true,
				'window.density.layout': 'default',
				'workbench.experimental.modernUIUppercaseViewHeaders': false,
			});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: true,
				compact: false,
				uppercaseViewHeaders: false,
			});
		});

		test('reports compact and uppercase headers only while Modern UI is on', () => {
			stubCoreSettings(sandbox, {
				'workbench.experimental.modernUI': true,
				'window.density.layout': 'compact',
				'workbench.experimental.modernUIUppercaseViewHeaders': true,
			});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: true,
				compact: true,
				uppercaseViewHeaders: true,
			});
		});

		test('treats anything other than a strict true / compact as off', () => {
			stubCoreSettings(sandbox, {
				'workbench.experimental.modernUI': 'true',
				'window.density.layout': 'compact',
				'workbench.experimental.modernUIUppercaseViewHeaders': true,
			});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: false,
				compact: false,
				uppercaseViewHeaders: false,
			});

			sandbox.restore();
			stubCoreSettings(sandbox, {
				'workbench.experimental.modernUI': true,
				'window.density.layout': 'Compact',
				'workbench.experimental.modernUIUppercaseViewHeaders': 1,
			});
			assert.deepStrictEqual(getWebviewHostEnvironment(), {
				modernUI: true,
				compact: false,
				uppercaseViewHeaders: false,
			});
		});
	});

	suite('getWebviewHostEnvironmentAttributes', () => {
		test('renders nothing when all are off', () => {
			assert.strictEqual(
				getWebviewHostEnvironmentAttributes({ modernUI: false, compact: false, uppercaseViewHeaders: false }),
				'',
			);
		});

		test('renders only data-modern-ui when only Modern UI is on', () => {
			assert.strictEqual(
				getWebviewHostEnvironmentAttributes({ modernUI: true, compact: false, uppercaseViewHeaders: false }),
				'data-modern-ui',
			);
		});

		test('renders all attributes, space separated, when all are on', () => {
			assert.strictEqual(
				getWebviewHostEnvironmentAttributes({ modernUI: true, compact: true, uppercaseViewHeaders: true }),
				'data-modern-ui data-modern-ui-compact data-modern-ui-uppercase-view-headers',
			);
		});
	});

	suite('hostEnvironmentChanged', () => {
		test('matches a change to any of the three settings', () => {
			assert.strictEqual(hostEnvironmentChanged(changeEvent('workbench.experimental.modernUI')), true);
			assert.strictEqual(hostEnvironmentChanged(changeEvent('window.density.layout')), true);
			assert.strictEqual(
				hostEnvironmentChanged(changeEvent('workbench.experimental.modernUIUppercaseViewHeaders')),
				true,
			);
		});

		test('ignores unrelated changes', () => {
			assert.strictEqual(hostEnvironmentChanged(changeEvent('workbench.tree.indent', 'gitlens')), false);
		});
	});
});
