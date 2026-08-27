import * as assert from 'node:assert';
import { areHooksOfferedForAgent, getHookClientId, getManualActivationHint } from '../agentHooks.js';

suite('getHookClientId', () => {
	test("translates the CLI's `claude-cli` agent name onto the `claude-code` hook client id", () => {
		assert.strictEqual(getHookClientId('claude-cli'), 'claude-code');
	});

	test('passes every other agent name through unchanged', () => {
		for (const name of ['codex', 'copilot', 'opencode', 'cursor', 'antigravity', 'gemini']) {
			assert.strictEqual(getHookClientId(name), name);
		}
	});
});

suite('areHooksOfferedForAgent', () => {
	test('offers hooks for every agent GitLens holds a capability descriptor for', () => {
		// `claude-cli` only passes via the `getHookClientId` translation — the descriptor is keyed on
		// `claude-code`, so a predicate that skipped the translation would refuse Claude Code itself.
		for (const name of ['claude-cli', 'codex', 'copilot', 'opencode']) {
			assert.strictEqual(areHooksOfferedForAgent(name), true, `${name} must be offered hooks`);
		}
	});

	test('refuses the hook clients GitLens has no descriptor for', () => {
		// cursor/antigravity are valid `gk ai hook` clients but broken upstream: their payloads carry
		// `conversation_id`/`workspace_roots` while the CLI reads `session_id`/`cwd`, so an install
		// would report success and never produce a session. `gemini` isn't a hook client at all.
		for (const name of ['cursor', 'antigravity', 'gemini', 'not-an-agent']) {
			assert.strictEqual(areHooksOfferedForAgent(name), false, `${name} must not be offered hooks`);
		}
	});
});

suite('getManualActivationHint', () => {
	test('surfaces the codex hook-trust hint', () => {
		assert.ok(getManualActivationHint('codex') != null);
		assert.match(getManualActivationHint('codex') ?? '', /\/hooks/);
	});

	test('returns undefined for agents with a descriptor but no activation step', () => {
		for (const name of ['claude-cli', 'copilot', 'opencode']) {
			assert.strictEqual(getManualActivationHint(name), undefined, name);
		}
	});

	test('returns undefined for agents with no capability descriptor', () => {
		for (const name of ['cursor', 'antigravity', 'gemini', 'not-an-agent']) {
			assert.strictEqual(getManualActivationHint(name), undefined, name);
		}
	});
});
