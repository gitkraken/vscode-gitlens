import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import type { AiModelInfo, AIState } from '../../../rpc/services/types.js';
import { createSignalGroup } from '../state.js';

export interface AIContextState {
	readonly aiModel: Signal.State<AiModelInfo | undefined>;
	readonly aiState: Signal.State<AIState>;
	resetAll(): void;
}

export function createAIState(): AIContextState {
	const { signal, resetAll } = createSignalGroup();
	return {
		aiModel: signal<AiModelInfo | undefined>(undefined),
		aiState: signal<AIState>({
			enabled: false,
			orgEnabled: true,
			mcp: { settingEnabled: false, installed: false, bundled: false },
		}),
		resetAll: resetAll,
	};
}

export const aiContext = createContext<AIContextState>('ai');
