import type { Signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { AgentInfo } from '../../../rpc/services/types.js';
import { createSignalGroup } from '../state/signals.js';

export interface AgentsState {
	readonly agents: Signal.State<AgentInfo[] | undefined>;
	resetAll(): void;
}

export function createAgentsState(): AgentsState {
	const { signal, resetAll } = createSignalGroup();
	return {
		agents: signal<AgentInfo[] | undefined>(undefined),
		resetAll: resetAll,
	};
}

export const agentsContext = createContext<AgentsState>('agents');
