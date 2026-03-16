import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import type { IntegrationStateInfo } from '../../../rpc/services/types.js';
import { createSignalGroup } from '../state.js';

export interface IntegrationsState {
	readonly integrations: Signal.State<IntegrationStateInfo[]>;
	readonly hasAnyIntegrationConnected: Signal.State<boolean>;
	resetAll(): void;
}

export function createIntegrationsState(): IntegrationsState {
	const { signal, resetAll } = createSignalGroup();
	return {
		integrations: signal<IntegrationStateInfo[]>([]),
		hasAnyIntegrationConnected: signal(false),
		resetAll: resetAll,
	};
}

export const integrationsContext = createContext<IntegrationsState>('integrations');
