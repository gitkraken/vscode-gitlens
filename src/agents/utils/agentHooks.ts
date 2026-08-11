/** `gk agents list` reports the Claude Code CLI agent as `claude-cli`; `gk ai hook install` expects
 *  `claude-code` for that same agent. Every other agent's id passes through unchanged. */
export function getHookClientId(agentName: string): string {
	return agentName === 'claude-cli' ? 'claude-code' : agentName;
}
