import { lm, version } from 'vscode';
import { getPlatform, isWeb } from '@env/platform';
import type { Container } from '../../../../container';
import { getHostAppName } from '../../../../system/-webview/vscode';
import { satisfies } from '../../../../system/version';

export async function isMcpBannerEnabled(container: Container): Promise<boolean> {
	// Check if running on web
	if (isWeb) {
		return false;
	}

	// Check platform
	const platform = getPlatform();
	if (platform !== 'windows' && platform !== 'macOS' && platform !== 'linux') {
		return false;
	}

	if (container.storage.get('mcp:banner:dismissed', false)) return false;

	// Check host app
	const hostAppName = await getHostAppName();
	const supportedApps = ['code', 'code-insiders', 'cursor', 'windsurf'];

	return hostAppName != null && supportedApps.includes(hostAppName);
}

export function supportsMcpExtensionRegistration(): boolean {
	return satisfies(version, '>= 1.101.0') && lm.registerMcpServerDefinitionProvider != null;
}
