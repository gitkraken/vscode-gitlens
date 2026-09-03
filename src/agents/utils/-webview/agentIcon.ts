import { ThemeIcon } from 'vscode';
import { getHookClientId } from '../agentHooks.js';
import { getAgentProviderIcon } from '../agentIcon.js';

/** Takes `gk agents list` names, hence the `getHookClientId` hop — it reports Claude as
 *  `claude-cli`, which is in neither namespace {@link getAgentProviderIcon} tries. */
export function getAgentTerminalIcon(agentName: string): ThemeIcon {
	return new ThemeIcon(getAgentProviderIcon(getHookClientId(agentName)));
}
