import { createContext } from '@lit/context';
import type { Signal } from '@lit-labs/signals';
import { signalObject } from 'signal-utils/object';
import type { WalkthroughProgressState } from '../../../home/homeService.js';
import { createSignalGroup } from '../state.js';

export type OnboardingKey = 'aiAllAccessBanner' | 'integrationBanner' | 'amaBanner';

export interface OnboardingState {
	readonly banners: {
		aiAllAccessBanner: boolean;
		integrationBanner: boolean;
		amaBanner: boolean;
	};
	readonly walkthroughProgress: Signal.State<WalkthroughProgressState | undefined>;
	/** Dismiss a banner by key. No-op before RPC connects; wired by root component. */
	dismiss(key: OnboardingKey): void;
	/** Dismiss the walkthrough. No-op before RPC connects; wired by root component. */
	dismissWalkthrough(): void;
	resetAll(): void;
}

function noop(): void {}

export function createOnboardingState(): OnboardingState {
	const { signal, resetAll } = createSignalGroup();
	return {
		banners: signalObject({
			aiAllAccessBanner: false,
			integrationBanner: false,
			amaBanner: false,
		}),
		walkthroughProgress: signal<WalkthroughProgressState | undefined>(undefined),
		dismiss: noop,
		dismissWalkthrough: noop,
		resetAll: resetAll,
	};
}

export const onboardingContext = createContext<OnboardingState>('onboarding');
