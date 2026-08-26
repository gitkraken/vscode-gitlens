import * as assert from 'node:assert';
import type { AgentCapabilities } from '../agentCapabilities.js';
import {
	getAgentCapabilities,
	getAgentCapabilitiesByProviderId,
	resolveCanonicalHookEvent,
	resolveCanonicalToolName,
} from '../agentCapabilities.js';

function getCapabilities(hookClientId: string): AgentCapabilities {
	const capabilities = getAgentCapabilities(hookClientId);
	assert.ok(capabilities != null, `expected capabilities for '${hookClientId}'`);

	return capabilities;
}

function statusPayload(type: unknown): Record<string, unknown> {
	return { properties: { status: { type: type } } };
}

suite('agentCapabilities', () => {
	suite('getAgentCapabilities', () => {
		test('resolves each supported hook client id', () => {
			assert.strictEqual(getAgentCapabilities('claude-code')?.providerId, 'claudeCode');
			assert.strictEqual(getAgentCapabilities('codex')?.providerId, 'codex');
			assert.strictEqual(getAgentCapabilities('copilot')?.providerId, 'copilot');
			assert.strictEqual(getAgentCapabilities('opencode')?.providerId, 'opencode');
		});

		test('returns undefined for unknown or cross-namespace ids', () => {
			assert.strictEqual(getAgentCapabilities('cursor'), undefined);
			assert.strictEqual(getAgentCapabilities(''), undefined);
			// `claudeCode` is a provider id, not a hook client id.
			assert.strictEqual(getAgentCapabilities('claudeCode'), undefined);
		});

		test('carries display metadata', () => {
			const claude = getCapabilities('claude-code');
			assert.strictEqual(claude.displayName, 'Claude Code');
			assert.strictEqual(claude.icon, 'claude');

			const copilot = getCapabilities('copilot');
			assert.strictEqual(copilot.displayName, 'GitHub Copilot CLI');
			assert.strictEqual(copilot.icon, 'copilot');
		});
	});

	suite('getAgentCapabilitiesByProviderId', () => {
		test('resolves each supported provider id', () => {
			assert.strictEqual(getAgentCapabilitiesByProviderId('claudeCode')?.hookClientId, 'claude-code');
			assert.strictEqual(getAgentCapabilitiesByProviderId('codex')?.hookClientId, 'codex');
			assert.strictEqual(getAgentCapabilitiesByProviderId('copilot')?.hookClientId, 'copilot');
			assert.strictEqual(getAgentCapabilitiesByProviderId('opencode')?.hookClientId, 'opencode');
		});

		test('returns undefined for unknown or cross-namespace ids', () => {
			assert.strictEqual(getAgentCapabilitiesByProviderId('cursor'), undefined);
			assert.strictEqual(getAgentCapabilitiesByProviderId(''), undefined);
			// `claude-code` is a hook client id, not a provider id.
			assert.strictEqual(getAgentCapabilitiesByProviderId('claude-code'), undefined);
		});
	});

	suite('claude-code install events', () => {
		test('omits the worktree events and keeps the blocking permission hook', () => {
			const claude = getCapabilities('claude-code');
			assert.ok(claude.installEvents?.includes('SessionStart'));
			assert.ok(!claude.installEvents?.includes('WorktreeCreate'));
			assert.ok(!claude.installEvents?.includes('WorktreeRemove'));
			assert.deepStrictEqual([...(claude.installBlockingEvents ?? [])], ['PermissionRequest']);
		});

		test('leaves install events undefined for the other clients', () => {
			for (const hookClientId of ['codex', 'copilot', 'opencode']) {
				const capabilities = getCapabilities(hookClientId);
				assert.strictEqual(capabilities.installEvents, undefined, hookClientId);
				assert.strictEqual(capabilities.installBlockingEvents, undefined, hookClientId);
			}
		});
	});

	suite('resolveCanonicalHookEvent', () => {
		test('passes canonical event names through unchanged', () => {
			for (const hookClientId of ['claude-code', 'codex', 'copilot', 'opencode']) {
				const capabilities = getCapabilities(hookClientId);
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, 'SessionStart'), 'SessionStart');
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, 'PostToolUse'), 'PostToolUse');
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, 'PermissionRequest'), 'PermissionRequest');
			}
		});

		test('returns undefined for unknown event names', () => {
			for (const hookClientId of ['claude-code', 'codex', 'copilot', 'opencode']) {
				const capabilities = getCapabilities(hookClientId);
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, 'NotAnEvent'), undefined);
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, ''), undefined);
				// Casing is significant — the CLI relays native names verbatim.
				assert.strictEqual(resolveCanonicalHookEvent(capabilities, 'sessionStart'), undefined);
			}
		});

		test('maps copilot ErrorOccurred to StopFailure', () => {
			const copilot = getCapabilities('copilot');
			assert.strictEqual(resolveCanonicalHookEvent(copilot, 'ErrorOccurred'), 'StopFailure');
		});

		test('maps every opencode native event', () => {
			const opencode = getCapabilities('opencode');
			const expected: [string, string][] = [
				['session.created', 'SessionStart'],
				['session.deleted', 'SessionEnd'],
				['session.idle', 'Stop'],
				['session.error', 'StopFailure'],
				['session.compacted', 'PostCompact'],
				['permission.asked', 'PermissionRequest'],
				['permission.replied', 'ElicitationResult'],
				['tool.execute.before', 'PreToolUse'],
				['tool.execute.after', 'PostToolUse'],
			];
			for (const [nativeEvent, canonical] of expected) {
				assert.strictEqual(resolveCanonicalHookEvent(opencode, nativeEvent), canonical, nativeEvent);
			}
		});

		test('leaves opencode session.updated unmapped', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.updated'), undefined);
		});

		test('resolves opencode session.status from the payload', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusPayload('idle')), 'Stop');
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', statusPayload('busy')),
				'PostToolUse',
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', statusPayload('retry')),
				undefined,
			);
		});

		test('returns undefined for a malformed or absent session.status payload', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status'), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', {}), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusPayload(42)), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusPayload(null)), undefined);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', { properties: 'nope' }),
				undefined,
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', { properties: { status: 'nope' } }),
				undefined,
			);
		});

		test('only consults the opencode resolver for session.status', () => {
			const opencode = getCapabilities('opencode');
			// A payload that would resolve `session.status` must not affect other events.
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.created', statusPayload('busy')),
				'SessionStart',
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.updated', statusPayload('idle')),
				undefined,
			);
		});
	});

	suite('resolveCanonicalToolName', () => {
		test('returns claude tool names unchanged', () => {
			const claude = getCapabilities('claude-code');
			assert.strictEqual(resolveCanonicalToolName(claude, 'Bash'), 'Bash');
			assert.strictEqual(resolveCanonicalToolName(claude, 'ExitPlanMode'), 'ExitPlanMode');
		});

		test('maps codex apply_patch but leaves update_plan alone', () => {
			const codex = getCapabilities('codex');
			assert.strictEqual(resolveCanonicalToolName(codex, 'apply_patch'), 'Edit');
			assert.strictEqual(resolveCanonicalToolName(codex, 'update_plan'), 'update_plan');
		});

		test('maps copilot tool aliases', () => {
			const copilot = getCapabilities('copilot');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'bash'), 'Bash');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'powershell'), 'Bash');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'view'), 'Read');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'create'), 'Write');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'str_replace_editor'), 'Edit');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'rg'), 'Grep');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'web_fetch'), 'WebFetch');
			assert.strictEqual(resolveCanonicalToolName(copilot, 'ask_user'), 'AskUserQuestion');
		});

		test('maps opencode tool aliases', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'bash'), 'Bash');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'read'), 'Read');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'write'), 'Write');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'edit'), 'Edit');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'grep'), 'Grep');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'glob'), 'Glob');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'webfetch'), 'WebFetch');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'websearch'), 'WebSearch');
			assert.strictEqual(resolveCanonicalToolName(opencode, 'apply_patch'), 'Edit');
		});

		test('falls through unchanged for unmapped tool names', () => {
			for (const hookClientId of ['claude-code', 'codex', 'copilot', 'opencode']) {
				const capabilities = getCapabilities(hookClientId);
				assert.strictEqual(resolveCanonicalToolName(capabilities, 'SomeMcpTool'), 'SomeMcpTool');
				assert.strictEqual(resolveCanonicalToolName(capabilities, ''), '');
			}
		});
	});

	suite('capability flags', () => {
		test('match the CLI-derived matrix', () => {
			const claude = getCapabilities('claude-code');
			assert.strictEqual(claude.supportsBlockingPermissions, true);
			assert.strictEqual(claude.supportsTranscripts, true);
			assert.strictEqual(claude.supportsResume, true);
			assert.strictEqual(claude.sharesPids, false);
			assert.strictEqual(claude.cwdIsStatic, false);

			// The CLI's `pidSharingClients` lists codex — it multiplexes sessions in one process.
			assert.strictEqual(getCapabilities('codex').sharesPids, true);
			// The CLI hard-errors on blocking events for opencode.
			assert.strictEqual(getCapabilities('opencode').supportsBlockingPermissions, false);
			// OpenCode's tool hooks carry no per-call cwd.
			assert.strictEqual(getCapabilities('opencode').cwdIsStatic, true);
		});
	});
});
