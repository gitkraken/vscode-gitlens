import { env, workspace } from 'vscode';
import type { AgentHookClientId } from '@gitlens/agents/agentCapabilities.js';
import { getAgentCapabilitiesByProviderId } from '@gitlens/agents/agentCapabilities.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { getKeplerHost } from './keplerHost.js';
import { createKeplerSessionLink } from './keplerLink.js';
import { promptKeplerNotInstalled } from './keplerTask.js';

/** An agent session to open in Kepler — identity only; Kepler resolves everything else. */
export interface KeplerSessionRequest {
	/** The GitLens agent provider id (`claudeCode`, `codex`, …) */
	providerId: string;
	/** The agent-native session id */
	sessionId: string;
	/** The directory the session ran in — a hint for Kepler's disk discovery */
	cwd?: string;
}

/**
 * The Kepler adapter id for a GitLens agent provider, or `undefined` when Kepler has no adapter for
 * it. Kepler's adapter ids equal the provider's `gk ai hook` client id.
 */
export function getKeplerAgentId(providerId: string): AgentHookClientId | undefined {
	return getAgentCapabilitiesByProviderId(providerId)?.hookClientId;
}

/**
 * Deep links an agent session into an installed Kepler. Returns whether the link was handed off —
 * never whether Kepler actually handled it. Mirrors `startKeplerTask`'s gate, prompt and telemetry.
 */
export async function openSessionInKepler(
	container: Container,
	request: KeplerSessionRequest,
	source?: Source,
): Promise<boolean> {
	const agent = getKeplerAgentId(request.providerId);

	// Defence in depth: the menus that lead here are already hidden on the web, and a provider with
	// no Kepler adapter never gets the action. No telemetry — nothing actionable to report for a
	// path that should never be entered.
	if (!container.kepler.available || agent == null) return false;

	// Enums and booleans only — never the session id or the cwd
	const data = {
		agent: agent,
		'cwd.resolved': request.cwd != null,
		channel: container.kepler.channel,
	};

	if (container.kepler.installed === false) {
		container.telemetry.sendEvent(
			'kepler/session/open/failed',
			{ ...data, 'failure.reason': 'not-installed' },
			source,
		);

		await promptKeplerNotInstalled(source);
		return false;
	}

	let opened: boolean;
	try {
		opened = await openUrl(
			createKeplerSessionLink(container.kepler.scheme, {
				agent: agent,
				id: request.sessionId,
				cwd: request.cwd,
				host: getKeplerHost(env.remoteName, workspace.workspaceFolders?.map(f => f.uri) ?? []),
			}),
		);
	} catch {
		opened = false;
	}

	if (!opened) {
		container.telemetry.sendEvent(
			'kepler/session/open/failed',
			{ ...data, 'failure.reason': 'open-failed' },
			source,
		);
		return false;
	}

	container.telemetry.sendEvent('kepler/session/open', data, source);
	return true;
}
