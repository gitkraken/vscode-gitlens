import * as assert from 'node:assert';
import * as sinon from 'sinon';
// Loads the module graph in its real order: `agentPicker` reaches `system/-webview/command.js`,
// which crashes on load when imported before the container has registered its commands
import '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';
import { getRequestedAgentRoute } from '../agentPicker.js';

suite('getRequestedAgentRoute', () => {
	let sandbox: sinon.SinonSandbox;

	setup(() => {
		sandbox = sinon.createSandbox();
		(sandbox.stub(configuration, 'get') as sinon.SinonStub).withArgs('ai.openInAgent').returns('manual');
	});

	teardown(() => {
		sandbox.restore();
	});

	test('an explicit route wins over the setting', () => {
		assert.strictEqual(getRequestedAgentRoute({ showOpenInAgent: 'agent' }), 'agent');
	});

	test('the plain commands fall back to the setting', () => {
		assert.strictEqual(getRequestedAgentRoute(undefined), 'manual');
		assert.strictEqual(getRequestedAgentRoute({}), 'manual');
	});

	test('MCP-style callers keep the legacy path, so their chat hand-off still happens', () => {
		// The gk CLI's mcp/issue/start and mcp/pr/review/start pass exactly this
		assert.strictEqual(getRequestedAgentRoute({ useDefaults: true, openChatOnComplete: true }), undefined);
		assert.strictEqual(getRequestedAgentRoute({ useDefaults: true }), undefined);
		assert.strictEqual(getRequestedAgentRoute({ openChatOnComplete: false }), undefined);
	});
});
