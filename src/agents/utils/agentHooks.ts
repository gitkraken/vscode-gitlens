import { getAgentCapabilities } from '@gitlens/agents/agentCapabilities.js';

/** `gk agents list` reports the Claude Code CLI agent as `claude-cli`; `gk ai hook install` expects
 *  `claude-code` for that same agent. Every other agent's id passes through unchanged. */
export function getHookClientId(agentName: string): string {
	return agentName === 'claude-cli' ? 'claude-code' : agentName;
}

/**
 * True when GitLens offers GitKraken Hooks install/uninstall for the given `gk agents list` agent
 * name — i.e. when we hold a capability descriptor for the agent's {@link getHookClientId} client.
 *
 * The descriptor IS the gate, deliberately. `gk ai hook` accepts six clients; GitLens has
 * descriptors for four (`claude-code`, `codex`, `copilot`, `opencode`). The two it omits —
 * `cursor` and `antigravity` — are broken upstream in the CLI: their hook payloads identify a
 * conversation via `conversation_id`/`conversationId` and a directory via
 * `workspace_roots`/`workspacePaths`, while the CLI's own `HookInput` reads only `session_id` and
 * `cwd`, and it drops any payload whose `cwd` is empty. Installing hooks for them would report
 * success and then produce no sessions, ever.
 *
 * So do NOT widen this to "every agent `gk` reports as `hooksSupported`". A descriptor is also what
 * teaches GitLens to translate a client's native events and tool names, so its absence is exactly
 * the right signal that we cannot yet make that client's hooks useful. The way to add a client is
 * to add its descriptor to `agentCapabilities.ts` (once the CLI relays a usable payload for it),
 * not to relax this predicate.
 */
export function areHooksOfferedForAgent(agentName: string): boolean {
	return getAgentCapabilities(getHookClientId(agentName)) != null;
}

/**
 * The activation hint a `gk agents list` agent's capability descriptor carries, if any — see
 * `AgentCapabilities.manualActivation`. `undefined` when the agent has no descriptor (see
 * {@link areHooksOfferedForAgent}) or its descriptor requires no extra step beyond installing.
 *
 * Shared by every surface that reports hooks install state (the install-completion toast, the
 * Agents settings table, and the webview RPC boundary), so the {@link getHookClientId} translation
 * and the descriptor lookup happen in exactly one place.
 */
export function getManualActivationHint(agentName: string): string | undefined {
	return getAgentCapabilities(getHookClientId(agentName))?.manualActivation;
}
