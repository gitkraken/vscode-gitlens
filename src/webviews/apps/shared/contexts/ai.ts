import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
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
			mcp: { settingEnabled: false, installed: false, bundled: false },
		}),
		resetAll: resetAll,
	};
}

export const aiContext = createContext<AIContextState>('ai');
