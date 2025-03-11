import { configuration } from '../../../../system/-webview/configuration';

export function getConfiguredActiveOrganizationId(): string | undefined {
	return (
		configuration.get('gitkraken.activeOrganizationId') ??
		// Deprecated: Use `gitlens.gitkraken.activeOrganizationId` instead
		configuration.getAny('gitlens.gitKraken.activeOrganizationId') ??
		undefined
	);
}

export async function updateActiveOrganizationId(orgId: string | undefined): Promise<void> {
	await configuration.updateEffective('gitkraken.activeOrganizationId', orgId);
}
