import * as assert from 'node:assert';
import type { AgentCapabilities } from '../agentCapabilities.js';
import {
	agentCapabilities,
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

/** An OpenCode `session.status` hook input, nested the way the CLI's generated plugin builds it:
 *  the raw SDK event sits under `hook_payload.event`, so the status type is at
 *  `hook_payload.event.properties.status.type` from the hook-input root. */
function statusHookInput(type: unknown): Record<string, unknown> {
	return { hook_payload: { event: { properties: { status: { type: type } } } } };
}

/** Wraps an arbitrary raw SDK event body at the nesting `resolveEvent` navigates from. */
function hookInputWithEvent(event: unknown): Record<string, unknown> {
	return { hook_payload: { event: event } };
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

			// Codex carries OpenAI's mark; it has none of its own in the codicon font.
			const codex = getCapabilities('codex');
			assert.strictEqual(codex.displayName, 'Codex');
			assert.strictEqual(codex.icon, 'openai');

			// OpenCode carries its own glicons mark; a glyph name that isn't in the font renders as
			// tofu instead of falling back, so this must stay a real one.
			const opencode = getCapabilities('opencode');
			assert.strictEqual(opencode.displayName, 'OpenCode');
			assert.strictEqual(opencode.icon, 'gitlens-provider-opencode');
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

		test('resolves opencode session.status from the hook input', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusHookInput('idle')), 'Stop');
			// `busy` must stay unresolved. A canonical event selects a branch of the provider's
			// state-machine switch and therefore runs that event's whole handler — mapping `busy` onto
			// `PostToolUse` (as this once did) would clear a pending permission ask while the agent is
			// still blocked on it and desync the parallel-tool refcount, because OpenCode emits
			// `session.status` independently of any tool lifecycle. Do not "fix" this back: there is no
			// tool-free canonical event meaning "resumed working".
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', statusHookInput('busy')),
				undefined,
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', statusHookInput('retry')),
				undefined,
			);
		});

		test('returns undefined for a malformed or absent session.status hook input', () => {
			const opencode = getCapabilities('opencode');
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status'), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', {}), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusHookInput(42)), undefined);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', statusHookInput(null)), undefined);
			// A raw event body handed in un-nested — i.e. the wrapping the CLI actually applies is
			// missing — must not resolve, or the real payload's path would be a coincidence.
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', {
					properties: { status: { type: 'idle' } },
				}),
				undefined,
			);
			assert.strictEqual(resolveCanonicalHookEvent(opencode, 'session.status', { hook_payload: {} }), undefined);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', hookInputWithEvent('nope')),
				undefined,
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.status', hookInputWithEvent({ properties: 'nope' })),
				undefined,
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(
					opencode,
					'session.status',
					hookInputWithEvent({ properties: { status: 'nope' } }),
				),
				undefined,
			);
		});

		test('only consults the opencode resolver for session.status', () => {
			const opencode = getCapabilities('opencode');
			// A hook input that would resolve `session.status` must not affect other events.
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.created', statusHookInput('busy')),
				'SessionStart',
			);
			assert.strictEqual(
				resolveCanonicalHookEvent(opencode, 'session.updated', statusHookInput('idle')),
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
			// `powershell` has no alias on purpose — aliasing it to `Bash` would mislabel a PowerShell
			// call for nothing, since Copilot's tool inputs never reach GitLens (they arrive under
			// `hookInput.toolInput`, which nothing reads), so there is no command detail to gain.
			assert.strictEqual(resolveCanonicalToolName(copilot, 'powershell'), 'powershell');
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

			// The CLI's `pidSharingClients` lists codex — it multiplexes sessions in one process.
			assert.strictEqual(getCapabilities('codex').sharesPids, true);
			// The CLI hard-errors on blocking events for opencode.
			assert.strictEqual(getCapabilities('opencode').supportsBlockingPermissions, false);
		});

		test('every resumable agent declares how its CLI resumes a session', () => {
			for (const hookClientId of ['claude-code', 'codex', 'copilot', 'opencode']) {
				const capabilities = getCapabilities(hookClientId);
				assert.strictEqual(capabilities.supportsResume, true, `${hookClientId} supports resume`);
				assert.ok(capabilities.cli != null, `${hookClientId} declares a cli block`);
				assert.ok(
					capabilities.cli.resumeArgs('abc').includes('abc') ||
						capabilities.cli.resumeArgs('abc').some(a => a.endsWith('=abc')),
				);
			}
			assert.deepStrictEqual(getCapabilities('claude-code').cli?.resumeArgs('s1'), ['--resume', 's1']);
			assert.deepStrictEqual(getCapabilities('codex').cli?.resumeArgs('s1'), ['resume', 's1']);
			assert.deepStrictEqual(getCapabilities('opencode').cli?.resumeArgs('s1'), ['--session', 's1']);
			assert.deepStrictEqual(getCapabilities('copilot').cli?.resumeArgs('s1'), ['--resume=s1']);
			assert.strictEqual(getCapabilities('claude-code').cli?.agentName, 'claude-cli');
			assert.strictEqual(getCapabilities('claude-code').cli?.command, 'claude');
		});

		test('supportsResume and the cli block agree', () => {
			for (const capabilities of agentCapabilities) {
				assert.strictEqual(capabilities.supportsResume, capabilities.cli != null, capabilities.hookClientId);
			}
		});
	});

	suite('manualActivation', () => {
		test('codex carries the hook-trust activation hint', () => {
			const codex = getCapabilities('codex');
			assert.ok(codex.manualActivation != null);
			assert.match(codex.manualActivation, /\/hooks/);
		});

		test('leaves manualActivation undefined for the other clients', () => {
			for (const hookClientId of ['claude-code', 'copilot', 'opencode']) {
				assert.strictEqual(getCapabilities(hookClientId).manualActivation, undefined, hookClientId);
			}
		});
	});
});
