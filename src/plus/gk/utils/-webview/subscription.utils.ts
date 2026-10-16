import { Logger } from '@gitlens/utils/logger.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { Storage } from '../../../../system/-webview/storage.js';

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

/**
 * The memento can resolve a write it then loses to the echo of an earlier flush, so the value is read back and
 * written once more if it didn't stick
 */
export async function storeRefusedTrialReactivation(
	storage: Storage,
	accountId: string,
	nextTrialOptInDate: string,
): Promise<void> {
	const key = `plus:trialReactivation:${accountId}:refused` as const;

	for (let attempt = 0; attempt < 2; attempt++) {
		await storage.store(key, { nextTrialOptInDate: nextTrialOptInDate });
		if (storage.get(key)?.nextTrialOptInDate === nextTrialOptInDate) return;
	}

	Logger.warn('Unable to confirm the refused Pro trial reactivation was remembered');
}
