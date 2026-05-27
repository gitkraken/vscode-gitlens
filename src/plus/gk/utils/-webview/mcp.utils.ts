import { cursor, env, lm, version } from 'vscode';
import { getIsOffline, isWeb } from '@env/platform.js';
import { satisfies } from '@gitlens/utils/version.js';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';

export function isMcpBannerEnabled(container: Container, showAutoRegistration = false): boolean {
	// Check if running on web or automatically registrable
	if (isWeb || (!showAutoRegistration && mcpRegistrationAllowed(container))) {
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

export function mcpRegistrationEnabled(container: Container): boolean {
	if (isWeb || getIsOffline()) {
		return false;
	}

	return container.ai.enabled && configuration.get('gitkraken.mcp.autoEnabled');
}

export function mcpRegistrationAllowed(container: Container): boolean {
	if (!mcpRegistrationEnabled(container)) return false;

	return supportsMcpExtensionRegistration() || supportsCursorMcpRegistration();
}

export function needsCursorMcpCleanupNotice(container: Container): boolean {
	return (
		mcpRegistrationEnabled(container) &&
		supportsCursorMcpRegistration() &&
		container.previousVersion != null &&
		satisfies(container.previousVersion, '< 17.11.1') &&
		container.storage.getScoped('gk:cli:install')?.status === 'completed'
	);
}
