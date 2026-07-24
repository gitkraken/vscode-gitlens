/**
 * Integrations service — cloud integration connection state and change events.
 */

import { Disposable } from 'vscode';
import {
	isSupportedCloudIntegrationId,
	supportedCloudIntegrationDescriptors,
	supportedOrderedCloudIntegrationIds,
} from '@gitlens/integrations/constants.js';
import { providersMetadata } from '@gitlens/integrations/providers/models.js';
import type { Container } from '../../../container.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { bufferEventHandler } from '../eventVisibilityBuffer.js';
import type { IntegrationChangeEventData, IntegrationStateInfo, RpcEventSubscription, Unsubscribe } from './types.js';

// ============================================================
// Helpers
// ============================================================

export function getIntegrationStates(container: Container): IntegrationStateInfo[] {
	const configured = container.integrations.getConfigured();
	const integrations: IntegrationStateInfo[] = [];

	// A provider can have multiple connections (multi-account); surface one connected state per provider.
	const seenIntegrationIds = new Set<string>();

	for (const i of configured) {
		if (!isSupportedCloudIntegrationId(i.integrationId)) continue;
		if (seenIntegrationIds.has(i.integrationId)) continue;

		seenIntegrationIds.add(i.integrationId);

		const meta = providersMetadata[i.integrationId];
		const descriptor = supportedCloudIntegrationDescriptors.find(d => d.id === i.integrationId);

		integrations.push({
			id: i.integrationId,
			name: meta.name,
			icon: `gl-provider-${meta.iconKey}`,
			connected: true,
			supports:
				descriptor?.supports ??
				(meta.type === 'git' ? ['prs', 'issues'] : meta.type === 'issues' ? ['issues'] : []),
			requiresPro: descriptor?.requiresPro ?? false,
		});
	}

	// Fill in unconnected defaults
	for (const d of supportedCloudIntegrationDescriptors) {
		const existing = integrations.find(i => i.id === d.id);
		if (existing == null) {
			integrations.push({ ...d, connected: false });
		} else if (existing.icon !== d.icon) {
			// Update icon to match descriptor
			(existing as { icon: string }).icon = d.icon;
		}
	}

	integrations.sort(
		(a, b) =>
			supportedOrderedCloudIntegrationIds.indexOf(a.id as any) -
			supportedOrderedCloudIntegrationIds.indexOf(b.id as any),
	);

	return integrations;
}

// ============================================================
// Class
// ============================================================

export class IntegrationsService {
	/**
	 * Fired when cloud integration connections change.
	 * Includes full integration state for each configured provider.
	 */
	readonly onIntegrationsChanged: RpcEventSubscription<IntegrationChangeEventData>;

	constructor(
		private readonly container: Container,
		buffer: EventVisibilityBuffer | undefined,
		tracker?: SubscriptionTracker,
	) {
		this.onIntegrationsChanged = (callback): Unsubscribe => {
			const pendingKey = Symbol('integrationsChanged');
			const buffered = bufferEventHandler(buffer, pendingKey, callback, 'save-last');

			const fireIntegrationsChanged = () => {
				const integrations = getIntegrationStates(container);
				const data: IntegrationChangeEventData = {
					hasAnyConnected: integrations.some(i => i.connected),
					integrations: integrations,
				};
				buffered(data);
			};

			const disposable = Disposable.from(
				// Fires when configured integrations are added/removed
				container.integrations.onDidChange(e => {
					// Only re-query if the change involves cloud integrations
					if (![...e.added, ...e.removed].some(id => isSupportedCloudIntegrationId(id))) return;

					fireIntegrationsChanged();
				}),
				// Fires when an integration connects or disconnects
				container.integrations.onDidChangeConnectionState(() => {
					fireIntegrationsChanged();
				}),
			);
			const unsubscribe = () => {
				buffer?.removePending(pendingKey);
				disposable.dispose();
			};
			return tracker != null ? tracker.track(unsubscribe) : unsubscribe;
		};
	}

	/**
	 * Get the current state of all supported cloud integrations.
	 */
	getIntegrationStates(): Promise<IntegrationStateInfo[]> {
		// RPC methods are async by contract (webview transport); `getIntegrationStates` is now sync.
		return Promise.resolve(getIntegrationStates(this.container));
	}
}
