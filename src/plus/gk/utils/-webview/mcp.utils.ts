import { env, lm, version } from 'vscode';
import { isOffline, isWeb } from '@env/platform.js';
import type { Container } from '../../../../container.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { satisfies } from '../../../../system/version.js';

export function isMcpBannerEnabled(container: Container, showAutoRegistration = false): boolean {
	// Check if running on web or automatically registrable
	if (isWeb || (!showAutoRegistration && mcpExtensionRegistrationAllowed(container))) {
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

export function mcpExtensionRegistrationAllowed(container: Container): boolean {
	return container.ai.enabled && configuration.get('gitkraken.mcp.autoEnabled') && supportsMcpExtensionRegistration();
}
