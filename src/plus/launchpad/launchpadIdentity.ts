import { isIntegrationId } from '@gitlens/integrations/constants.js';
import { hostFromDomain } from '@gitlens/integrations/utils/domain.utils.js';
import { isSelfManagedHostIntegrationId } from '@gitlens/integrations/utils/integration.utils.js';
import type { LaunchpadItem } from './launchpadProvider.js';

export function getViewerAccountKey(provider: { readonly id: string; readonly domain?: string }): string {
	if (!isIntegrationId(provider.id) || !isSelfManagedHostIntegrationId(provider.id)) return provider.id;

	return `${provider.id}:${hostFromDomain(provider.domain) ?? provider.domain ?? ''}`;
}

// The persisted UUID must stay stable for existing pins; local selection and tree identity also need the host.
export function getLaunchpadItemKey(item: Pick<LaunchpadItem, 'uuid' | 'provider'>): string {
	return `${getViewerAccountKey(item.provider)}:${item.uuid}`;
}

export function findLaunchpadItem(
	items: LaunchpadItem[] | undefined,
	id: { uuid: string; provider?: LaunchpadItem['provider'] },
): LaunchpadItem | undefined {
	if (id.provider != null) {
		const key = getLaunchpadItemKey({ uuid: id.uuid, provider: id.provider });
		return items?.find(item => getLaunchpadItemKey(item) === key);
	}

	const matches = items?.filter(item => item.uuid === id.uuid);
	// A legacy command with no host must reopen the picker when its UUID is ambiguous.
	return matches?.length === 1 ? matches[0] : undefined;
}
