import * as assert from 'node:assert';
import { computeResumeTargets, getAgentExtension } from '../-webview/agentExtensions.js';

suite('agentExtensions', () => {
	test('getAgentExtension returns an extension only for claudeCode', () => {
		assert.notStrictEqual(getAgentExtension('claudeCode'), undefined);
		assert.strictEqual(getAgentExtension('codex'), undefined);
		assert.strictEqual(getAgentExtension('copilot'), undefined);
		assert.strictEqual(getAgentExtension('opencode'), undefined);
		assert.strictEqual(getAgentExtension('nope'), undefined);
	});
});

suite('computeResumeTargets', () => {
	test('offers the extension only in its own workspace folder, when available', () => {
		assert.deepStrictEqual(
			computeResumeTargets('claudeCode', '/w', () => true, ['/w']),
			['extension', 'terminal'],
		);
	});

	test('falls back to terminal-only outside every workspace folder', () => {
		assert.deepStrictEqual(
			computeResumeTargets('claudeCode', '/w/sub', () => true, ['/w']),
			['terminal'],
		);
	});

	test('falls back to terminal-only when the extension is unavailable', () => {
		assert.deepStrictEqual(
			computeResumeTargets('claudeCode', '/w', () => false, ['/w']),
			['terminal'],
		);
	});

	test('falls back to terminal-only for an agent with no extension', () => {
		assert.deepStrictEqual(
			computeResumeTargets('codex', '/w', () => true, ['/w']),
			['terminal'],
		);
	});
});
