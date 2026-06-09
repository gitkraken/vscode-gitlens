import type { Disposable } from 'vscode';
import { cursor, env, lm, version } from 'vscode';
import { isWeb } from '@env/platform.js';
import { satisfies } from '@gitlens/utils/version.js';
import type { Container } from '../../../../container.js';

/** The cross-env-visible surface of the Node-only `GkMcpService`, re-exported as `GkMcpService` by the
 *  browser env barrel and `implements`-ed by the real service. Lets shared consumers read these off
 *  `container.gkMcp?.…` in both builds without the browser barrel importing the Node service, while
 *  keeping the stub from drifting from what the service actually exposes. */
export interface GkMcpRegistrar extends Disposable {
	readonly isRegistrationAllowed: boolean;
	readonly isRegistrationEnabled: boolean;
}

export function isMcpBannerEnabled(container: Container, showAutoRegistration = false): boolean {
	// Check if running on web or automatically registrable
	if (isWeb || (!showAutoRegistration && (container.gkMcp?.isRegistrationAllowed ?? false))) {
		return false;
	}

	return !container.onboarding.isDismissed('mcp:banner');
}

export function isHooksBannerEnabled(container: Container): boolean {
	if (isWeb) return false;
	// MCP takes precedence — only surface the hooks prompt when the MCP one isn't competing for attention.
	if (isMcpBannerEnabled(container)) return false;

	return !container.onboarding.isDismissed('hooks:banner');
}

const supportedApps = ['Visual Studio Code', 'Visual Studio Code - Insiders', 'Visual Studio Code - Exploration'];
export function supportsMcpExtensionRegistration(): boolean {
	if (!supportedApps.includes(env.appName)) {
		return false;
	}

	return satisfies(version, '>= 1.101.0') && lm.registerMcpServerDefinitionProvider != null;
}

export function supportsCursorMcpRegistration(): boolean {
	if (env.appName !== 'Cursor') return false;

	return cursor?.mcp?.registerServer != null;
}

export function needsCursorMcpCleanupNotice(container: Container): boolean {
	return (
		(container.gkMcp?.isRegistrationEnabled ?? false) &&
		supportsCursorMcpRegistration() &&
		container.previousVersion != null &&
		satisfies(container.previousVersion, '< 17.11.1') &&
		container.storage.getScoped('gk:cli:install')?.status === 'completed'
	);
}
