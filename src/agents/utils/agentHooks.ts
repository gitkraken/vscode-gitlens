/** `gk agents list` reports the Claude Code CLI agent as `claude-cli`; `gk ai hook install` expects
 *  `claude-code` for that same agent. Every other agent's id passes through unchanged. */
export function getHookClientId(agentName: string): string {
	return agentName === 'claude-cli' ? 'claude-code' : agentName;
}

/** Feature flag: when true, GitLens installs/uninstalls hooks for the Claude Code agent only — every
 *  other agent's hooks controls are hidden and their hook install/uninstall operations are refused. */
export const onlyAllowClaudeHooks = true;

/** True when GitKraken hooks may be installed/uninstalled for the given gkcli agent name, honoring
 *  `onlyAllowClaudeHooks`. Claude Code is the `claude-cli` agent. */
export function areHooksAllowedForAgent(agentName: string): boolean {
	return !onlyAllowClaudeHooks || agentName === 'claude-cli';
}
