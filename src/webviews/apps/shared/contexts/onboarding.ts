import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import { signalObject } from 'signal-utils/object';
import type { WalkthroughContextKeys } from '../../../../constants.walkthroughs.js';
import { createSignalGroup } from '../state.js';

export type OnboardingKey = 'integrationBanner';

export interface OnboardingState {
	readonly banners: {
		integrationBanner: boolean;
		mcpBanner: boolean;
	};
	readonly walkthroughProgress: Signal.State<WalkthroughProgressState | undefined>;
	/** Dismiss a banner by key. No-op before RPC connects; wired by root component. */
	dismiss(key: OnboardingKey): void;
	/** Dismiss the walkthrough. No-op before RPC connects; wired by root component. */
	dismissWalkthrough(): void;
	resetAll(): void;
}

/**
 * Walkthrough progress state.
 */
export interface WalkthroughProgressState {
	readonly doneCount: number;
	readonly allCount: number;
	readonly progress: number;
	readonly state: Record<WalkthroughContextKeys, boolean>;
}

function noop(): void {}

export function createOnboardingState(): OnboardingState {
	const { signal, resetAll } = createSignalGroup();
	return {
		banners: signalObject({
			integrationBanner: false,
			mcpBanner: false,
		}),
		walkthroughProgress: signal<WalkthroughProgressState | undefined>(undefined),
		dismiss: noop,
		dismissWalkthrough: noop,
		resetAll: resetAll,
	};
}

export const onboardingContext = createContext<OnboardingState>('onboarding');
