import type { Signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { LaunchpadSummaryError, LaunchpadSummaryResult } from '../../../../plus/launchpad/launchpadIndicator.js';
import { createSignalGroup } from '../state.js';

/** Structural interface for the launchpad service — not coupled to a specific RPC type. */
export interface LaunchpadService {
	getSummary(options?: {
		force?: boolean;
	}): Promise<LaunchpadSummaryResult | { error: LaunchpadSummaryError } | undefined>;
}

export interface LaunchpadState {
	readonly launchpadSummary: Signal.State<LaunchpadSummaryResult | { error: LaunchpadSummaryError } | undefined>;
	readonly launchpadLoading: Signal.State<boolean>;
	service: LaunchpadService | undefined;
	resetAll(): void;
}

export function createLaunchpadState(): LaunchpadState {
	const { signal, resetAll } = createSignalGroup();
	return {
		launchpadSummary: signal<LaunchpadSummaryResult | { error: LaunchpadSummaryError } | undefined>(undefined),
		launchpadLoading: signal(false),
		service: undefined,
		resetAll: resetAll,
	};
}

export const launchpadContext = createContext<LaunchpadState>('launchpad');
