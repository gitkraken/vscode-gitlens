import { env, lm, version } from 'vscode';
import { isOffline, isWeb } from '@env/platform';
import type { Container } from '../../../../container';
import { configuration } from '../../../../system/-webview/configuration';
import { satisfies } from '../../../../system/version';

export function isMcpBannerEnabled(container: Container, showAutoRegistration = false): boolean {
	// Check if running on web or automatically registrable
	if (isWeb || (!showAutoRegistration && mcpExtensionRegistrationAllowed())) {
		return false;
	}

	return !container.storage.get('mcp:banner:dismissed', false);
}

const supportedApps = ['Visual Studio Code', 'Visual Studio Code - Insiders', 'Visual Studio Code - Exploration'];
export function supportsMcpExtensionRegistration(): boolean {
	if (isWeb || isOffline || !supportedApps.includes(env.appName)) {
		return false;
	}

	return satisfies(version, '>= 1.101.0') && lm.registerMcpServerDefinitionProvider != null;
}

export function mcpExtensionRegistrationAllowed(): boolean {
	return (
		configuration.get('ai.enabled') &&
		configuration.get('gitkraken.mcp.autoEnabled') &&
		supportsMcpExtensionRegistration()
	);
}
