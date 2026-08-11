import type { Signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { AiModelInfo, AIState } from '../../../rpc/services/types.js';
import { createSignalGroup } from '../state.js';

export interface AIContextState {
	readonly model: Signal.State<AiModelInfo | undefined>;
	readonly state: Signal.State<AIState>;
	resetAll(): void;
}

export function createAIState(): AIContextState {
	const { signal, resetAll } = createSignalGroup();
	return {
		model: signal<AiModelInfo | undefined>(undefined),
		state: signal<AIState>({
			enabled: false,
			orgEnabled: true,
			mcp: { settingEnabled: false, installed: false, bundled: false, capable: false },
			hooks: {
				agents: [],
				canInstallHooks: false,
				anyInstalled: false,
			},
			defaultAgent: undefined,
		}),
		resetAll: resetAll,
	};
}

export const aiContext = createContext<AIContextState>('ai');
