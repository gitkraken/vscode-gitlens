import type { AgentIconName } from '@gitlens/agents/agentCapabilities.js';
import { getAgentCapabilities, getAgentCapabilitiesByProviderId } from '@gitlens/agents/agentCapabilities.js';

/** The agent's own mark, falling back to the generic robot for an id with no descriptor. Both id
 *  namespaces are tried — session `providerId` (`claudeCode`) first, then the `gk ai hook` client id
 *  (`claude-code`) — since callers hold either.
 *
 *  Deliberately NOT shared with the webviews' `agentProviderIcon` despite the mirrored names: this
 *  returns a `ThemeIcon` id (`gitlens-provider-opencode`), that one a glicon name
 *  (`gl-provider-opencode`). */
export function getAgentProviderIcon(id: string | undefined): AgentIconName {
	if (!id) return 'robot';

	return (getAgentCapabilitiesByProviderId(id) ?? getAgentCapabilities(id))?.icon ?? 'robot';
}
