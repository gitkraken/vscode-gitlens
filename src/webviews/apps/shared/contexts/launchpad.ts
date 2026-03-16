import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import type { LaunchpadSummaryResult } from '../../../../plus/launchpad/launchpadIndicator.js';
import { createSignalGroup } from '../state.js';

/** Structural interface for the launchpad service — not coupled to a specific RPC type. */
export interface LaunchpadService {
	getSummary(): Promise<LaunchpadSummaryResult | { error: Error } | undefined>;
}

export interface LaunchpadState {
	readonly launchpadSummary: Signal.State<LaunchpadSummaryResult | { error: Error } | undefined>;
	readonly launchpadLoading: Signal.State<boolean>;
	service: LaunchpadService | undefined;
	resetAll(): void;
}

export function createLaunchpadState(): LaunchpadState {
	const { signal, resetAll } = createSignalGroup();
	return {
		launchpadSummary: signal<LaunchpadSummaryResult | { error: Error } | undefined>(undefined),
		launchpadLoading: signal(false),
		service: undefined,
		resetAll: resetAll,
	};
}

export const launchpadContext = createContext<LaunchpadState>('launchpad');
